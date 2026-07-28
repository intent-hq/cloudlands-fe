/**
 * Sidecar manager: spawns and supervises the intentd daemon in the Electron
 * main process.
 *
 * Packaged apps spawn the bundled binary automatically; dev builds require
 * `INTENTD_SIDECAR=1` (default is two-terminal flow). Env overrides
 * (`INTENTD_SOCKET`, `INTENTD_WS_URL`, `INTENTD_TCP`) disable spawning and
 * connect to an external daemon. The manager probes the target UDS socket
 * before spawning to adopt an already-running daemon (single-instance).
 *
 * Binary location:
 *   - Packaged → `process.resourcesPath/intentd/intentd` (contract for task 3)
 *   - Dev      → `packages/intentd/target/{release,debug}/intentd` (or `INTENTD_BIN`)
 *
 * Data dir: honors `INTENTD_DATA_DIR` (spawns intentd with that env and
 * connects to `$INTENTD_DATA_DIR/intentd.sock`). `INTENTD_SOCKET` is
 * connect-only (disables spawning).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import { Logger } from '$shared/logger';
import { RestartPolicy } from './restart-policy';
import { setConnectionMode, setDaemonVersionInfo } from './connection-mode';
import { compareToPinnedVersion, readPinnedVersion } from './intentd-version-pin';
// Re-export from the policy module so existing importers keep working; consumers
// that only need the decision (e.g. `backend-connection.ts`) import it from
// `intentd-spawn-policy` directly to avoid pulling in the sidecar manager.
export { shouldSpawnSidecar, type ShouldSpawnDecision } from './intentd-spawn-policy';
import { shouldSpawnSidecar } from './intentd-spawn-policy';

const logger = new Logger('Sidecar');

let sidecarProcess: ChildProcess | null = null;
let restartPolicy: RestartPolicy | null = null;
let watchdogTimer: NodeJS.Timeout | null = null;
let restartTimer: NodeJS.Timeout | null = null;
let killEscalationTimer: NodeJS.Timeout | null = null;
let isShuttingDown = false;
let consecutiveFailures = 0;

/** Listener invoked when the restart policy exhausts its attempts (crash loop). */
type SidecarGaveUpListener = (reason: string) => void;
const sidecarGaveUpListeners = new Set<SidecarGaveUpListener>();

/**
 * Register a listener fired when the sidecar crash-loops and the restart
 * policy gives up (max attempts exhausted). Consumers (backend.ipc.ts)
 * broadcast this to the renderer so the daemon-loss UI surfaces instead of
 * the sidecar dying invisibly (#439). Returns a disposer.
 */
export function onSidecarGaveUp(listener: SidecarGaveUpListener): () => void {
  sidecarGaveUpListeners.add(listener);
  return () => {
    sidecarGaveUpListeners.delete(listener);
  };
}

function notifySidecarGaveUp(reason: string): void {
  for (const listener of sidecarGaveUpListeners) {
    try {
      listener(reason);
    } catch (error) {
      logger.warn('sidecar gave-up listener threw', { error });
    }
  }
}

/** Listener invoked when the sidecar spawn could not happen at all. */
type SidecarStartupFailedListener = (reason: string) => void;
const sidecarStartupFailedListeners = new Set<SidecarStartupFailedListener>();

/**
 * Register a listener fired when the app is in sidecar posture but the spawn
 * could not happen at all (binary not found, spawn error). Consumers
 * (backend.ipc.ts) broadcast this to the renderer so the daemon-loss UI can
 * say the app-managed intentd failed to start. Returns a disposer.
 */
export function onSidecarStartupFailed(listener: SidecarStartupFailedListener): () => void {
  sidecarStartupFailedListeners.add(listener);
  return () => {
    sidecarStartupFailedListeners.delete(listener);
  };
}

/**
 * Latched most-recent startup failure. Boot-time failures fire before
 * backend.ipc.ts registers its listener and before any window exists, so the
 * notify/broadcast path alone is lossy; late consumers (the
 * `backend:get-status` handler) query this instead. Cleared when a new spawn
 * attempt begins.
 */
