#!/usr/bin/env node
/**
 * Pre-notarization stall deadline for signed macOS CI builds.
 *
 *   node scripts/run-until-notarizing.mjs --minutes 30 -- pnpm run dist:mac --arm64 ...
 *
 * Runs the command in its own process group and hands it a marker path in
 * INTENT_NOTARIZE_STARTED_FILE; scripts/notarize.js (the electron-builder afterSign
 * hook) creates that file just before it submits to Apple. If the marker has not
 * appeared within the budget, the whole group is stopped (SIGTERM, then SIGKILL) and
 * this exits 124 with a GitHub ::error:: annotation. If it has appeared, the
 * deadline is disarmed: Apple's notarization queue can legitimately take an hour
 * (v2.210.5 waited 64 min), so only the job-level timeout bounds that phase.
 *
 * Why: release-alpha v2.239.0 (run 40371932624) froze in electron-builder right after
 * "detected workspace root" and sat silent for 81 min until the 90-min job timeout.
 * The phase before notarization takes 9-13 min on WarpBuild Apple Silicon runners.
 *
 * Otherwise the command's exit code is passed through. SIGTERM/SIGINT/SIGHUP sent to
 * this wrapper (a cancelled job) are forwarded to the group.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER_ENV = 'INTENT_NOTARIZE_STARTED_FILE';
export const STALL_EXIT_CODE = 124;
const USAGE = 'usage: run-until-notarizing.mjs --minutes <n> -- <command> [args...]';
const FORWARDED_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'];

export function parseArguments(argv) {
  const separator = argv.indexOf('--');
  if (separator === -1 || separator === argv.length - 1) throw new Error(USAGE);
  const options = argv.slice(0, separator);
  if (options.length !== 2 || options[0] !== '--minutes') throw new Error(USAGE);
  const minutes = Number(options[1]);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error(USAGE);
  const [command, ...args] = argv.slice(separator + 1);
  return { minutes, command, args };
}

function signalGroup(child, signal) {
  try {
    // Negative pid: the whole process group (the child was spawned detached).
    process.kill(-child.pid, signal);
  } catch {
    // Group already gone.
  }
}

/**
 * @returns {Promise<number>} the exit code this wrapper should exit with.
 */
export function runUntilNotarizing({
  command,
  args = [],
  budgetMs,
  graceMs = 30_000,
  env = process.env,
  stdio = 'inherit',
  log = (line) => console.log(line),
  forwardSignals = false,
  // Test seam: schedules the stall check; returns a cancel function.
  armDeadline = (callback, ms) => {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
}) {
  const markerDir = mkdtempSync(path.join(tmpdir(), 'intent-notarize-started-'));
  const marker = path.join(markerDir, 'started');
  const budgetMinutes = Math.round((budgetMs / 60_000) * 100) / 100;

  return new Promise((resolve) => {
    let stalled = false;
    let finished = false;
    let killTimer;
    let child;
    const cleanups = [];

    const finish = (code) => {
      if (finished) return;
      finished = true;
      for (const cleanup of cleanups) cleanup();
      rmSync(markerDir, { recursive: true, force: true });
      resolve(code);
    };

    try {
      child = spawn(command, args, {
        stdio,
        env: { ...env, [MARKER_ENV]: marker },
        detached: true,
      });
    } catch (error) {
      log(`::error title=macOS packaging failed to start::${error.message}`);
      finish(1);
      return;
    }

    // One check at the deadline is enough: the marker only ever appears, so a build
    // that reached notarization in time still has it then.
    const cancelDeadline = armDeadline(() => {
      if (finished) return;
      if (existsSync(marker)) {
        const at = readFileSync(marker, 'utf8').trim();
        log(`Notarization started in time (${at || 'marker present'}); stall deadline disarmed.`);
        return;
      }
      stalled = true;
      log(
        `::error title=macOS packaging stalled::No progress to notarization after ` +
          `${budgetMinutes} min: the build froze before notarization started ` +
          `(it normally starts after 9-13 min). Stopping it; re-run the job.`,
      );
      signalGroup(child, 'SIGTERM');
      killTimer = setTimeout(() => signalGroup(child, 'SIGKILL'), graceMs);
    }, budgetMs);
    cleanups.push(cancelDeadline);
    cleanups.push(() => clearTimeout(killTimer));

    if (forwardSignals) {
      for (const signal of FORWARDED_SIGNALS) {
        const handler = () => {
          signalGroup(child, signal);
          clearTimeout(killTimer);
          killTimer = setTimeout(() => signalGroup(child, 'SIGKILL'), graceMs);
        };
        process.on(signal, handler);
        cleanups.push(() => process.off(signal, handler));
      }
    }

    child.on('error', (error) => {
      log(`::error title=macOS packaging failed to start::${error.message}`);
      finish(1);
    });

    child.on('exit', (code, signal) => {
      if (stalled) {
        // Clear anything that outlived the group leader.
        signalGroup(child, 'SIGKILL');
        finish(STALL_EXIT_CODE);
        return;
      }
      if (signal) {
        // Leader died from a signal: make sure no stragglers keep the job alive.
        signalGroup(child, 'SIGKILL');
        finish(1);
        return;
      }
      finish(code ?? 1);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let parsed;
  try {
    parsed = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  const code = await runUntilNotarizing({
    command: parsed.command,
    args: parsed.args,
    budgetMs: parsed.minutes * 60_000,
    forwardSignals: true,
  });
  process.exit(code);
}
