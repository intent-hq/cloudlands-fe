#!/usr/bin/env node
/**
 * Plausibility-guarded svelte-check runner (intent-hq/monorepo#2240).
 *
 * svelte-check once completed "successfully" while checking almost nothing:
 * exit 0, 0 errors, instant completion, implausibly low file count. This
 * wrapper runs svelte-check with `--output machine-verbose`, re-prints
 * diagnostics in human-readable form, and fails loudly when the run looks
 * like a silent no-op even though svelte-check exited 0.
 *
 * It also runs `svelte-kit sync` first (intent-hq/monorepo#2378): svelte-check
 * reads whatever `.svelte-kit` typegen a previous dev/build run left behind,
 * so without a sync the generated route unions drift from the current route
 * tree and local results diverge from CI on the same commit.
 */

import { execFileSync, spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Repo has 800+ .svelte files alone; a plausible run checks far more. */
export const MIN_FILES = 500;

const MACHINE_LINE = /^\d+ (.*)$/;
/**
 * The COMPLETED record. Tolerated variants beyond the exact current format
 * (intent-hq/monorepo#4111): trailing whitespace/CR (stripped before this
 * regex runs) and the legacy form that omits the FILES_WITH_PROBLEMS clause.
 * The tail is otherwise anchored: a line cut off after the WARNINGS clause
 * (e.g. `… 2 WARNINGS 1 FI`) is rejected, not read as a completion.
 */
const COMPLETED_LINE =
  /^COMPLETED (\d+) FILES (\d+) ERRORS (\d+) WARNINGS(?: (\d+) FILES_WITH_PROBLEMS)?$/;

/** Parse a COMPLETED record body (the line minus any timestamp prefix). */
function parseCompletedBody(body) {
  const completed = COMPLETED_LINE.exec(body);
  if (!completed) return null;
  return {
    kind: 'completed',
    files: Number(completed[1]),
    errors: Number(completed[2]),
    warnings: Number(completed[3]),
    filesWithProblems: Number(completed[4] ?? 0),
  };
}

/**
 * Parse one machine-verbose output line into a structured event.
 * Returns null for lines that are not machine-format lines.
 */
export function parseMachineLine(line) {
  const trimmed = line.replace(/\s+$/, '');
  const match = MACHINE_LINE.exec(trimmed);
  if (!match) {
    // Recognize the guard-relevant COMPLETED record even without the epoch-ms
    // prefix, in case svelte-check drops or reformats the timestamp. All other
    // prefix-less lines stay passthrough.
    return parseCompletedBody(trimmed);
  }
  const body = match[1];
  const completed = parseCompletedBody(body);
  if (completed) return completed;
  if (body.startsWith('START ')) return { kind: 'start' };
  if (body.startsWith('FAILURE '))
    return { kind: 'failure', message: body.slice('FAILURE '.length) };
  if (body.startsWith('{')) {
    try {
      const diagnostic = JSON.parse(body);
      if (diagnostic.type === 'ERROR' || diagnostic.type === 'WARNING') {
        return { kind: 'diagnostic', diagnostic };
      }
    } catch {
      // fall through to unknown
    }
  }
  return { kind: 'unknown', body };
}

/** Render a machine-verbose diagnostic like svelte-check's human writer. */
export function formatDiagnostic(diagnostic, workspaceDir = process.cwd()) {
  const { type, filename, start, message, source, code } = diagnostic;
  const file = path.isAbsolute(filename) ? path.relative(workspaceDir, filename) : filename;
  const position = start ? `:${start.line + 1}:${start.character + 1}` : '';
  const label = type === 'ERROR' ? 'Error' : 'Warn';
  const origin = source ?? code;
  return `${file}${position}\n${label}: ${message}${origin ? ` (${origin})` : ''}\n`;
}

/**
 * Decide whether a svelte-check run that exited 0 is plausible.
 * Returns a list of guard failure messages (empty when the run is sound).
 */
export function evaluateRun({ exitCode, completed, minFiles = MIN_FILES }) {
  if (exitCode !== 0) return [];
  if (!completed) {
    return [
      'svelte-check exited 0 without reporting a COMPLETED summary — output format changed or the run was cut short.',
    ];
  }
  const failures = [];
  if (completed.files < minFiles) {
    failures.push(
      `svelte-check reported only ${completed.files} checked files (plausibility floor: ${minFiles}). ` +
        'The run likely checked nothing — see intent-hq/monorepo#2240.',
    );
  }
  if (completed.errors > 0) {
    failures.push(`svelte-check exited 0 despite reporting ${completed.errors} errors.`);
  }
  return failures;
}

function resolveBin(packageName, binName) {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve(`${packageName}/package.json`);
  const pkg = require(`${packageName}/package.json`);
  const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin[binName];
  return path.join(path.dirname(pkgPath), binRel);
}

/**
 * Environment for the typegen sync. svelte.config.js resolves the routes
 * directory from NODE_ENV (production builds sync against the filtered
 * `.svelte-kit/production-routes` copy, which excludes sandbox/test routes),
 * while svelte-check always checks `src/routes`. Force development so the
 * generated route unions match the tree being checked, regardless of what a
 * prior build left in NODE_ENV or `.svelte-kit`.
 */
export function syncEnv(env = process.env) {
  return { ...env, NODE_ENV: 'development' };
}

async function syncSvelteKitTypes() {
  const child = spawn(process.execPath, [resolveBin('@sveltejs/kit', 'svelte-kit'), 'sync'], {
    stdio: 'inherit',
    env: syncEnv(),
  });
  const exitCode = await new Promise((resolve) => {
    child.on('close', (code, signal) => {
      if (code === null && signal) console.error(`svelte-kit sync died with ${signal}`);
      resolve(code ?? 1);
    });
  });
  if (exitCode !== 0) {
    console.error(`svelte-kit sync failed with exit code ${exitCode} — route typegen is stale.`);
    process.exit(exitCode);
  }
}

/**
 * Line consumer for the machine-verbose stream: re-prints diagnostics and
 * passthrough lines, and records the COMPLETED summary when one is seen.
 */
export function createOutputCollector({
  print = console.log,
  printError = console.error,
  workspaceDir = process.cwd(),
} = {}) {
  const state = { completed: null };
  return {
    get completed() {
      return state.completed;
    },
    handleLine(line) {
      const event = parseMachineLine(line);
      if (!event) {
        print(line);
        return;
      }
      if (event.kind === 'diagnostic') {
        print(formatDiagnostic(event.diagnostic, workspaceDir));
      } else if (event.kind === 'completed') {
        state.completed = event;
      } else if (event.kind === 'failure') {
        printError(`svelte-check failure: ${event.message}`);
      } else if (event.kind === 'unknown') {
        print(event.body);
      }
    },
  };
}

/**
 * Resident set size of a live process in MiB, or null when unavailable. On
 * Linux this is the kernel-tracked high-water mark (`VmHWM`), so a sample
 * taken shortly before the process exits is its true peak; elsewhere `ps`
 * reports the current RSS and the caller keeps the max of its samples.
 */
export function readRssMiB(pid, platform = process.platform) {
  if (!pid) return null;
  try {
    const kib =
      platform === 'linux'
        ? /^VmHWM:\s+(\d+) kB$/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1]
        : execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          }).trim();
    return kib ? Math.round(Number(kib) / 1024) : null;
  } catch {
    return null;
  }
}

