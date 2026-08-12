/**
 * Per-process memory sampler (main process).
 *
 * Every {@link SAMPLE_INTERVAL_MS} this logs ONE compact INFO line naming the
 * RSS of every process Intent is responsible for, so a debug bundle's
 * `console-output.log` can answer "which process grew" after the fact.
 *
 * Why the whole process tree and not just `app.getAppMetrics()`: the report
 * that motivated this (intent-hq/monorepo, Intent 2.26.0) was macOS's
 * "your system has run out of application memory" dialog — a SYSTEM-wide
 * figure, not a per-process reading. The quantity of interest is therefore
 * Intent's aggregate footprint: Electron's own processes PLUS the intentd
 * daemon PLUS every agent provider CLI the daemon spawns. Electron's metrics
 * only cover the first of those three, so we also read the OS process table
 * and walk the daemon's descendants.
 *
 * Cost: the synchronous work per sample (parse + format) is well under 5 ms;
 * the process-table read runs as an async subprocess off the main thread and
 * is skipped entirely if a previous sample is still in flight.
 *
 * Scope: logging only — no UI, no telemetry upload, no bundle-layout change.
 */

import { execFile } from 'node:child_process';
import { app } from 'electron';

import { Logger } from '../shared/logger';
import { LOGGING_CONFIG, LogLevel } from '../shared/logging-config';

/** Logger context; also the greppable prefix on every sample line. */
const CONTEXT = 'MemoryMonitor';

// The default log level is WARN in packaged builds, so an unregistered
// category would drop every INFO sample line exactly where this telemetry is
// needed — on a user's machine. Register from here (instead of editing the
// shared config table) so the sampler owns its own visibility.
if (LOGGING_CONFIG.categories[CONTEXT] === undefined) {
  LOGGING_CONFIG.categories[CONTEXT] = LogLevel.INFO;
}

const logger = new Logger(CONTEXT);

/** How often a sample is taken. Constant by design — not user-configurable. */
export const SAMPLE_INTERVAL_MS = 60_000;

/** Default per-process WARN threshold: 4 GB. */
export const DEFAULT_WARN_THRESHOLD_BYTES = 4 * 1024 * 1024 * 1024;

/** Env override for the WARN threshold, in MB (e.g. `INTENT_MEMORY_WARN_MB=2048`). */
export const WARN_THRESHOLD_ENV_VAR = 'INTENT_MEMORY_WARN_MB';

/** Renderers listed individually before the tail is aggregated, so the line stays bounded. */
const MAX_LISTED_RENDERERS = 6;

/** Largest agent processes named individually in the sample line. */
const TOP_AGENTS_LISTED = 3;

/** Timeout for the process-table subprocess; a slow sample is dropped, never queued. */
const PROCESS_TABLE_TIMEOUT_MS = 5_000;

/** Guard against a pathological `ps` output blowing up main-process memory. */
const PROCESS_TABLE_MAX_BUFFER = 8 * 1024 * 1024;

const BYTES_PER_MB = 1024 * 1024;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Structural subset of `Electron.ProcessMetric` used here (keeps this module testable). */
export interface AppProcessMetric {
  pid: number;
  /** Electron's own naming: 'Browser' | 'Tab' | 'GPU' | 'Utility' | … */
  type: string;
  name?: string;
  serviceName?: string;
  /** `workingSetSize` is in KILOBYTES (Electron's unit), not bytes. */
  memory: { workingSetSize: number };
}

/** One row of the OS process table. */
export interface ProcessTableEntry {
  pid: number;
  ppid: number;
  rssBytes: number;
  /** Executable path or name as reported by the OS. */
  command: string;
}

/** Which part of Intent a sampled process belongs to. */
export type ProcessKind = 'main' | 'renderer' | 'gpu' | 'utility' | 'sidecar' | 'agent' | 'other';

