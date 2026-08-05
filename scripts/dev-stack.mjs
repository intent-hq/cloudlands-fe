#!/usr/bin/env node
/**
 * Dev-stack runner for dev:base / dev:cdp:base.
 *
 * Replaces the shell `concurrently --kill-others-on-fail` one-liner, which
 * could not distinguish "a build finished (exit 0, by design)" from "a
 * long-running member exited". With --kill-others-on-fail, Electron quitting
 * cleanly (Ctrl-C, Cmd-Q) leaves vite running and the shell prompt never
 * returns (intent-hq/monorepo#1460).
 *
 * Policy (see scripts/dev-stack-lib.mjs for the pure decision logic):
 * - --build commands may exit 0 without affecting the stack (overlapped
 *   startup from PR #672); a non-zero build exit tears everything down.
 * - --long commands (vite, electron) ending for ANY reason tears everything
 *   down: SIGTERM to each remaining process tree, then SIGKILL after a grace
 *   period (DEV_STACK_KILL_TIMEOUT_MS, default 5000).
 * - SIGINT/SIGTERM/SIGHUP start the same teardown; a second signal SIGKILLs
 *   everything immediately.
 */

import concurrently from 'concurrently';
import {
  ROLE_LONG,
  classifyClose,
  classifyError,
  classifySignal,
  parseCommands,
  resolveKillTimeout,
} from './dev-stack-lib.mjs';

const specs = parseCommands(process.argv.slice(2));
const killTimeoutMs = resolveKillTimeout(process.env.DEV_STACK_KILL_TIMEOUT_MS);

const { commands, result } = concurrently(
  specs.map((spec) => ({ command: spec.command })),
  {
    // Teardown is handled below; disable the built-in kill-others behavior.
    killOthersOn: [],
  },
);

let teardownInProgress = false;
let failureExitCode = 0;
let signalCount = 0;
let forceKillTimer = null;

function killRemaining(signal) {
  for (const command of commands) {
    if (command.state === 'started') {
      command.kill(signal);
    }
  }
}

function forceKillRemaining() {
  const survivors = commands.filter((command) => command.state === 'started');
  if (survivors.length > 0) {
    console.error(`dev-stack: force-killing ${survivors.length} remaining process tree(s)`);
    for (const command of survivors) {
      command.kill('SIGKILL');
    }
  }
}

function beginTeardown() {
  if (teardownInProgress) {
    return;
  }
  teardownInProgress = true;
  killRemaining('SIGTERM');
  forceKillTimer = setTimeout(forceKillRemaining, killTimeoutMs);
  forceKillTimer.unref();
}

commands.forEach((command, index) => {
  const { role } = specs[index];
  command.close.subscribe((closeEvent) => {
    const decision = classifyClose(role, closeEvent, teardownInProgress);
    if (decision.action !== 'teardown') {
      return;
    }
    if (decision.failure) {
      failureExitCode = decision.exitCode;
    } else if (role === ROLE_LONG) {
      console.log(`dev-stack: "${command.command}" ended; shutting down the dev stack`);
    }
    beginTeardown();
  });
  // A spawn failure emits `error` with no close event; without this the rest
  // of the stack would keep running with no one watching the failed member.
  command.error.subscribe((error) => {
    const decision = classifyError(teardownInProgress);
    if (decision.action !== 'teardown') {
      return;
    }
    console.error(`dev-stack: "${command.command}" failed to start: ${error}`);
    failureExitCode = decision.exitCode;
    beginTeardown();
  });
});

// concurrently's own KillOnSignal controller forwards the first signal to
// every child; this handler adds the grace-then-SIGKILL escalation and makes
// a repeated Ctrl-C force-kill anything still alive.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    signalCount += 1;
    if (classifySignal(signalCount).action === 'force-kill') {
      forceKillRemaining();
    } else {
      beginTeardown();
    }
  });
}

// A deliberate teardown (clean long-runner exit or a signal) kills the other
// children, whose non-zero "killed" exit codes make concurrently's success
// condition reject — that is still a clean shutdown unless a real failure was
// recorded in failureExitCode.
function finish(allSucceeded) {
  if (forceKillTimer) clearTimeout(forceKillTimer);
  if (failureExitCode !== 0) {
    process.exit(failureExitCode);
  }
  process.exit(allSucceeded || teardownInProgress || signalCount > 0 ? 0 : 1);
}

result.then(
  () => finish(true),
  () => finish(false),
);
