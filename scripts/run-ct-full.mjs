#!/usr/bin/env node
/**
 * Full local Playwright CT run: `pnpm run test:ct:full [-- <playwright args>]`.
 *
 * One unsharded CT run exhausts the heap, so a full local run is the CI
 * required lane's four shards executed one after another. Before this script
 * every agent hand-wrote that loop, raised the heap by hand and grepped
 * multi-megabyte logs for the result; on cloudlands-fe#3752 the run took
 * 2h12m (shards 38.8m, 39.2m, 25.7m, 28.1m; 2,248 tests) and outlived its 2h
 * watch.
 *
 * Each shard runs through scripts/run-ct-tests.mjs, so it keeps that
 * launcher's CT-aligned CLI, heap default, i18n preflight and strict flaky
 * policy. This script adds:
 *   - the `ct-<CT_PORT>` lock held once for the whole run (passed to the
 *     shards through HELD_LOCK_ENV), so another worktree cannot take the port
 *     between shards;
 *   - the required-lane filter (`--grep-invert '@quarantine\b'`) unless the
 *     caller passes its own `--grep-invert`;
 *   - one folder per shard holding `output.log`, `results.json`, `html/` and
 *     `test-results/` (Playwright clears its output dir per run, so a shared
 *     one would lose earlier shards' failure traces);
 *   - every shard runs even after a failure; the run ends with one line per
 *     shard, the failed/flaky cases, a total line and `summary.json`;
 *   - exit 0 only when every shard passed, 1 otherwise, 128+signal when
 *     interrupted (the current shard is stopped, the rest are skipped).
 */
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { casesFromJsonReport, casesFromListLog } from './ct-run-failures-lib.mjs';
import { acquireCtPortLock } from './run-ct-tests.mjs';
import { HELD_LOCK_ENV, ctLockKey, ctPort } from './verification-lock.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_LAUNCHER = path.join(repoRoot, 'scripts', 'run-ct-tests.mjs');

export const DEFAULT_SHARDS = 4;
export const DEFAULT_OUT_ROOT = 'ct-full-runs';
export const DEFAULT_HEARTBEAT_MINUTES = 5;
export const QUARANTINE_FILTER = ['--grep-invert', '@quarantine\\b'];
/** Exit code of a launcher whose Playwright child died of SIGABRT (V8 heap exhaustion). */
const HEAP_EXHAUSTION_EXIT = 134;
const PREFIX = '[ct-full]';
/** How long output may keep arriving after the launcher exits before the shard is closed. */
const STDIO_DRAIN_MS = 5_000;

/** Playwright options this runner owns per shard; a caller value would break the per-shard layout. */
const OWNED_OPTIONS = [
  { name: '--shard', hint: 'use --shards=N to change the shard count' },
  { name: '--reporter', hint: 'each shard writes list, html and json reports' },
  { name: '--output', alias: '-o', hint: 'use --out-dir to move the run folder' },
];

export class UsageError extends Error {}

export function usage() {
  return [
    'Usage: pnpm run test:ct:full [-- [options] [<playwright test args>]]',
    '',
    'Runs the whole Playwright CT suite as sequential shards through',
    'scripts/run-ct-tests.mjs (heap default, i18n preflight, strict flaky policy),',
    "mirroring CI's required lane. Expect about 2h15m on the shared daemon host",
    '(shards take 25-40 min each); give any watch or monitor at least 3h.',
    '',
    'Options:',
    `  --shards=N          Number of shards (default ${DEFAULT_SHARDS}).`,
    `  --out-dir=DIR       Run folder (default ${DEFAULT_OUT_ROOT}/<UTC timestamp>).`,
    "  --stream            Also echo every shard's output live (default: logs only).",
    `  --heartbeat=MIN     Progress line every MIN minutes while a shard runs`,
    `                      (default ${DEFAULT_HEARTBEAT_MINUTES}; 0 disables).`,
    '  --help, -h          Show this help.',
    '',
    'Other arguments are forwarded to every shard (e.g. --list, a spec path, --grep).',
    `Unless one is given, "${QUARANTINE_FILTER.join(' ')}" is added, as in CI.`,
    '--shard, --reporter and --output are owned by this runner.',
    '',
    'Per shard: <run>/shard-<i>/{output.log,results.json,html/,test-results/}.',
    'The run ends with one line per shard, failed/flaky cases and a total line,',
    'and writes <run>/summary.json. Every shard runs even after a failure.',
    'Exit: 0 all shards passed; 1 any shard failed or crashed; 128+n on signal n.',
    '',
    'The ct-<CT_PORT> lock is held for the whole run; set CT_PORT to a free port',
    'to keep the default port available to other worktrees.',
  ].join('\n');
}