export interface ProcessMemorySample {
  pid: number;
  kind: ProcessKind;
  /** Short label (Electron service name, or executable basename for OS processes). */
  name?: string;
  rssBytes: number;
}

export interface MemorySnapshot {
  /** Electron's own processes, from `app.getAppMetrics()`. */
  electron: ProcessMemorySample[];
  /** intentd daemon process(es) — normally exactly one. */
  sidecar: ProcessMemorySample[];
  /** Descendants of the daemon: agent provider CLIs and anything they spawn. */
  agents: ProcessMemorySample[];
  /** True when the OS process table could not be read (sidecar/agents unknown, not zero). */
  processTableUnavailable: boolean;
}

/** Injection seam so the sampler can be unit-tested without Electron or a real `ps`. */
export interface MemorySources {
  appMetrics(): AppProcessMetric[];
  /** RSS of the main process itself (`process.memoryUsage().rss`). */
  mainRssBytes(): number;
  /** OS process table, or `null` when it cannot be read on this platform. */
  processTable(): Promise<ProcessTableEntry[] | null>;
}

// ---------------------------------------------------------------------------
// Process table
// ---------------------------------------------------------------------------

/**
 * Parse `pid ppid rssKB command` rows (the shape both the POSIX `ps` and the
 * Windows PowerShell query below are asked to emit).
 *
 * The command is the remainder of the line, so executable paths containing
 * spaces survive intact. Malformed rows are skipped rather than throwing —
 * instrumentation must never take the app down.
 */
export function parseProcessTable(stdout: string): ProcessTableEntry[] {
  const entries: ProcessTableEntry[] = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const match = /^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const command = match[4].trim();
    if (command.length === 0) continue;
    entries.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      rssBytes: Number(match[3]) * 1024,
      command,
    });
  }
  return entries;
}

function runProcessTableCommand(
  command: string,
  args: string[],
): Promise<ProcessTableEntry[] | null> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: PROCESS_TABLE_TIMEOUT_MS, maxBuffer: PROCESS_TABLE_MAX_BUFFER },
      (error, stdout) => {
        if (error && !stdout) {
          resolve(null);
          return;
        }
        resolve(parseProcessTable(stdout));
      },
    );
  });
}

/**
 * Read the OS process table. `ps` reports RSS in KB; the PowerShell fallback is
 * asked to print the same four space-separated fields so one parser covers both.
 */
export function readProcessTable(): Promise<ProcessTableEntry[] | null> {
  if (process.platform === 'win32') {
    return runProcessTableCommand('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { ' +
        '"$($_.ProcessId) $($_.ParentProcessId) $([int]($_.WorkingSetSize/1024)) $($_.Name)" }',
    ]);
  }
  return runProcessTableCommand('ps', ['-axo', 'pid=,ppid=,rss=,comm=']);
}

/** Lowercased executable basename, with any `.exe` suffix removed. */
export function processBasename(command: string): string {
  const withoutArgs = command.trim();
  const separator = Math.max(withoutArgs.lastIndexOf('/'), withoutArgs.lastIndexOf('\\'));
  const base = separator >= 0 ? withoutArgs.slice(separator + 1) : withoutArgs;
  return base.toLowerCase().replace(/\.exe$/, '');
}

/**
 * Log-safe process label: the basename, with whitespace collapsed to `_` and a
 * length cap. Both matter because a process can rewrite its own title (npm
 * publishes `npm exec @scope/pkg@1.2.3`) and app bundles have spaces in their
 * paths — either would otherwise break the space-separated sample line.
 */
export function shortProcessName(command: string): string {
  const base = processBasename(command).replace(/\s+/g, '_');
  return base.length > MAX_NAME_LENGTH ? `${base.slice(0, MAX_NAME_LENGTH)}~` : base;
}

/** Cap on a process label in the sample line. */
const MAX_NAME_LENGTH = 24;

/** Depth cap on the ancestor walk — belt-and-braces against a corrupt table. */
const MAX_ANCESTOR_DEPTH = 64;

