// Vitest's `vi.waitFor` / `vi.waitUntil` give up after 1s unless a call passes its own
// `timeout`, and vitest has no config option to change that default. src/test-setup.ts
// uses this to give them the same CI-scaled default as Testing Library's waits.

type WaitOptions = number | { timeout?: number; interval?: number } | undefined;
type WaitFn = (callback: never, options?: WaitOptions) => Promise<unknown>;

/** The parts of `vi` this patches; a plain object stands in for it in unit tests. */
export interface ViWaits {
  waitFor: WaitFn;
  waitUntil: WaitFn;
}

/** Marks an installed wrapper, so each test file's setup run does not wrap it again. */
const ORIGINAL = Symbol.for('intent.viWaitDefaultTimeout.original');

/** `options` with `timeout` filled in when the call did not choose one. */
export function withDefaultWaitTimeout(options: WaitOptions, timeoutMs: number): WaitOptions {
  if (typeof options === 'number') return options;
  if (options?.timeout !== undefined) return options;
  return { ...options, timeout: timeoutMs };
}

function wrap(wait: WaitFn, timeoutMs: number): WaitFn {
  const original = ((wait as unknown as Record<symbol, WaitFn>)[ORIGINAL] ?? wait) as WaitFn;
  const wrapped: WaitFn = (callback, options) =>
    original(callback, withDefaultWaitTimeout(options, timeoutMs));
  Object.defineProperty(wrapped, ORIGINAL, { value: original });
  return wrapped;
}

/**
 * Makes `vi.waitFor` and `vi.waitUntil` default to `timeoutMs`. An explicit `timeout`
 * (or a bare number) still wins. Safe to call once per test file: vitest's `vi` is shared
 * by the files a worker runs, so a repeat call rewraps the original instead of nesting.
 */
export function installViWaitDefaultTimeout(target: ViWaits, timeoutMs: number): void {
  target.waitFor = wrap(target.waitFor, timeoutMs);
  target.waitUntil = wrap(target.waitUntil, timeoutMs);
}