function positiveInteger(raw, option) {
  if (!/^\d+$/.test(raw ?? ''))
    throw new UsageError(`${option} expects a whole number, got "${raw}"`);
  return Number(raw);
}

/**
 * Split this runner's options from the args forwarded to every shard. A
 * leading `--` (pnpm's separator) is dropped. Options own the `--x=value` and
 * `--x value` spellings; Playwright-owned options are rejected (see
 * OWNED_OPTIONS).
 */
export function parseFullArgs(argv) {
  const args = [...argv];
  if (args[0] === '--') args.shift();
  const options = {
    shards: DEFAULT_SHARDS,
    outDir: null,
    stream: false,
    heartbeatMinutes: DEFAULT_HEARTBEAT_MINUTES,
    help: false,
    forwarded: [],
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const [name, inline] = arg.startsWith('--') ? splitOption(arg) : [arg, undefined];
    const value = () => {
      if (inline !== undefined) return inline;
      if (i + 1 >= args.length) throw new UsageError(`${name} expects a value`);
      return args[++i];
    };
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (name === '--shards') {
      options.shards = positiveInteger(value(), '--shards');
      if (options.shards < 1) throw new UsageError('--shards must be at least 1');
    } else if (name === '--out-dir') options.outDir = value();
    else if (arg === '--stream') options.stream = true;
    else if (name === '--heartbeat')
      options.heartbeatMinutes = positiveInteger(value(), '--heartbeat');
    else {
      const owned = OWNED_OPTIONS.find((o) => o.name === name || (o.alias && arg === o.alias));
      if (owned)
        throw new UsageError(`${owned.name} is set per shard by this runner; ${owned.hint}`);
      options.forwarded.push(arg);
    }
  }
  return options;
}

function splitOption(arg) {
  const eq = arg.indexOf('=');
  return eq < 0 ? [arg, undefined] : [arg.slice(0, eq), arg.slice(eq + 1)];
}

/** Whether `forwarded` already chooses an inverted grep (so the quarantine default stays out). */
export function hasGrepInvert(forwarded) {
  return forwarded.some((arg) => arg === '--grep-invert' || arg.startsWith('--grep-invert='));
}

/** `--list` runs only enumerate tests: Playwright reports every listed test as skipped. */
export function isListOnly(forwarded) {
  return forwarded.includes('--list');
}

/** Launcher arguments for one shard. */
export function shardArgs({ shard, shards, shardDir, forwarded }) {
  return [
    `--shard=${shard}/${shards}`,
    '--reporter=list,html,json',
    `--output=${path.join(shardDir, 'test-results')}`,
    ...(hasGrepInvert(forwarded) ? [] : QUARANTINE_FILTER),
    ...forwarded,
  ];
}

/** Child environment for one shard: per-shard report paths and the held port lock. */
export function shardEnv({ env, shardDir, lockKey }) {
  return {
    ...env,
    PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(shardDir, 'results.json'),
    PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(shardDir, 'html'),
    [HELD_LOCK_ENV]: lockKey,
  };
}

