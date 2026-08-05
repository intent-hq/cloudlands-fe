/**
 * Pure decision logic for the dev-stack runner (scripts/dev-stack.mjs).
 *
 * Kept side-effect free so the exit-classification and teardown-planning
 * rules are unit-testable (scripts/dev-stack-lib.test.ts).
 */

export const ROLE_BUILD = 'build';
export const ROLE_LONG = 'long';

/**
 * Parse runner CLI args into command descriptors.
 *
 * Supported flags (each repeatable, order defines display order):
 *   --build "<command>"  a finite build step; exiting 0 is normal
 *   --long "<command>"   a long-running member; ANY exit tears the stack down
 *
 * @param {string[]} argv process.argv.slice(2)
 * @returns {{ role: 'build' | 'long', command: string }[]}
 */
export function parseCommands(argv) {
  const commands = [];
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag !== '--build' && flag !== '--long') {
      throw new Error(`dev-stack: unknown argument "${flag}" (expected --build or --long)`);
    }
    const command = argv[i + 1];
    if (!command || command.startsWith('--')) {
      throw new Error(`dev-stack: ${flag} requires a command string`);
    }
    commands.push({ role: flag === '--build' ? ROLE_BUILD : ROLE_LONG, command });
    i++;
  }
  if (!commands.some((c) => c.role === ROLE_LONG)) {
    throw new Error('dev-stack: at least one --long command is required');
  }
  return commands;
}

/**
 * Decide how the runner should react to a single command closing.
 *
 * Rules:
 * - build exits 0            → ignore (overlapped-build startup keeps going)
 * - build exits non-zero     → teardown, failure (mirrors --kill-others-on-fail)
 * - long-running exits (any) → teardown; failure iff non-zero and not killed
 * - anything closing because the runner killed it during teardown → ignore
 *
 * @param {'build' | 'long'} role
 * @param {{ exitCode: number | string, killed: boolean }} closeEvent
 * @param {boolean} teardownInProgress
 * @returns {{ action: 'ignore' } | { action: 'teardown', failure: boolean, exitCode: number }}
 */
export function classifyClose(role, closeEvent, teardownInProgress) {
  if (teardownInProgress || closeEvent.killed) {
    return { action: 'ignore' };
  }
  const exitCode = typeof closeEvent.exitCode === 'number' ? closeEvent.exitCode : 1;
  if (role === ROLE_BUILD) {
    if (exitCode === 0) {
      return { action: 'ignore' };
    }
    return { action: 'teardown', failure: true, exitCode };
  }
  // Long-running member: any exit ends the stack. A clean exit (e.g. the
  // Electron app quitting via Cmd-Q) is a normal shutdown, not a failure.
  return { action: 'teardown', failure: exitCode !== 0, exitCode };
}

/**
 * Decide how to react to a termination signal delivered to the runner.
 * The first signal starts a graceful teardown; any repeat escalates to
 * an immediate SIGKILL of everything still alive.
 *
 * @param {number} signalCount how many teardown signals have been seen (including this one)
 * @returns {{ action: 'graceful' } | { action: 'force-kill' }}
 */
export function classifySignal(signalCount) {
  return signalCount > 1 ? { action: 'force-kill' } : { action: 'graceful' };
}

/**
 * Resolve the grace period (ms) before escalating SIGTERM → SIGKILL.
 *
 * @param {string | undefined} envValue DEV_STACK_KILL_TIMEOUT_MS
 * @param {number} fallback
 * @returns {number}
 */
export function resolveKillTimeout(envValue, fallback = 5000) {
  const parsed = Number(envValue);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return fallback;
}
