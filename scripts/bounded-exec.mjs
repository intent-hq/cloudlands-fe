/**
 * Run a command with a hard deadline, killing its whole process tree when the
 * deadline passes, and retry timed-out attempts a bounded number of times.
 *
 * Why: `xcrun actool` (scripts/build-macos-icon.js, via the beforePack hook)
 * normally finishes in ~2 s but hung silently on WarpBuild macOS runners until the
 * 30-min run-until-notarizing deadline killed the release build (release-alpha
 * runs 42434129706, 42410996247, 42246111547). An attempt that times out is
 * retried; a command that fails on its own is not, because that failure is real.
 */
import { spawn } from 'node:child_process';
import { descendantsOf, isAlive, listProcesses, signal } from './process-tree.mjs';

export class CommandTimeoutError extends Error {
  constructor(label, timeoutMs) {
    super(`${label} did not finish within ${Math.round(timeoutMs / 1000)} s and was stopped`);
    this.name = 'CommandTimeoutError';
  }
}

/**
 * @returns {Promise<void>} resolves when the command exits 0; rejects with
 *   CommandTimeoutError after the deadline (once its process tree is gone), or with
 *   an Error for a non-zero exit or spawn failure.
 */
export function execBounded(
  command,
  args,
  {
    timeoutMs,
    graceMs = 5_000,
    stdio = 'inherit',
    env = process.env,
    label = `${command} ${args[0] ?? ''}`.trim(),
    snapshot = listProcesses,
    // Test seam: schedules the deadline; returns a cancel function.
    armDeadline = (callback, ms) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    },
    // How long to wait for the command to exit after SIGKILL before giving up on it
    // (a process in an uninterruptible kernel wait ignores SIGKILL until it returns).
    abandonMs = 5_000,
    // Test seam: sends a signal to one pid.
    sendSignal = signal,
    // Called with the command's pid and a host process snapshot when the deadline
    // passes, before anything is signalled, so the stuck state can be logged.
    onTimeout = () => {},
  },
) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { stdio, env });
    } catch (error) {
      reject(error);
      return;
    }

    let exited = false;
    let timedOut = false;
    let doomed = [];
    let poll;
    let killed = false;

    const cancelDeadline = armDeadline(() => {
      if (exited) return;
      timedOut = true;
      // Snapshot before signalling so grandchildren are still attributed to the
      // tree (they are reparented once their parent dies).
      const processes = snapshot();
      try {
        onTimeout(child.pid, processes);
      } catch {
        // Diagnostics must never stop the kill.
      }
      doomed = descendantsOf(child.pid, processes)
        .map((proc) => proc.pid)
        .reverse();
      if (!doomed.includes(child.pid)) doomed.push(child.pid);
      for (const pid of doomed) sendSignal(pid, 'SIGTERM');
      const killAt = Date.now() + graceMs;
      poll = setInterval(() => {
        const survivors = doomed.filter((pid) => (pid === child.pid ? !exited : isAlive(pid)));
        if (survivors.length && Date.now() < killAt) return;
        if (!killed) {
          killed = true;
          // A second look catches anything the tree started after the first snapshot.
          for (const proc of exited ? [] : descendantsOf(child.pid, snapshot())) {
            if (!doomed.includes(proc.pid)) {
              doomed.push(proc.pid);
              survivors.push(proc.pid);
            }
          }
        }
        for (const pid of survivors) sendSignal(pid, 'SIGKILL');
        if (!exited && Date.now() < killAt + abandonMs) return;
        clearInterval(poll);
        // Still not gone after SIGKILL: stop waiting so the caller can retry or fail.
        if (!exited) child.unref();
        reject(new CommandTimeoutError(label, timeoutMs));
      }, 50);
    }, timeoutMs);

    child.on('error', (error) => {
      cancelDeadline();
      clearInterval(poll);
      reject(error);
    });

    child.on('exit', (code, sig) => {
      exited = true;
      if (timedOut) return; // the poll above settles the promise
      cancelDeadline();
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with ${sig ? `signal ${sig}` : `code ${code}`}`));
    });
  });
}

/**
 * Call `attempt(n)` until it succeeds, retrying only CommandTimeoutError, at most
 * `attempts` times in total.
 */
export async function retryTimeouts(attempt, { attempts, onRetry = () => {} }) {
  for (let n = 1; ; n++) {
    try {
      return await attempt(n);
    } catch (error) {
      if (!(error instanceof CommandTimeoutError) || n >= attempts) throw error;
      onRetry(error, n);
    }
  }
}