let sidecarStartupFailure: { reason: string } | null = null;

/**
 * Latched startup failure (spawn could not happen at all), or null. Exposed
 * on the `backend:get-status` response so delivery is ordering-independent
 * (see PR #402 review).
 */
export function getSidecarStartupFailure(): { reason: string } | null {
  return sidecarStartupFailure;
}

function notifySidecarStartupFailed(reason: string): void {
  sidecarStartupFailure = { reason };
  for (const listener of sidecarStartupFailedListeners) {
    try {
      listener(reason);
    } catch (error) {
      logger.warn('sidecar startup-failed listener threw', { error });
    }
  }
}

/**
 * Renderer-safe snapshot of the most recent sidecar run (pinned IPC contract
 * for `backend:get-sidecar-run-log`). No env values or secrets.
 */
export interface SidecarRunLog {
  /** False when no sidecar run has ever been captured this app session. */
  available: boolean;
  /** ISO timestamp of the most recent spawn (or failed spawn attempt). */
  startedAt: string | null;
  /** Null while the run is still in progress. */
  endedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  /** e.g. "intentd binary not found" when the spawn could not happen. */
  spawnError: string | null;
  /** Tail of combined stdout+stderr, capped at the last 400 lines. */
  lines: string[];
}

/** Cap on the combined stdout+stderr tail retained per run. */
const SIDECAR_RUN_LOG_MAX_LINES = 400;

interface SidecarRunRecord {
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  spawnError: string | null;
  lines: string[];
  /** Trailing partial line awaiting its newline (data chunks are not line-aligned). */
  pendingPartial: string;
}

/**
 * Most recent run record (in-memory, current app session only). A new spawn
 * starts a fresh record; until then the previous record IS "the last run".
 */
let currentRunRecord: SidecarRunRecord | null = null;

function beginSidecarRunRecord(): SidecarRunRecord {
  // A new attempt supersedes any latched startup failure from a prior one.
  sidecarStartupFailure = null;
  currentRunRecord = {
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    signal: null,
    spawnError: null,
    lines: [],
    pendingPartial: '',
  };
  return currentRunRecord;
}

function pushRunLogLine(record: SidecarRunRecord, rawLine: string): void {
  const line = rawLine.trimEnd();
  if (line.length === 0) return;
  record.lines.push(line);
  if (record.lines.length > SIDECAR_RUN_LOG_MAX_LINES) {
    record.lines.splice(0, record.lines.length - SIDECAR_RUN_LOG_MAX_LINES);
  }
}

/**
 * Append output to a run record, keeping only the last N complete lines. A
 * line straddling two data chunks is buffered until its newline arrives so it
 * is recorded once, not split into two entries.
 */
function appendRunLogLines(record: SidecarRunRecord, text: string): void {
  const segments = (record.pendingPartial + text).split('\n');
  record.pendingPartial = segments.pop() ?? '';
  for (const segment of segments) {
    pushRunLogLine(record, segment);
  }
}

/** Flush any buffered partial line (no newline will ever arrive). */
function flushRunLogPartial(record: SidecarRunRecord): void {
  if (record.pendingPartial.length > 0) {
    pushRunLogLine(record, record.pendingPartial);
    record.pendingPartial = '';
  }
}

/** Snapshot of the most recent sidecar run for the renderer (see [[SidecarRunLog]]). */
export function getSidecarRunLog(): SidecarRunLog {
  if (!currentRunRecord) {
    return {
      available: false,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      signal: null,
      spawnError: null,
      lines: [],
    };
  }
  // Include a buffered partial trailing line in the snapshot (without
  // mutating the record) so a live view is not missing the newest output.
  const lines = [...currentRunRecord.lines];
  const partial = currentRunRecord.pendingPartial.trimEnd();
  if (partial.length > 0) {
    lines.push(partial);
    if (lines.length > SIDECAR_RUN_LOG_MAX_LINES) {
      lines.splice(0, lines.length - SIDECAR_RUN_LOG_MAX_LINES);
    }
  }
  return {
    available: true,
    startedAt: currentRunRecord.startedAt,
    endedAt: currentRunRecord.endedAt,
    exitCode: currentRunRecord.exitCode,
    signal: currentRunRecord.signal,
    spawnError: currentRunRecord.spawnError,
    lines,
  };
}

