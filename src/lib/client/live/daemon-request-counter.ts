/**
 * Dev-only, opt-in count of daemon requests by JSON-RPC method.
 *
 * The renderer transports call `recordDaemonRequest` once per request: the
 * browser WebSocket transport when it sends the frame, the Electron IPC
 * transport when it forwards the request to the main process (which may refuse
 * it or answer without a daemon call). Nothing is recorded unless the counter was enabled, and a
 * production build never enables it: `import.meta.env.DEV` is statically false
 * there, so `recordDaemonRequest` folds to an early return.
 *
 * Opt in from a dev renderer (app sandbox, `dev:web`, dev Electron) with
 * `localStorage.setItem('intent.devRequestCounter', '1')` and a reload. The
 * counter is then exposed as `window.__intentRequestCounter` (`counts()`,
 * `count(method)`, `reset()`, `overBudget(budgets)`). Tests call
 * `enableDaemonRequestCounter()` directly.
 */

/** @internal Opt-in key; exported for the counter's tests. */
export const DAEMON_REQUEST_COUNTER_STORAGE_KEY = 'intent.devRequestCounter';

type DaemonRequestCounts = Record<string, number>;
/**
 * @internal Maximum allowed requests per method; methods not listed are
 * unbounded. Used by the request budget tests.
 */
export type DaemonRequestBudgets = Record<string, number>;
type DaemonRequestBudgetViolation = { method: string; count: number; budget: number };

/** @internal Read through `window.__intentRequestCounter`; tests import the type. */
export interface DaemonRequestCounter {
  /** Requests recorded since enable or the last reset, keyed by method (sorted). */
  counts(): DaemonRequestCounts;
  /** Requests recorded for one method. */
  count(method: string): number;
  reset(): void;
  /** Methods whose count exceeds their budget. Empty when every budget holds. */
  overBudget(budgets: DaemonRequestBudgets): DaemonRequestBudgetViolation[];
}

declare global {
  interface Window {
    __intentRequestCounter?: DaemonRequestCounter;
  }
}

const isDevBuild = (): boolean => import.meta.env.DEV === true;

let tally: Map<string, number> | null = null;

const counter: DaemonRequestCounter = {
  counts() {
    return Object.fromEntries(
      [...(tally ?? new Map()).entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
    );
  },
  count(method) {
    return tally?.get(method) ?? 0;
  },
  reset() {
    tally?.clear();
  },
  overBudget(budgets) {
    return Object.entries(budgets)
      .map(([method, budget]) => ({ method, count: counter.count(method), budget }))
      .filter(({ count, budget }) => count > budget);
  },
};

/** Record one daemon request. A no-op unless a dev build enabled the counter. */
export function recordDaemonRequest(method: string): void {
  if (!isDevBuild() || tally === null) return;
  tally.set(method, (tally.get(method) ?? 0) + 1);
}

/**
 * @internal Start counting (from zero) and return the counter. Returns `null` outside a
 * dev build so production never accumulates or exposes request data.
 */
export function enableDaemonRequestCounter(): DaemonRequestCounter | null {
  if (!isDevBuild()) return null;
  tally = new Map();
  if (typeof window !== 'undefined') window.__intentRequestCounter = counter;
  return counter;
}

/** @internal Stop counting and drop the window handle. */
export function disableDaemonRequestCounter(): void {
  tally = null;
  if (typeof window !== 'undefined') delete window.__intentRequestCounter;
}

function optedIn(): boolean {
  try {
    return globalThis.localStorage?.getItem(DAEMON_REQUEST_COUNTER_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Enable the counter when a dev build opted in. Called once when the renderer
 * picks its backend transport, so counting covers startup from the first request.
 */
export function enableDaemonRequestCounterIfOptedIn(): void {
  if (isDevBuild() && tally === null && optedIn()) enableDaemonRequestCounter();
}
