import { onReducedMotionChange, prefersReducedMotion } from './reduced-motion';

/**
 * Reactive reduced-motion flag (OS preference OR root `data-reduce-motion`).
 * Call from component init; returns a getter plus the cleanup to run on
 * unmount. Non-reactive callers use `prefersReducedMotion()` from
 * `./reduced-motion` instead.
 */
export function watchReducedMotion(): { readonly current: boolean; cleanup: () => void } {
  let reduced = $state(prefersReducedMotion());
  const cleanup = onReducedMotionChange((next) => {
    reduced = next;
  });
  return {
    get current() {
      return reduced;
    },
    cleanup,
  };
}