/**
 * Test seam: reset module state for testing.
 * @internal
 */
export function __resetIntentdSidecarForTesting(): void {
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (killEscalationTimer) {
    clearTimeout(killEscalationTimer);
    killEscalationTimer = null;
  }
  sidecarProcess = null;
  restartPolicy = null;
  isShuttingDown = false;
  consecutiveFailures = 0;
  sidecarGaveUpListeners.clear();
  sidecarStartupFailedListeners.clear();
  currentRunRecord = null;
  sidecarStartupFailure = null;
  spawnOnDemandInFlight = null;
}

/**
 * Test seam: set the sidecar process handle for testing.
 * @internal
 */
export function __setSidecarProcessForTesting(proc: ChildProcess | null): void {
  sidecarProcess = proc;
}

/**
 * Test seam: start the watchdog directly for testing.
 * @internal
 */
export function __startWatchdogForTesting(socketPath: string, delayMs?: number): void {
  startHealthWatchdog(socketPath, delayMs);
}

/**
 * Resolve the intentd binary path.
 *
 * Precedence:
 *   1. `INTENTD_BIN` env override — a path to the intentd binary. Absolute
 *      paths are recommended (the Makefile's `dev` target passes an absolute
 *      release path so dev is not implicitly dependent on Electron's cwd
 *      being the monorepo root); relative paths are accepted and resolved
 *      against `process.cwd()` via `fs.existsSync`.
 *   2. Packaged → `process.resourcesPath/intentd/intentd` (intentd.exe on Windows)
 *   3. Dev → walk from `cwd` up to the filesystem root looking for
 *      `packages/intentd/target/{release,debug}/intentd` (intentd.exe on
 *      Windows). Preferring release matches the `dev` target's output;
 *      the upward walk lets `pnpm run dev` work whether Electron is
 *      launched from the monorepo root or from `packages/cloudlands-fe`.
 *
 * Returns `null` if no binary is found (caller should fail or adopt external daemon).
 * Pure function for testability (uses `fs.existsSync`, but caller can mock).
 */
