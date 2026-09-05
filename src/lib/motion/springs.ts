import { cubicOut } from 'svelte/easing';
import {
  Spring as SvelteSpring,
  spring as svelteSpring,
  tweened as svelteTweened,
  type SpringOptions,
  type SpringUpdateOptions,
  type TweenOptions,
} from 'svelte/motion';

export type SpringTierName = 'fast' | 'moderate' | 'slow';

export interface SpringExit {
  /** Svelte tween duration, in milliseconds. */
  readonly duration: number;
  readonly easing: (t: number) => number;
}

export interface SpringTier extends Required<SpringOptions> {
  /** Approximate visual settling time, in milliseconds. */
  readonly settleMs: number;
  readonly exit: SpringExit;
}

/**
 * Shared Svelte Spring options. Pass a tier directly to `new Spring(value, tier)`.
 * Fast and moderate are critically damped; slow has a small intentional overshoot.
 */
export const spring = {
  fast: {
    stiffness: 0.8,
    damping: 0.989,
    precision: 0.001,
    settleMs: 80,
    exit: { duration: 60, easing: cubicOut },
  },
  moderate: {
    stiffness: 0.4,
    damping: 0.865,
    precision: 0.001,
    settleMs: 160,
    exit: { duration: 120, easing: cubicOut },
  },
  slow: {
    stiffness: 0.25,
    damping: 0.65,
    precision: 0.001,
    settleMs: 240,
    exit: { duration: 160, easing: cubicOut },
  },
} as const satisfies Record<SpringTierName, SpringTier>;

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
  );
}

/** A tier-bound Spring whose updates settle immediately for reduced motion. */
export class Spring<T> extends SvelteSpring<T> {
  constructor(value: T, tier: SpringTierName = 'moderate') {
    super(value, spring[tier]);
  }

  override set(value: T, options?: SpringUpdateOptions): Promise<void> {
    return super.set(value, prefersReducedMotion() ? { ...options, instant: true } : options);
  }
}

/** Tier-bound compatibility wrapper for Svelte's legacy spring store. */
export function springValue<T>(value: T, tier: SpringTierName = 'moderate') {
  const store = svelteSpring(value, spring[tier]);
  const set = store.set.bind(store);
  const update = store.update.bind(store);
  store.set = (next, options) =>
    set(next, prefersReducedMotion() ? { ...options, hard: true } : options);
  store.update = (updater, options) =>
    update(updater, prefersReducedMotion() ? { ...options, hard: true } : options);
  return store;
}

/** Tier-bound compatibility wrapper for Svelte's legacy tweened store. */
export function tweenedValue<T>(value: T, tier: SpringTierName = 'moderate') {
  const options = (): TweenOptions<T> => ({
    duration: prefersReducedMotion() ? 0 : spring[tier].settleMs,
    easing: spring[tier].exit.easing,
  });
  const store = svelteTweened(value, options());
  return {
    subscribe: store.subscribe,
    set: (next: T) => store.set(next, options()),
    update: (updater: (value: T) => T) => store.update(updater, options()),
  };
}

/** Exit duration plus a guard for throttled/background tabs. */
export function exitFallbackMs(tier: SpringTier): number {
  return tier.exit.duration + 100;
}