/**
 * Every intentd DAEMON visible on the machine.
 *
 * Deliberately not restricted to the daemon this app spawned: an adopted
 * external daemon (dev two-terminal flow, or a daemon that outlived a previous
 * app run) contributes to the same system-wide pressure the OOM dialog
 * reported, so it belongs in the aggregate.
 *
 * Basename alone is NOT enough: the same `intentd` binary is re-executed as
 * `intentd mcp-bridge` under every agent, so the real tree is
 * `Intent → intentd serve → npm/node → claude → intentd mcp-bridge`. Those
 * bridges are agent children, so only intentd processes with no intentd
 * ancestor count as daemons — otherwise a bridge would be labelled a sidecar
 * AND counted a second time as a descendant of the daemon.
 */
export function findSidecarProcesses(table: ProcessTableEntry[]): ProcessTableEntry[] {
  const byPid = new Map(table.map((entry) => [entry.pid, entry]));
  const isDaemonBinary = (entry: ProcessTableEntry) => processBasename(entry.command) === 'intentd';

  const hasIntentdAncestor = (entry: ProcessTableEntry): boolean => {
    const seen = new Set<number>([entry.pid]);
    let current = byPid.get(entry.ppid);
    for (let depth = 0; current && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
      if (seen.has(current.pid)) return false;
      if (isDaemonBinary(current)) return true;
      seen.add(current.pid);
      current = byPid.get(current.ppid);
    }
    return false;
  };

  return table.filter((entry) => isDaemonBinary(entry) && !hasIntentdAncestor(entry));
}