export function resolveIntentdBinaryPath(
  env: NodeJS.ProcessEnv,
  isPackaged: boolean,
  resourcesPath: string,
  cwd: string,
): string | null {
  const binaryName = process.platform === 'win32' ? 'intentd.exe' : 'intentd';
  const override = env.INTENTD_BIN?.trim();
  if (override && fs.existsSync(override)) {
    return override;
  }
  if (isPackaged) {
    const packagedBinary = path.join(resourcesPath, 'intentd', binaryName);
    return fs.existsSync(packagedBinary) ? packagedBinary : null;
  }
  // Dev: walk upward from cwd probing packages/intentd/target/{release,debug}.
  // The Electron cwd is not guaranteed to be the monorepo root (e.g. `pnpm run
  // dev` launched from `packages/cloudlands-fe`), so we search ancestors too.
  // Only resolve relative inputs — on Windows, `path.resolve` on an already-
  // absolute POSIX-style path (e.g. `/monorepo`) prepends the current drive
  // letter and changes the string form, which is unnecessary here.
  let dir = path.isAbsolute(cwd) ? cwd : path.resolve(cwd);
  // Cap the walk to prevent runaway probing on unusual filesystems.
  for (let i = 0; i < 16; i++) {
    const releaseBinary = path.join(dir, 'packages/intentd/target/release', binaryName);
    if (fs.existsSync(releaseBinary)) return releaseBinary;
    const debugBinary = path.join(dir, 'packages/intentd/target/debug', binaryName);
    if (fs.existsSync(debugBinary)) return debugBinary;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Resolve the UDS socket path the daemon will use.
 *
 * If `INTENTD_DATA_DIR` is set, returns `$INTENTD_DATA_DIR/intentd.sock`.
 * Otherwise returns the platform default (macOS: `~/Library/Application Support/intentd/intentd.sock`).
 */
export function resolveSocketPath(env: NodeJS.ProcessEnv): string {
  const dataDir = env.INTENTD_DATA_DIR?.trim();
  if (dataDir) {
    return path.join(dataDir, 'intentd.sock');
  }
  // Default per intentd's Config::resolve (crates/intent-core/src/config.rs)
  // i18n-ignore (filesystem path)
  return path.join(os.homedir(), 'Library', 'Application Support', 'intentd', 'intentd.sock');
}

/** Result of a version-aware daemon probe (see [[probeDaemonVersion]]). */
export interface DaemonVersionProbeResult {
  alive: boolean;
  version?: string;
  protocolVersion?: string;
}

/**
 * Version handshake probe: sends `system.status` over the UDS socket and
 * parses the JSON-RPC response for the daemon's `version` and
 * `protocolVersion` fields.
 *
 * `alive` is `true` whenever the daemon sent anything back (even if the
 * payload could not be parsed or lacks version fields — older daemons), so
 * callers can use it like the boolean probes.
 */
export async function probeDaemonVersion(
  socketPath: string,
  timeoutMs = 3000,
): Promise<DaemonVersionProbeResult> {
  if (!fs.existsSync(socketPath)) return { alive: false };

  return new Promise<DaemonVersionProbeResult>((resolve) => {
    const client = net.connect({ path: socketPath });
    let buffer = '';
    let resolved = false;

    const finish = (result: DaemonVersionProbeResult): void => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      client.destroy();
      resolve(result);
    };

    const timeout = setTimeout(() => finish({ alive: buffer.length > 0 }), timeoutMs);

    // Send system.status request (control fast-path, no DB access).
    // Omit params to match the established request shape in json-rpc-client.ts
    const rpcRequest = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'system.status',
    };

    client.on('connect', () => {
      client.write(JSON.stringify(rpcRequest) + '\n');
    });

    client.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) return;
      try {
        const parsed = JSON.parse(buffer.slice(0, newlineIndex)) as {
          result?: { version?: unknown; protocolVersion?: unknown };
        };
        finish({
          alive: true,
          version: typeof parsed.result?.version === 'string' ? parsed.result.version : undefined,
          protocolVersion:
            typeof parsed.result?.protocolVersion === 'string'
              ? parsed.result.protocolVersion
              : undefined,
        });
      } catch {
        // A response arrived but wasn't parseable — the daemon is alive.
        finish({ alive: true });
      }
    });

    // Per the contract above, anything received counts as alive — a socket
    // error after partial data (reset mid-frame) is still a live daemon.
    client.on('error', () => finish({ alive: buffer.length > 0 }));

    client.on('end', () => finish({ alive: buffer.length > 0 }));
  });
}

/**
 * Health check probe: sends a cheap JSON-RPC request to the daemon socket.
 * Returns `true` if the daemon responds successfully within the timeout.
 *
 * Uses `system.status` which hits the control fast-path (no SQLite) to avoid
 * false negatives during transient database contention.
 *
 * @param socketPath - Path to the UDS socket
 * @param timeoutMs - Timeout in milliseconds (default: 3000)
 */
export async function healthCheckProbe(socketPath: string, timeoutMs = 3000): Promise<boolean> {
  if (!fs.existsSync(socketPath)) return false;

  return new Promise<boolean>((resolve) => {
    const client = net.connect({ path: socketPath });
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        client.destroy();
        resolve(false);
      }
    }, timeoutMs);

    // Send system.status request (control fast-path, no DB access)
    // Omit params to match the established request shape in json-rpc-client.ts
    const rpcRequest = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'system.status',
    };

    client.on('connect', () => {
      client.write(JSON.stringify(rpcRequest) + '\n');
    });

    client.on('data', (_chunk: Buffer) => {
      // Got a response - daemon is alive
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        client.destroy();
        resolve(true);
      }
    });

    client.on('error', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        client.destroy();
        resolve(false);
      }
    });

    client.on('end', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        client.destroy();
        resolve(false);
      }
    });
  });
}

