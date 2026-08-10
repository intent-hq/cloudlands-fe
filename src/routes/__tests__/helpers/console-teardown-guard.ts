/**
 * Shared teardown guard for the heavy layout route suites
 * (intent-hq/monorepo#1774).
 *
 * `+layout.svelte`'s onMount defers work past the tests that mount it — a
 * requestIdleCallback/setTimeout(100ms) fallback dispatching
 * `loadWorkspacesRequested`, plus best-effort async invokes — so under CI
 * load a late console call from that deferred work can still be in flight
 * as an `onUserConsoleLog` RPC when the vitest worker tears the environment
 * down. Vitest then records an unhandled `EnvironmentTeardownError: Closing
 * rpc while "onUserConsoleLog" was pending`, failing the run despite all
 * tests passing.
 *
 * The guard registers an `afterAll` that (1) silences the console so any
 * still-pending deferred callback can no longer start a new console RPC,
 * then (2) yields real time so those deferred callbacks fire inside the
 * file's lifecycle and any already in-flight console RPC settles before
 * environment teardown begins. Console methods stay silenced afterwards on
 * purpose: the worker tears this file's environment down next, so nothing
 * legitimate logs after the suite's `afterAll`.
 */
import { afterAll } from 'vitest';

const SILENCED_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;

/**
 * Default settle window. The layout's slowest deferral is the 100ms
 * setTimeout fallback for requestIdleCallback (jsdom has no
 * requestIdleCallback); 500ms gives loaded-runner headroom for it to fire
 * and for in-flight console RPCs to resolve.
 */
const DEFAULT_SETTLE_MS = 500;

/**
 * Install the guard. Call once at the top level of a test file that mounts
 * the real root `+layout.svelte`.
 */
export function installConsoleTeardownGuard(settleMs: number = DEFAULT_SETTLE_MS): void {
  afterAll(async () => {
    for (const method of SILENCED_METHODS) {
      console[method] = () => {};
    }
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  });
}
