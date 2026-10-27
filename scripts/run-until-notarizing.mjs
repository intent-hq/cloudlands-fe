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
 * Otherwise the command's exit code is passed through (128 + signal number when it
 * was killed by a signal). SIGTERM/SIGINT/SIGHUP sent to this wrapper (a cancelled
 * job; workflows `exec` it so the runner signals it directly) are forwarded to the
 * group. Whenever the group has been signalled, the wrapper waits for every member
 * to exit, up to the grace period, then SIGKILLs any survivors.
 *
 * The marker relies on notarization happening in the afterSign hook. electron-builder's
 * own notarization (enabled by APPLE_ID / APPLE_API_KEY / APPLE_KEYCHAIN_PROFILE env
 * vars) would run before afterSign, so CI sets only the CLOUDLANDS_APPLE_* names.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
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

function groupAlive(child) {
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch {
    return false;
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
  // Where cancellation signals come from (the CLI passes `process`).
  signalSource = null,
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
    // Set once this wrapper has signalled the group (stall or cancellation).
    let terminating = false;
    let killTimer;
    let killDeadline = 0;
    let child;
    const cleanups = [];

    const finish = (code) => {
      if (finished) return;
      finished = true;
      for (const cleanup of cleanups) cleanup();
      rmSync(markerDir, { recursive: true, force: true });
      resolve(code);
    };

    // SIGTERM the group now; SIGKILL whatever is left after the grace period, which
    // gives electron-builder time to remove its temporary keychain and detach DMGs.
    const terminate = (signal) => {
      terminating = true;
      signalGroup(child, signal);
      if (killTimer) return;
      killDeadline = Date.now() + graceMs;
      killTimer = setTimeout(() => signalGroup(child, 'SIGKILL'), graceMs);
    };

    // After the leader exits, wait for the rest of the group (bounded by the grace
    // period plus a margin for the SIGKILL to land) so nothing outlives the wrapper.
    const reapThenFinish = (code) => {
      const poll = setInterval(() => {
        if (groupAlive(child) && Date.now() < killDeadline + 2_000) return;
        clearInterval(poll);
        signalGroup(child, 'SIGKILL');
        finish(code);
      }, 50);
      cleanups.push(() => clearInterval(poll));
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

    const markerTime = () =>
      existsSync(marker) ? readFileSync(marker, 'utf8').trim() || 'marker present' : null;

    log(`Stall deadline: notarization must start within ${budgetMinutes} min.`);
    // One check at the deadline is enough: the marker only ever appears, so a build
    // that reached notarization in time still has it then.
    const cancelDeadline = armDeadline(() => {
      if (finished || terminating) return;
      const at = markerTime();
      if (at) {
        log(`Notarization started in time (${at}); stall deadline disarmed.`);
        return;
      }
      stalled = true;
      log(
        `::error title=macOS packaging stalled::Notarization had not started after ` +
          `${budgetMinutes} min, so the build is assumed frozen and is being stopped; ` +
          `re-run the job. Signed builds normally reach notarization after 9-13 min ` +
          `(unsigned builds never notarize, so for them this bounds the whole build).`,
      );
      terminate('SIGTERM');
    }, budgetMs);
    cleanups.push(cancelDeadline);
    cleanups.push(() => clearTimeout(killTimer));

    if (signalSource) {
      for (const signal of FORWARDED_SIGNALS) {
        const handler = () => terminate(signal);
        signalSource.on(signal, handler);
        cleanups.push(() => signalSource.off(signal, handler));
      }
    }

    child.on('error', (error) => {
      log(`::error title=macOS packaging failed to start::${error.message}`);
      finish(1);
    });

    child.on('exit', (code, signal) => {
      const at = markerTime();
      const result = stalled
        ? STALL_EXIT_CODE
        : signal
          ? 128 + (constants.signals[signal] ?? 0)
          : (code ?? 1);
      log(
        `Packaging ${signal ? `was killed by ${signal}` : `exited with code ${code}`}; ` +
          `notarization ` +
          (at ? `started at ${at}.` : 'never started (unsigned build or failure before it).'),
      );
      if (!terminating && !signal) {
        finish(result);
        return;
      }
      // Signalled or killed: make sure no part of the build outlives the wrapper.
      terminate('SIGTERM');
      reapThenFinish(result);
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
  // exitCode rather than process.exit(): let buffered output (the ::error
  // annotation) drain to the runner's pipe before the process ends.
  process.exitCode = await runUntilNotarizing({
    command: parsed.command,
    args: parsed.args,
    budgetMs: parsed.minutes * 60_000,
    signalSource: process,
  });
}