/**
 * Start the health watchdog for the sidecar daemon.
 *
 * After an initial 2s grace period, probes the daemon every 10s with a 3s timeout.
 * Requires 3 consecutive failures before triggering a restart (a successful probe
 * resets the counter). Kill escalation: SIGTERM first, then SIGKILL after 5s if
 * the process hasn't exited.
 *
 * @param socketPath - Path to the UDS socket
 * @param delayMs - Delay before the next probe (default: 2000 for initial grace, 10000 for steady-state)
 */
function startHealthWatchdog(socketPath: string, delayMs = 2000): void {
  // Clear any existing watchdog
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }

  watchdogTimer = setTimeout(async () => {
    if (isShuttingDown || !sidecarProcess) return;

    const isHealthy = await healthCheckProbe(socketPath, 3000);
    if (!isHealthy) {
      consecutiveFailures++;
      logger.warn('Health check failed', { attempt: consecutiveFailures, threshold: 3 });

      if (consecutiveFailures >= 3) {
        logger.warn('Health check failure threshold reached; triggering graceful restart');
        consecutiveFailures = 0; // Reset for next spawn cycle

        // Kill the process with graceful escalation
        // Check if process is still alive before attempting to kill
        if (
          sidecarProcess &&
          sidecarProcess.exitCode === null &&
          sidecarProcess.signalCode === null
        ) {
          const proc = sidecarProcess;

          // Send SIGTERM first
          let sigtermSent = false;
          try {
            sigtermSent = proc.kill('SIGTERM');
            if (sigtermSent) {
              logger.info('Sent SIGTERM to sidecar; waiting 5s for graceful exit');
            } else {
              logger.warn('SIGTERM send returned false (process may have already exited)');
            }
          } catch (err) {
            logger.error('Failed to send SIGTERM to sidecar', { error: err });
          }

          // If SIGTERM failed to send, immediately try SIGKILL
          if (!sigtermSent) {
            try {
              const killed = proc.kill('SIGKILL');
              if (killed) {
                logger.warn('Sent SIGKILL immediately (SIGTERM failed)');
              }
            } catch (err) {
              logger.error('Failed to send SIGKILL to sidecar', { error: err });
            }
            return;
          }

          // Clear any previous kill escalation timer
          if (killEscalationTimer) {
            clearTimeout(killEscalationTimer);
            killEscalationTimer = null;
          }

          // Schedule SIGKILL if process doesn't exit within grace period
          killEscalationTimer = setTimeout(() => {
            // Check both exitCode and signalCode: a process that exited due to a signal
            // has exitCode=null and signalCode set (e.g., 'SIGTERM')
            if (proc.exitCode === null && proc.signalCode === null) {
              logger.warn('Sidecar did not exit gracefully; sending SIGKILL');
              try {
                proc.kill('SIGKILL');
              } catch (err) {
                logger.error('Failed to send SIGKILL to sidecar', { error: err });
              }
            }
            killEscalationTimer = null;
          }, 5000);
        }
        return;
      }

      // Not at threshold yet - schedule next probe
      startHealthWatchdog(socketPath, 10000);
      return;
    }

    // Healthy probe - reset failure counter
    consecutiveFailures = 0;

    // Schedule next probe in 10s (steady-state interval)
    startHealthWatchdog(socketPath, 10000);
  }, delayMs);
}

/**
 * Spawn the sidecar daemon process.
 *
 * Internal helper extracted from startIntentdSidecar for restart path reuse.
 */