/** `2026-10-27T08-40-05Z` — sortable, and safe in every file system. */
export function runStamp(date) {
  return date
    .toISOString()
    .replace(/\.\d+Z$/, 'Z')
    .replaceAll(':', '-');
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/** Test counts from a Playwright JSON report's `stats`, or null when absent. */
export function countsFromReport(report, { listOnly = false } = {}) {
  const stats = report?.stats;
  if (!stats || typeof stats !== 'object') return null;
  const n = (key) => (Number.isFinite(stats[key]) ? stats[key] : 0);
  if (listOnly) return { listed: n('expected') + n('unexpected') + n('flaky') + n('skipped') };
  return {
    passed: n('expected'),
    failed: n('unexpected'),
    flaky: n('flaky'),
    skipped: n('skipped'),
  };
}

/**
 * Classify one finished shard. `report` is the parsed results.json (or null),
 * `logText` the shard's output (used for failed/flaky cases when the JSON
 * report is missing, e.g. after a crash).
 */
export function summarizeShard({
  shard,
  shards,
  exitCode,
  durationMs,
  report,
  logText,
  logPath,
  interrupted = false,
  listOnly = false,
}) {
  const counts = countsFromReport(report, { listOnly });
  const fromJson = report ? casesFromJsonReport(report) : null;
  const cases = fromJson ?? casesFromListLog(logText ?? '');
  let status = exitCode === 0 ? 'pass' : 'fail';
  let note;
  // A shard that completed cleanly before the signal reached it still passed.
  if (interrupted && exitCode !== 0) {
    status = 'interrupted';
    note = 'stopped by signal';
  } else if (exitCode === HEAP_EXHAUSTION_EXIT) {
    note = 'crashed: likely heap exhaustion (exit 134), not a test result; see log';
  } else if (exitCode !== 0 && !report) {
    note = 'no JSON report (setup, lock or build failure?); see log';
  }
  return {
    shard,
    shards,
    status,
    exitCode,
    durationMs,
    counts,
    cases,
    casesSource: fromJson ? 'json' : cases.length ? 'log' : null,
    logPath,
    ...(note ? { note } : {}),
  };
}

function formatCounts(counts) {
  if (!counts) return 'counts unavailable';
  if ('listed' in counts) return `${counts.listed} listed`;
  return `${counts.passed} passed, ${counts.failed} failed, ${counts.flaky} flaky, ${counts.skipped} skipped`;
}

const STATUS_LABEL = { pass: 'PASS', fail: 'FAIL', interrupted: 'STOP', 'not-run': 'SKIP' };

/** One summary line for a shard result (or a `not-run` placeholder). */
export function formatShardLine(result) {
  const label = STATUS_LABEL[result.status].padEnd(4);
  const head = `${PREFIX} shard ${result.shard}/${result.shards} ${label}`;
  if (result.status === 'not-run') return `${head} not run`;
  const parts = [
    `exit ${result.exitCode}`,
    formatDuration(result.durationMs),
    formatCounts(result.counts),
  ];
  if (result.note) parts.push(result.note);
  parts.push(`log ${result.logPath}`);
  return `${head} ${parts.join(' | ')}`;
}

/** Totals across shards; counts are null when any finished shard lacks them. */
export function totals(results, { listOnly = false } = {}) {
  const ran = results.filter((r) => r.status !== 'not-run');
  const passedShards = ran.filter((r) => r.status === 'pass').length;
  const durationMs = ran.reduce((sum, r) => sum + r.durationMs, 0);
  let counts = null;
  if (ran.length && ran.every((r) => r.counts)) {
    const keys = listOnly ? ['listed'] : ['passed', 'failed', 'flaky', 'skipped'];
    counts = Object.fromEntries(
      keys.map((key) => [key, ran.reduce((sum, r) => sum + (r.counts[key] ?? 0), 0)]),
    );
  }
  const ok = results.length > 0 && results.every((r) => r.status === 'pass');
  return { ok, passedShards, shardCount: results.length, durationMs, counts };
}

/** The final report printed after the last shard. */
export function formatSummary(results, { runDir, wallMs, listOnly = false }) {
  const total = totals(results, { listOnly });
  const lines = [`${PREFIX} ===== summary (${runDir}) =====`];
  for (const result of results) lines.push(formatShardLine(result));
  const cases = results.flatMap((r) => r.cases?.map((c) => ({ ...c, shard: r.shard })) ?? []);
  for (const status of ['failed', 'flaky']) {
    const matching = cases.filter((c) => c.status === status);
    if (!matching.length) continue;
    lines.push(`${PREFIX} ${status} (${matching.length}):`);
    for (const c of matching)
      lines.push(`${PREFIX}   [shard ${c.shard}] ${c.location} › ${c.title}`);
  }
  lines.push(
    `${PREFIX} total: ${total.ok ? 'PASS' : 'FAIL'} — ${total.passedShards}/${total.shardCount} shards passed` +
      ` | ${formatCounts(total.counts)} | ${formatDuration(wallMs)}`,
  );
  return lines.join('\n');
}

/** Highest finished-test ordinal and total seen so far in a list-reporter stream. */
export function createProgressTracker() {
  let done = 0;
  let total = null;
  let pending = '';
  return {
    push(chunk) {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        const running = /Running (\d+) tests? using/.exec(line);
        if (running) total = Number(running[1]);
        const result = /^\s+\S+\s+(\d+) \[[^\]]*\] › /.exec(line);
        if (result) done = Math.max(done, Number(result[1]));
      }
    },
    get done() {
      return done;
    },
    get total() {
      return total;
    },
  };
}

