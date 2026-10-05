import { prefersReducedMotion } from '$lib/utils/reduced-motion';
import { untrack } from 'svelte';
import { cubicOut } from 'svelte/easing';
import { Tween, tweened as svelteTweened } from 'svelte/motion';
import { get } from 'svelte/store';

export type SpringTierName = 'fast' | 'moderate' | 'slow';

export interface SpringExit {
  /** Svelte tween duration, in milliseconds. */
  readonly duration: number;
  readonly easing: (t: number) => number;
}

export interface SpringTier {
  /** Bounded easing duration, in milliseconds. */
  readonly settleMs: number;
  readonly easing: (t: number) => number;
  readonly exit: SpringExit;
}

/**
 * Shared, non-overshooting motion tiers. The spring names are compatibility names,
 * not physical simulations: easing must stay bounded even after a dropped frame
 * or an interrupted/reversed target change.
 */
export const spring = {
  fast: {
    settleMs: 80,
    easing: cubicOut,
    exit: { duration: 60, easing: cubicOut },
  },
  moderate: {
    settleMs: 160,
    easing: cubicOut,
    exit: { duration: 120, easing: cubicOut },
  },
  slow: {
    settleMs: 240,
    easing: cubicOut,
    exit: { duration: 160, easing: cubicOut },
  },
} as const satisfies Record<SpringTierName, SpringTier>;

export { prefersReducedMotion } from '$lib/utils/reduced-motion';

/** Compatibility API backed by bounded easing, never spring momentum. */
export class Spring<T> {
  readonly #motion: Tween<T>;
  readonly #tier: SpringTier;
  #settled = Promise.resolve();

  constructor(value: T, tier: SpringTierName = 'moderate') {
    this.#tier = spring[tier];
    this.#motion = new Tween(value);
  }

  get current(): T {
    return this.#motion.current;
  }

  get target(): T {
    return this.#motion.target;
  }

  set target(value: T) {
    void this.set(value);
  }

  set(value: T, options?: { instant?: boolean }): Promise<void> {
    return untrack(() => {
      const instant = options?.instant || prefersReducedMotion();
      if (!instant && Object.is(value, this.#motion.target)) return this.#settled;
      // Stop the previous task now, not on the next frame. Otherwise it can move
      // farther toward the old target before a reversal starts.
      void this.#motion.set(this.#motion.current, { duration: 0 });
      this.#settled = this.#motion.set(value, {
        duration: instant ? 0 : this.#tier.settleMs,
        easing: this.#tier.easing,
      });
      return this.#settled;
    });
  }
}

/** Legacy store API with the same bounded easing and instant-update semantics. */
export function springValue<T>(value: T, tier: SpringTierName = 'moderate') {
  const store = svelteTweened(value);
  let target = value;
  let settled = Promise.resolve();
  const set = (next: T, options?: { hard?: boolean }) => {
    const instant = options?.hard || prefersReducedMotion();
    if (!instant && Object.is(next, target)) return settled;
    target = next;
    void store.set(get(store), { duration: 0 });
    settled = store.set(next, {
      duration: instant ? 0 : spring[tier].settleMs,
      easing: spring[tier].easing,
    });
    return settled;
  };
  return {
    subscribe: store.subscribe,
    set,
    update: (updater: (target: T, current: T) => T, options?: { hard?: boolean }) =>
      set(updater(target, get(store)), options),
  };
}

/** Tier-bound compatibility wrapper for Svelte's legacy tweened store. */
export function tweenedValue<T>(value: T, tier: SpringTierName = 'moderate') {
  const store = springValue(value, tier);
  return {
    subscribe: store.subscribe,
    set: (next: T) => store.set(next),
    update: (updater: (value: T) => T) => store.update(updater),
  };
}

/** Exit duration plus a guard for throttled/background tabs. */
export function exitFallbackMs(tier: SpringTier): number {
  return tier.exit.duration + 100;
}