async function spawnSidecarProcess(
  binaryPath: string,
  socketPath: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  if (isShuttingDown) return;

  logger.info('Spawning intentd sidecar', { binaryPath, socketPath });

  const spawnEnv = { ...env };
  if (env.INTENTD_DATA_DIR?.trim()) {
    spawnEnv.INTENTD_DATA_DIR = env.INTENTD_DATA_DIR.trim();
  }

  const proc = spawn(binaryPath, ['serve'], {
    env: spawnEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  sidecarProcess = proc;

  // Fresh per-run record for this spawn; the previous record was "the last
  // run" until now. Each handler below closes over its own run's record.
  const runRecord = beginSidecarRunRecord();

  // Initialize restart policy if not already done
  if (!restartPolicy) {
    restartPolicy = new RestartPolicy();
  }
  restartPolicy.onSpawn();

  proc.stdout?.on('data', (chunk: Buffer) => {
    const raw = chunk.toString('utf8');
    appendRunLogLines(runRecord, raw);
    const text = raw.trim();
    if (text) logger.info(`[intentd stdout] ${text}`);
  });

  proc.stderr?.on('data', (chunk: Buffer) => {
    const raw = chunk.toString('utf8');
    appendRunLogLines(runRecord, raw);
    const text = raw.trim();
    if (text) logger.warn(`[intentd stderr] ${text}`);
  });

  proc.on('exit', (code, signal) => {
    logger.info('Sidecar exited', { code, signal });

    flushRunLogPartial(runRecord);
    runRecord.endedAt = new Date().toISOString();
    runRecord.exitCode = code;
    runRecord.signal = signal;

    // Clear watchdog timer, kill escalation timer, and reset failure counter
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
    if (killEscalationTimer) {
      clearTimeout(killEscalationTimer);
      killEscalationTimer = null;
    }
    consecutiveFailures = 0;

    sidecarProcess = null;

    // Consult restart policy
    if (!restartPolicy) return;

    const decision = restartPolicy.onExit(code, signal);
    if (!decision.shouldRestart) {
      logger.info('Not restarting sidecar', { reason: decision.reason });
      // Crash loop (attempts exhausted): surface it to the renderer rather
      // than dying invisibly. Intentional stops carry no `gaveUp` flag.
      if (decision.gaveUp) notifySidecarGaveUp(decision.reason);
      return;
    }

    logger.info('Scheduling sidecar restart', {
      delayMs: decision.delayMs,
      remainingAttempts: decision.remainingAttempts,
      reason: decision.reason,
    });

    // Schedule restart after backoff delay
    restartTimer = setTimeout(async () => {
      restartTimer = null;
      if (isShuttingDown) {
        logger.info('Skipping restart; shutdown in progress');
        return;
      }
      await spawnSidecarProcess(binaryPath, socketPath, env);
      // Start watchdog after successful spawn
      startHealthWatchdog(socketPath);
    }, decision.delayMs);
  });

  proc.on('error', (err: Error) => {
    logger.error('Sidecar process error', err);
    // Node embeds the absolute binary path in spawn errors (e.g.
    // "spawn /path/to/intentd ENOENT"); the run-log/status payloads are
    // renderer-facing and the pinned contract allows no absolute paths except
    // logFilePath — redact the path (full detail stays in the main log above).
    const reason = err.message.split(binaryPath).join('intentd binary');
    runRecord.spawnError = reason;
    // A spawn-time failure (e.g. ENOENT) never assigns a pid and fires no
    // 'exit': close out the record and surface it as a startup failure.
    if (proc.pid === undefined) {
      if (!runRecord.endedAt) runRecord.endedAt = new Date().toISOString();
      notifySidecarStartupFailed(reason);
    }
  });

  // Start the health watchdog after spawning
  startHealthWatchdog(socketPath);
}

/**
 * Start the intentd sidecar if the spawn policy allows it.
 *
 * Before spawning, probes the target socket (version handshake) to adopt an
 * already-running daemon. If spawning, pipes stdout/stderr to the main-process
 * logger and starts supervision.
 *
 * Resolves the connection mode (see `connection-mode.ts`): `sidecar` when we
 * spawn the daemon, `external` when we adopt an already-running daemon or the
 * spawn policy is disabled (env transport override / two-terminal dev flow).
 */
export async function startIntentdSidecar(
  env: NodeJS.ProcessEnv = process.env,
  isPackaged: boolean,
  resourcesPath: string,
  cwd: string,
): Promise<void> {
  const decision = shouldSpawnSidecar(env, isPackaged);
  if (!decision.shouldSpawn) {
    // Not spawning: whatever daemon the FE connects to (env override target,
    // an already-running daemon on the default socket, or the two-terminal
    // dev-daemon flow) is not managed by us.
    setConnectionMode('external');
    logger.info('Sidecar spawn disabled', { reason: decision.reason });
    return;
  }

  const socketPath = resolveSocketPath(env);
  const probe = await probeDaemonVersion(socketPath);
  if (probe.alive) {
    // A live daemon owns the socket (and the data dir behind it): ALWAYS
    // adopt it — never spawn a second daemon alongside. Version mismatch is
    // warn-only, surfaced to the renderer via the transport payload.
    setConnectionMode('external');
    const pinnedVersion = readPinnedVersion({ isPackaged, resourcesPath });
    const comparison =
      probe.version && pinnedVersion
        ? compareToPinnedVersion(probe.version, pinnedVersion)
        : 'unknown';
    const versionMismatch = comparison === 'older' || comparison === 'newer';
    setDaemonVersionInfo({
      daemonVersion: probe.version ?? null,
      pinnedVersion,
      versionMismatch,
    });
    const details = {
      socketPath,
      daemonVersion: probe.version ?? null,
      protocolVersion: probe.protocolVersion ?? null,
      pinnedVersion,
      comparison,
    };
    if (versionMismatch) {
      logger.warn(
        // i18n-ignore (developer log message)
        'Adopted external intentd whose version differs from the pinned version',
        details,
      );
    } else {
      logger.info('Adopted external intentd (no sidecar spawned)', details);
    }
    return;
  }

  const binaryPath = resolveIntentdBinaryPath(env, isPackaged, resourcesPath, cwd);
  if (!binaryPath) {
    // Log every input that fed the decision so the user can tell why we
    // skipped: INTENTD_BIN not pointing at an existing file, the packaged
    // resources path missing the bundled binary, or the dev upward walk from
    // cwd not finding `packages/intentd/target/{release,debug}/intentd`.
    logger.warn('intentd binary not found; skipping sidecar spawn', {
      isPackaged,
      resourcesPath,
      cwd,
      intentdBinEnv: env.INTENTD_BIN ?? null,
    });
    // Sidecar posture but the spawn could not happen at all: record the
    // failed attempt as "the last run" and surface it to the renderer so the
    // daemon-loss UI says the app-managed intentd failed to start instead of
    // falsely claiming it is being restarted.
    const reason = 'intentd binary not found';
    const record = beginSidecarRunRecord();
    record.endedAt = record.startedAt;
    record.spawnError = reason;
    notifySidecarStartupFailed(reason);
    return;
  }

  logger.info('Resolved intentd binary', {
    binaryPath,
    source:
      env.INTENTD_BIN?.trim() === binaryPath ? 'INTENTD_BIN' : isPackaged ? 'packaged' : 'dev',
  });

  isShuttingDown = false;
  setConnectionMode('sidecar');
  await spawnSidecarProcess(binaryPath, socketPath, env);
}

/**
 * Stop the sidecar daemon (if running).
 *
 * Sends SIGTERM, waits for the grace period, then SIGKILL if still alive.
 * Marks as intentional stop to suppress auto-restart.
 */
export async function stopIntentdSidecar(gracePeriodMs = 3000): Promise<void> {
  // Mark shutdown to prevent restarts
  isShuttingDown = true;

  // Clear watchdog timer and reset failure counter
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
  consecutiveFailures = 0;

  // Clear restart timer (quit during pending backoff must not respawn)
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  // Clear kill escalation timer (prevent late SIGKILL during/after shutdown)
  if (killEscalationTimer) {
    clearTimeout(killEscalationTimer);
    killEscalationTimer = null;
  }

  // Mark intentional stop in restart policy
  if (restartPolicy) {
    restartPolicy.markIntentionalStop();
  }

  if (!sidecarProcess) return;

  logger.info('Stopping sidecar daemon...');
  const proc = sidecarProcess;
  sidecarProcess = null;

  if (proc.killed || proc.exitCode !== null) {
    return;
  }

  // Send SIGTERM
  proc.kill('SIGTERM');

  // Wait for graceful exit
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (proc.exitCode === null && !proc.killed) {
        logger.warn('Sidecar did not exit gracefully; sending SIGKILL');
        proc.kill('SIGKILL');
      }
      resolve();
    }, gracePeriodMs);

    proc.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

/**
 * Check if the sidecar is currently running (process spawned and alive).
 */
export function isSidecarRunning(): boolean {
  return sidecarProcess !== null && sidecarProcess.exitCode === null && !sidecarProcess.killed;
}

/** Result of an on-demand sidecar spawn (see [[spawnSidecarOnDemand]]). */
export interface SpawnSidecarOnDemandResult {
  ok: boolean;
  /** True when a new sidecar process was actually spawned. */
  spawned: boolean;
  reason: string;
}

/** In-flight on-demand spawn; concurrent callers share it (spawn exactly once). */
let spawnOnDemandInFlight: Promise<SpawnSidecarOnDemandResult> | null = null;

/**
 * Spawn the app-managed sidecar on demand (user chose the fallback in the
 * daemon-loss UI, #439). Unlike `startIntentdSidecar`, this bypasses the
 * spawn policy — the user explicitly asked for a managed daemon — but keeps
 * the same binary resolution and supervision (restart policy + watchdog) via
 * `spawnSidecarProcess`.
 *
 * SAFETY: re-probes the socket first. If a daemon answers, it owns the socket
 * (and the data dir behind it) — we must NEVER run a second daemon alongside,
 * so we return ok without spawning and let the JSON-RPC client reconnect to
 * the live daemon.
 *
 * Concurrent calls coalesce onto one in-flight attempt so the sidecar is
 * spawned at most once (e.g. double-click on the fallback button).
 *
 * Once mode flips to `sidecar` there is NO mid-session auto-switching back:
 * the JsonRpcClient target (the socket path) is unchanged, so "keep the
 * sidecar" simply means we stay connected to whatever serves that socket.
 */
export function spawnSidecarOnDemand(
  env: NodeJS.ProcessEnv,
  isPackaged: boolean,
  resourcesPath: string,
  cwd: string,
): Promise<SpawnSidecarOnDemandResult> {
  if (spawnOnDemandInFlight) return spawnOnDemandInFlight;
  spawnOnDemandInFlight = doSpawnSidecarOnDemand(env, isPackaged, resourcesPath, cwd).finally(
    () => {
      spawnOnDemandInFlight = null;
    },
  );
  return spawnOnDemandInFlight;
}

async function doSpawnSidecarOnDemand(
  env: NodeJS.ProcessEnv,
  isPackaged: boolean,
  resourcesPath: string,
  cwd: string,
): Promise<SpawnSidecarOnDemandResult> {
  if (isSidecarRunning()) {
    return { ok: true, spawned: false, reason: 'sidecar already running' };
  }
  const socketPath = resolveSocketPath(env);
  if (await healthCheckProbe(socketPath)) {
    setConnectionMode('external');
    logger.info('Spawn-on-demand skipped: a live daemon answers on the socket', { socketPath });
    return { ok: true, spawned: false, reason: 'live daemon already serving the socket' };
  }
  const binaryPath = resolveIntentdBinaryPath(env, isPackaged, resourcesPath, cwd);
  if (!binaryPath) {
    logger.warn('Spawn-on-demand failed: intentd binary not found', {
      isPackaged,
      resourcesPath,
      cwd,
      intentdBinEnv: env.INTENTD_BIN ?? null,
    });
    return { ok: false, spawned: false, reason: 'intentd binary not found' };
  }
  isShuttingDown = false;
  // The mode flips optimistically, before the child proves it owns the
  // socket. If a daemon binds the socket in the probe→spawn window, our child
  // fails to bind and exits while the JsonRpcClient reconnects to that
  // external daemon — leaving a stale `sidecar` mode (transport-info and
  // quit-dialog copy only). Daemon-safe regardless: the quit path's stop
  // branch only signals `sidecarProcess`, which is already null after the
  // child exit, so an external daemon is never signalled.
  setConnectionMode('sidecar');
  await spawnSidecarProcess(binaryPath, socketPath, env);
  return { ok: true, spawned: true, reason: 'sidecar spawned' };
}