/**
 * Run one shard: spawn the launcher, tee its output into `logPath` (and the
 * console when `stream`), and resolve to `{ exitCode, durationMs }`.
 * `onChild` receives the child so signals can be forwarded.
 */
export function runShard({
  launcher = DEFAULT_LAUNCHER,
  args,
  env,
  cwd = repoRoot,
  logPath,
  stream = false,
  heartbeatMs = 0,
  label,
  spawnImpl = spawn,
  now = Date.now,
  stdout = process.stdout,
  stderr = process.stderr,
  onChild = () => {},
}) {
  return new Promise((resolve) => {
    const started = now();
    const log = createWriteStream(logPath);
    const progress = createProgressTracker();
    const child = spawnImpl(process.execPath, [launcher, ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    onChild(child);
    const pipe = (source, echo) => {
      source?.setEncoding?.('utf8');
      source?.on('data', (chunk) => {
        log.write(chunk);
        progress.push(chunk);
        if (stream) echo.write(chunk);
      });
    };
    pipe(child.stdout, stdout);
    pipe(child.stderr, stderr);
    const timer =
      heartbeatMs > 0
        ? setInterval(() => {
            const of = progress.total ? `/${progress.total}` : '';
            stderr.write(
              `${PREFIX} ${label} running ${formatDuration(now() - started)}; ` +
                `${progress.done}${of} tests reported\n`,
            );
          }, heartbeatMs)
        : null;
    timer?.unref?.();
    let settled = false;
    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      if (timer) clearInterval(timer);
      const durationMs = now() - started;
      log.end(() => resolve({ exitCode, durationMs }));
    };
    child.on('error', (error) => {
      log.write(`${PREFIX} failed to spawn the launcher: ${error.message}\n`);
      finish(1);
    });
    const exitCode = (code, signal) => {
      if (code !== null || !signal) return code ?? 1;
      const number = os.constants.signals[signal];
      return number ? 128 + number : 1;
    };
    child.on('close', (code, signal) => finish(exitCode(code, signal)));
    // `close` waits for stdio to drain; a leaked grandchild holding the pipes
    // open must not hang the run after the launcher itself has exited.
    child.on('exit', (code, signal) => {
      setTimeout(() => finish(exitCode(code, signal)), STDIO_DRAIN_MS).unref?.();
    });
  });
}

function readJson(file) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  } catch {
    return null;
  }
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/**
 * The whole run. Resolves to the process exit code. Everything with a side
 * effect outside the run folder is injectable for tests.
 */