/** Breadth-first descendant walk. Cycle-safe: a pid is visited at most once. */
export function collectDescendants(
  table: ProcessTableEntry[],
  rootPids: number[],
): ProcessTableEntry[] {
  const childrenByParent = new Map<number, ProcessTableEntry[]>();
  for (const entry of table) {
    const siblings = childrenByParent.get(entry.ppid);
    if (siblings) siblings.push(entry);
    else childrenByParent.set(entry.ppid, [entry]);
  }

  const visited = new Set<number>(rootPids);
  const descendants: ProcessTableEntry[] = [];
  const queue = [...rootPids];
  while (queue.length > 0) {
    const pid = queue.shift() as number;
    for (const child of childrenByParent.get(pid) ?? []) {
      if (visited.has(child.pid)) continue;
      visited.add(child.pid);
      descendants.push(child);
      queue.push(child.pid);
    }
  }
  return descendants;
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

function electronKind(type: string): ProcessKind {
  switch (type) {
    case 'Browser':
      return 'main';
    case 'Tab':
      return 'renderer';
    case 'GPU':
      return 'gpu';
    case 'Utility':
      return 'utility';
    default:
      return 'other';
  }
}

/** Build a snapshot from the injected sources. Never throws. */
export async function sampleMemory(sources: MemorySources): Promise<MemorySnapshot> {
  const electron: ProcessMemorySample[] = [];
  for (const metric of sources.appMetrics()) {
    const kind = electronKind(metric.type);
    electron.push({
      pid: metric.pid,
      kind,
      name: metric.serviceName ?? metric.name,
      // The main process reports its own RSS more faithfully than the metric does.
      rssBytes: kind === 'main' ? sources.mainRssBytes() : metric.memory.workingSetSize * 1024,
    });
  }

  const table = await sources.processTable();
  if (!table) {
    return { electron, sidecar: [], agents: [], processTableUnavailable: true };
  }

  const sidecarEntries = findSidecarProcesses(table);
  const agentEntries = collectDescendants(
    table,
    sidecarEntries.map((entry) => entry.pid),
  );

  return {
    electron,
    sidecar: sidecarEntries.map((entry) => ({
      pid: entry.pid,
      kind: 'sidecar' as const,
      name: shortProcessName(entry.command),
      rssBytes: entry.rssBytes,
    })),
    agents: agentEntries.map((entry) => ({
      pid: entry.pid,
      kind: 'agent' as const,
      name: shortProcessName(entry.command),
      rssBytes: entry.rssBytes,
    })),
    processTableUnavailable: false,
  };
}

// ---------------------------------------------------------------------------
// Formatting + thresholds
// ---------------------------------------------------------------------------

function toMB(bytes: number): number {
  return Math.round(bytes / BYTES_PER_MB);
}

function sumRss(samples: ProcessMemorySample[]): number {
  return samples.reduce((total, sample) => total + sample.rssBytes, 0);
}

function byRssDesc(a: ProcessMemorySample, b: ProcessMemorySample): number {
  return b.rssBytes - a.rssBytes;
}

/** Every sampled process, flattened — the unit both the total and the threshold check work on. */
export function allSamples(snapshot: MemorySnapshot): ProcessMemorySample[] {
  return [...snapshot.electron, ...snapshot.sidecar, ...snapshot.agents];
}

/** Intent's aggregate footprint across every process in the snapshot. */
export function totalRssBytes(snapshot: MemorySnapshot): number {
  return sumRss(allSamples(snapshot));
}

/** Processes at or above the threshold, largest first. */
export function findThresholdBreaches(
  snapshot: MemorySnapshot,
  thresholdBytes: number,
): ProcessMemorySample[] {
  return allSamples(snapshot)
    .filter((sample) => sample.rssBytes >= thresholdBytes)
    .sort(byRssDesc);
}

function describe(sample: ProcessMemorySample): string {
  const label = sample.name ? `${sample.kind}:${sample.name}` : sample.kind;
  return `${label}[${sample.pid}]=${toMB(sample.rssBytes)}MB`;
}

/**
 * One compact line per sample, e.g.
 * `rss main=412MB renderer[1234]=980MB gpu=180MB utility(n=3)=64MB
 *  sidecar(intentd)[1300]=520MB agents(n=6)=3400MB top=[claude[9911]=1200MB] total=5766MB`
 */
export function formatSnapshot(snapshot: MemorySnapshot): string {
  const parts: string[] = ['rss'];

  const main = snapshot.electron.filter((sample) => sample.kind === 'main');
  parts.push(`main=${toMB(sumRss(main))}MB`);

  const renderers = snapshot.electron.filter((sample) => sample.kind === 'renderer').sort(byRssDesc);
  for (const renderer of renderers.slice(0, MAX_LISTED_RENDERERS)) {
    parts.push(`renderer[${renderer.pid}]=${toMB(renderer.rssBytes)}MB`);
  }
  const remainingRenderers = renderers.slice(MAX_LISTED_RENDERERS);
  if (remainingRenderers.length > 0) {
    parts.push(
      `renderer(+${remainingRenderers.length} more)=${toMB(sumRss(remainingRenderers))}MB`,
    );
  }

  for (const kind of ['gpu', 'utility', 'other'] as const) {
    const group = snapshot.electron.filter((sample) => sample.kind === kind);
    if (group.length === 0) continue;
    const count = group.length > 1 ? `(n=${group.length})` : '';
    parts.push(`${kind}${count}=${toMB(sumRss(group))}MB`);
  }

  if (snapshot.processTableUnavailable) {
    parts.push('sidecar(intentd)=unknown', 'agents=unknown');
  } else if (snapshot.sidecar.length === 0) {
    parts.push('sidecar(intentd)=none');
  } else if (snapshot.sidecar.length === 1) {
    parts.push(`sidecar(intentd)[${snapshot.sidecar[0].pid}]=${toMB(snapshot.sidecar[0].rssBytes)}MB`);
  } else {
    parts.push(`sidecar(intentd)(n=${snapshot.sidecar.length})=${toMB(sumRss(snapshot.sidecar))}MB`);
  }

  if (!snapshot.processTableUnavailable) {
    parts.push(`agents(n=${snapshot.agents.length})=${toMB(sumRss(snapshot.agents))}MB`);
    const top = [...snapshot.agents].sort(byRssDesc).slice(0, TOP_AGENTS_LISTED);
    if (top.length > 0) {
      const listed = top.map((agent) => `${agent.name ?? 'agent'}[${agent.pid}]=${toMB(agent.rssBytes)}MB`);
      parts.push(`top=[${listed.join(',')}]`);
    }
  }

  parts.push(`total=${toMB(totalRssBytes(snapshot))}MB`);
  return parts.join(' ');
}

/** WARN text for a threshold breach, or `null` when nothing crossed it. */
export function formatThresholdWarning(
  snapshot: MemorySnapshot,
  thresholdBytes: number,
): string | null {
  const breaches = findThresholdBreaches(snapshot, thresholdBytes);
  if (breaches.length === 0) return null;
  return `threshold-exceeded threshold=${toMB(thresholdBytes)}MB ${breaches.map(describe).join(' ')}`;
}

/** Resolve the WARN threshold, honouring {@link WARN_THRESHOLD_ENV_VAR}. */
export function resolveWarnThresholdBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[WARN_THRESHOLD_ENV_VAR];
  if (!raw) return DEFAULT_WARN_THRESHOLD_BYTES;
  const megabytes = Number(raw);
  if (!Number.isFinite(megabytes) || megabytes <= 0) return DEFAULT_WARN_THRESHOLD_BYTES;
  return megabytes * BYTES_PER_MB;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let sampleTimer: NodeJS.Timeout | null = null;
let sampleInFlight = false;

function defaultSources(): MemorySources {
  return {
    appMetrics: () => app.getAppMetrics() as unknown as AppProcessMetric[],
    mainRssBytes: () => process.memoryUsage().rss,
    processTable: readProcessTable,
  };
}

/** Take one sample and log it. Exported for the debug-bundle collector and tests. */
export async function logMemorySample(
  sources: MemorySources = defaultSources(),
  thresholdBytes: number = resolveWarnThresholdBytes(),
): Promise<MemorySnapshot | null> {
  try {
    const snapshot = await sampleMemory(sources);
    logger.info(formatSnapshot(snapshot));
    const warning = formatThresholdWarning(snapshot, thresholdBytes);
    if (warning) logger.warn(warning);
    return snapshot;
  } catch (error) {
    logger.warn(
      `sample failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export interface StartMemoryMonitorOptions {
  sources?: MemorySources;
  thresholdBytes?: number;
  intervalMs?: number;
}

/**
 * Begin sampling. Idempotent — a second call while running is a no-op, so a
 * restart path can never leak a second timer.
 */
export function startMemoryMonitor(options: StartMemoryMonitorOptions = {}): void {
  if (sampleTimer) return;

  const intervalMs = options.intervalMs ?? SAMPLE_INTERVAL_MS;
  const thresholdBytes = options.thresholdBytes ?? resolveWarnThresholdBytes();
  const sources = options.sources ?? defaultSources();

  sampleTimer = setInterval(() => {
    // A previous sample still waiting on the process table means the machine is
    // loaded; skip this tick rather than piling up subprocesses.
    if (sampleInFlight) return;
    sampleInFlight = true;
    void logMemorySample(sources, thresholdBytes).finally(() => {
      sampleInFlight = false;
    });
  }, intervalMs);

  // Never hold the event loop open on our account.
  sampleTimer.unref?.();

  logger.info(
    `started interval=${Math.round(intervalMs / 1000)}s warnThreshold=${toMB(thresholdBytes)}MB`,
  );
}

/** Stop sampling and clear the timer. Safe to call when not running. */
export function stopMemoryMonitor(): void {
  if (!sampleTimer) return;
  clearInterval(sampleTimer);
  sampleTimer = null;
}

/** Test hook: whether the sampling timer is currently armed. */
export function __isMemoryMonitorRunningForTesting(): boolean {
  return sampleTimer !== null;
}