/**
 * The V8 old-space cap the checker will run under (last `--max-old-space-size`
 * across NODE_OPTIONS and CT_NODE_ARGS), in MB, or null when none is set.
 */
export function heapCapMB(env = process.env) {
  const flags = `${env.NODE_OPTIONS ?? ''} ${env.CT_NODE_ARGS ?? ''}`;
  const matches = [...flags.matchAll(/--max-old-space-size=(\d+)/g)];
  return matches.length > 0 ? Number(matches[matches.length - 1][1]) : null;
}

/**
 * One-line peak-memory report for the run (intent-hq/intent#5211): svelte-check
 * holds the whole renderer type graph live, so its peak creeps up with the
 * codebase and only became visible when it hit the CI heap cap. Printing the
 * peak every run keeps the margin observable before the next OOM.
 */
export function formatPeakRss(peakRssMiB, env = process.env) {
  if (peakRssMiB === null) return null;
  const cap = heapCapMB(env);
  const capNote = cap === null ? 'no --max-old-space-size set' : `--max-old-space-size=${cap}`;
  return `svelte-check peak RSS: ${peakRssMiB} MiB (${capNote})`;
}

/** Env var naming the file the child's exit hook writes its maxRSS (KiB) to. */
export const RSS_FILE_ENV = 'SVELTE_CHECK_RSS_FILE';
const RSS_FILE = 'max-rss';
const FATAL_REPORT_FILE = 'fatal-report.json';
const RSS_EXIT_HOOK = `data:text/javascript,${encodeURIComponent(
  `import { writeFileSync } from 'node:fs';
process.on('exit', () => {
  try {
    writeFileSync(process.env[${JSON.stringify(RSS_FILE_ENV)}], String(process.resourceUsage().maxRSS));
  } catch {}
});`,
)}`;

/**
 * Node flags that make the child record its own peak RSS into `probeDir`: an
 * exit hook for normal exits (`process.exit` included) and a diagnostic report
 * for V8 fatal errors such as a heap-limit OOM abort, which skips exit hooks.
 * The parent cannot read the peak after the fact — by the time `close` fires
 * the child is reaped and /proc/<pid> is gone — so the child has to leave it.
 */
export function rssProbeArgs(probeDir) {
  return [
    '--import',
    RSS_EXIT_HOOK,
    '--report-on-fatalerror',
    `--report-directory=${probeDir}`,
    `--report-filename=${FATAL_REPORT_FILE}`,
  ];
}