export async function runFull({
  argv,
  env = process.env,
  cwd = repoRoot,
  launcher = DEFAULT_LAUNCHER,
  spawnImpl = spawn,
  acquireLock = acquireCtPortLock,
  now = Date.now,
  date = () => new Date(),
  stdout = process.stdout,
  stderr = process.stderr,
  proc = process,
}) {
  let options;
  try {
    options = parseFullArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    stderr.write(`${PREFIX} ${error.message}\n${usage()}\n`);
    return 2;
  }
  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const runDir = path.resolve(cwd, options.outDir ?? path.join(DEFAULT_OUT_ROOT, runStamp(date())));
  mkdirSync(runDir, { recursive: true });
  const listOnly = isListOnly(options.forwarded);
  const say = (line) => stderr.write(`${line}\n`);
  // Print paths relative to the package so per-shard lines stay readable.
  const shown = (file) => path.relative(cwd, file) || '.';

  const lockKey = ctLockKey(env);
  let releaseLock;
  try {
    releaseLock = await acquireLock({ env, cwd, log: say });
  } catch (error) {
    say(
      `${PREFIX} ${error instanceof Error ? error.message : error}\n` +
        `${PREFIX} another CT run owns port ${ctPort(env)}; wait for it or set a free CT_PORT`,
    );
    return 1;
  }

  let interrupted = null;
  let current = null;
  let killTimer = null;
  const onSignal = (signal) => {
    if (interrupted) {
      current?.kill('SIGKILL');
      return;
    }
    interrupted = signal;
    say(`${PREFIX} ${signal}: stopping the current shard; remaining shards will not run`);
    current?.kill(signal);
    killTimer = setTimeout(() => current?.kill('SIGKILL'), 15_000);
    killTimer.unref?.();
  };
  proc.on('SIGINT', onSignal);
  proc.on('SIGTERM', onSignal);

  const wallStarted = now();
  const results = [];
  say(`${PREFIX} ${options.shards} shards, run folder ${shown(runDir)}`);
  try {
    for (let shard = 1; shard <= options.shards; shard++) {
      if (interrupted) {
        results.push({ shard, shards: options.shards, status: 'not-run', cases: [] });
        continue;
      }
      const shardDir = path.join(runDir, `shard-${shard}`);
      mkdirSync(shardDir, { recursive: true });
      const logPath = path.join(shardDir, 'output.log');
      const label = `shard ${shard}/${options.shards}`;
      say(`${PREFIX} ${label} started; log ${shown(logPath)}`);
      const { exitCode, durationMs } = await runShard({
        launcher,
        args: shardArgs({ shard, shards: options.shards, shardDir, forwarded: options.forwarded }),
        env: shardEnv({ env, shardDir, lockKey }),
        cwd,
        logPath,
        stream: options.stream,
        heartbeatMs: options.heartbeatMinutes * 60_000,
        label,
        spawnImpl,
        now,
        stdout,
        stderr,
        onChild: (child) => {
          current = child;
        },
      });
      current = null;
      const result = summarizeShard({
        shard,
        shards: options.shards,
        exitCode,
        durationMs,
        report: readJson(path.join(shardDir, 'results.json')),
        logText: readText(logPath),
        logPath: shown(logPath),
        interrupted: Boolean(interrupted),
        listOnly,
      });
      results.push(result);
      say(formatShardLine(result));
    }
  } finally {
    if (killTimer) clearTimeout(killTimer);
    proc.off('SIGINT', onSignal);
    proc.off('SIGTERM', onSignal);
    releaseLock();
  }

  const wallMs = now() - wallStarted;
  const total = totals(results, { listOnly });
  writeFileSync(
    path.join(runDir, 'summary.json'),
    `${JSON.stringify({ ok: total.ok, interrupted, runDir, cwd, forwarded: options.forwarded, wallMs, totals: total, shards: results }, null, 2)}\n`,
  );
  stdout.write(`${formatSummary(results, { runDir: shown(runDir), wallMs, listOnly })}\n`);
  stdout.write(`${PREFIX} summary.json: ${shown(path.join(runDir, 'summary.json'))}\n`);
  if (interrupted) {
    const number = os.constants.signals[interrupted];
    return number ? 128 + number : 1;
  }
  return total.ok ? 0 : 1;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runFull({ argv: process.argv.slice(2) }).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`${PREFIX} ${error instanceof Error ? error.stack : error}`);
      process.exitCode = 1;
    },
  );
}
