/**
 * Wraps Svelte's public `flushSync` so a test can count the calls made while
 * an effect is running — a nested flush inside an effect body nulls the outer
 * batch mid-traversal (sveltejs/svelte#18546). Calls from event handlers,
 * timers, and the test harness itself pass through uncounted.
 */
import type { flushSync } from 'svelte';

let callsInsideEffects = 0;

export function wrapFlushSync(actual: typeof flushSync): typeof flushSync {
  return ((fn?: () => unknown) => {
    if ($effect.tracking()) callsInsideEffects += 1;
    return actual(fn);
  }) as typeof flushSync;
}

export function effectFlushSyncCalls(): number {
  return callsInsideEffects;
}

export function resetEffectFlushSyncCalls(): void {
  callsInsideEffects = 0;
}