/** Peak RSS in MiB the child left in `probeDir`, or null when it left nothing. */
export function readProbedRssMiB(probeDir) {
  let peak = null;
  try {
    const kib = Number(readFileSync(path.join(probeDir, RSS_FILE), 'utf8'));
    if (kib > 0) peak = Math.round(kib / 1024);
  } catch {
    // no normal exit
  }
  try {
    const bytes = JSON.parse(readFileSync(path.join(probeDir, FATAL_REPORT_FILE), 'utf8'))
      ?.resourceUsage?.maxRss;
    if (bytes > 0) peak = Math.max(peak ?? 0, Math.round(bytes / (1024 * 1024)));
  } catch {
    // no fatal error
  }
  return peak;
}

/**
 * Spawn the checker with optional space-separated CT_NODE_ARGS (no shell
 * quoting). Resolves with the exit code and the child's peak RSS in MiB: the
 * high-water mark the child records itself on exit or fatal abort (see
 * `rssProbeArgs`), combined with /proc or ps samples taken right after spawn
 * and every `sampleIntervalMs`. A SIGKILL (e.g. the kernel OOM killer) runs
 * neither the exit hook nor the fatal report, so only the sampled value
 * remains: that fallback is a lower bound that can miss the final peak, and a
 * kill within the first interval reports the spawn-time sample only. Null when
 * no source produced one.
 */
export function runSvelteCheck({
  cliPath,
  args,
  outputFd,
  env = process.env,
  spawnImpl = spawn,
  printError = console.error,
  sampleRss = readRssMiB,
  sampleIntervalMs = 1000,
  probeDir = mkdtempSync(path.join(tmpdir(), 'cloudlands-svelte-check-rss-')),
}) {
  const flags = env.CT_NODE_ARGS?.trim().split(/\s+/).filter(Boolean) ?? [];
  const child = spawnImpl(
    process.execPath,
    [...rssProbeArgs(probeDir), ...flags, cliPath, ...args],
    {
      stdio: ['inherit', outputFd, 'inherit'],
      env: { ...syncEnv(env), [RSS_FILE_ENV]: path.join(probeDir, RSS_FILE) },
    },
  );
  let peakRssMiB = null;
  const sample = () => {
    const rss = sampleRss(child.pid);
    if (rss !== null && (peakRssMiB === null || rss > peakRssMiB)) peakRssMiB = rss;
  };
  const timer = setInterval(sample, sampleIntervalMs);
  timer.unref?.();
  sample();
  const finish = (exitCode) => {
    clearInterval(timer);
    const probed = readProbedRssMiB(probeDir);
    rmSync(probeDir, { recursive: true, force: true });
    if (probed !== null && (peakRssMiB === null || probed > peakRssMiB)) peakRssMiB = probed;
    return { exitCode, peakRssMiB };
  };
  return new Promise((resolve) => {
    child.on('error', (error) => {
      printError(`svelte-check failed to spawn: ${error.message}`);
      resolve(finish(1));
    });
    child.on('close', (code, signal) => {
      if (code === null && signal) printError(`svelte-check died with ${signal}`);
      resolve(finish(code ?? 1));
    });
  });
}

async function main() {
  await syncSvelteKitTypes();
  const args = [
    '--tsgo',
    '--tsconfig',
    './tsconfig.json',
    '--output',
    'machine-verbose',
    '--threshold',
    'error',
    ...process.argv.slice(2),
  ];
  const outputDir = mkdtempSync(path.join(tmpdir(), 'cloudlands-svelte-check-'));
  const outputPath = path.join(outputDir, 'output.ndjson');
  const outputFd = openSync(outputPath, 'w');
  const { exitCode, peakRssMiB } = await runSvelteCheck({
    cliPath: resolveBin('svelte-check', 'svelte-check'),
    args,
    outputFd,
  });
  closeSync(outputFd);
  const lines = readFileSync(outputPath, 'utf8').split(/\r?\n/);
  rmSync(outputDir, { recursive: true });
  const collector = createOutputCollector();
  for (const line of lines) {
    if (line) collector.handleLine(line);
  }

  const completed = collector.completed;
  if (completed) {
    console.log(
      `svelte-check found ${completed.errors} errors and ${completed.warnings} warnings ` +
        `in ${completed.filesWithProblems} files (checked ${completed.files} files)`,
    );
  }
  const peakReport = formatPeakRss(peakRssMiB);
  if (peakReport) console.log(peakReport);

  const guardFailures = evaluateRun({ exitCode, completed });
  for (const failure of guardFailures) {
    console.error(`\nPLAUSIBILITY GUARD: ${failure}`);
  }
  process.exit(exitCode !== 0 ? exitCode : guardFailures.length > 0 ? 1 : 0);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  await main();
}
