import { prefersReducedMotion } from '@/lib/motion/environment';

export type SpringTierName = 'fast' | 'moderate' | 'slow';
export interface SpringExit {
  readonly duration: number;
  readonly easing: (t: number) => number;
}
export interface SpringTier {
  readonly settleMs: number;
  readonly easing: (t: number) => number;
  readonly exit: SpringExit;
}
export const cubicOut = (t: number) => 1 - (1 - t) ** 3;

/** Source: src/lib/motion/springs.ts. Compatibility names, bounded easing, no momentum. */
export const spring = {
  fast: { settleMs: 80, easing: cubicOut, exit: { duration: 60, easing: cubicOut } },
  moderate: { settleMs: 160, easing: cubicOut, exit: { duration: 120, easing: cubicOut } },
  slow: { settleMs: 240, easing: cubicOut, exit: { duration: 160, easing: cubicOut } },
} as const satisfies Record<SpringTierName, SpringTier>;

function interpolate<T>(from: T, to: T): (t: number) => T {
  if (Object.is(from, to)) return () => to;
  if (typeof from === 'number' && typeof to === 'number') {
    return (t) => (from + (to - from) * t) as T;
  }
  if (Array.isArray(from) && Array.isArray(to)) {
    const values = to.map((value, index) => interpolate(from[index], value));
    return (t) => values.map((value) => value(t)) as T;
  }
  if (from instanceof Date && to instanceof Date) {
    const value = interpolate(from.getTime(), to.getTime());
    return (t) => new Date(value(t)) as T;
  }
  if (from && to && typeof from === 'object' && typeof to === 'object') {
    const values = Object.entries(to).map(
      ([key, value]) => [key, interpolate((from as Record<string, unknown>)[key], value)] as const,
    );
    return (t) => Object.fromEntries(values.map(([key, value]) => [key, value(t)])) as T;
  }
  throw new TypeError('Motion values must have matching numeric shapes');
}

/** Ephemeral DOM motion value. Subscribe directly for writes or through useSyncExternalStore. */
export class Spring<T> {
  #current: T;
  #target: T;
  readonly #tier: SpringTier;
  readonly #listeners = new Set<() => void>();
  #frame: number | undefined;
  #generation = 0;
  #settled = Promise.resolve();
  #resolve: (() => void) | undefined;

  constructor(value: T, tier: SpringTierName = 'moderate') {
    this.#current = this.#target = value;
    this.#tier = spring[tier];
  }
  get current(): T {
    return this.#current;
  }
  get target(): T {
    return this.#target;
  }
  set target(value: T) {
    void this.set(value);
  }
  getSnapshot = () => this.#current;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  #publish(value: T) {
    if (Object.is(value, this.#current)) return;
    this.#current = value;
    this.#listeners.forEach((listener) => listener());
  }
  /** Stop synchronously before a reversal, never one frame toward the stale target. */
  stop() {
    this.#generation += 1;
    if (this.#frame !== undefined) cancelAnimationFrame(this.#frame);
    this.#frame = undefined;
    this.#resolve?.();
    this.#resolve = undefined;
  }
  set(value: T, options?: { instant?: boolean }): Promise<void> {
    const instant = options?.instant || prefersReducedMotion();
    if (!instant && Object.is(value, this.#target)) return this.#settled;
    this.stop();
    this.#target = value;
    if (instant) {
      this.#publish(value);
      return (this.#settled = Promise.resolve());
    }
    const valueAt = interpolate(this.#current, value);
    const generation = this.#generation;
    const start = performance.now();
    this.#settled = new Promise<void>((resolve) => {
      this.#resolve = resolve;
    });
    const tick = (now: number) => {
      const t = Math.max(0, Math.min(1, (now - start) / this.#tier.settleMs));
      this.#publish(t === 1 ? value : valueAt(this.#tier.easing(t)));
      if (generation !== this.#generation) return;
      if (t < 1) this.#frame = requestAnimationFrame(tick);
      else {
        this.#frame = undefined;
        this.#resolve?.();
        this.#resolve = undefined;
      }
    };
    this.#frame = requestAnimationFrame(tick);
    return this.#settled;
  }
  destroy() {
    this.stop();
    this.#listeners.clear();
  }
}

export function springValue<T>(value: T, tier: SpringTierName = 'moderate') {
  const motion = new Spring(value, tier);
  return {
    subscribe(listener: (value: T) => void) {
      listener(motion.current);
      return motion.subscribe(() => listener(motion.current));
    },
    set: (next: T, options?: { hard?: boolean }) => motion.set(next, { instant: options?.hard }),
    update: (updater: (target: T, current: T) => T, options?: { hard?: boolean }) =>
      motion.set(updater(motion.target, motion.current), { instant: options?.hard }),
    destroy: () => motion.destroy(),
  };
}
export function tweenedValue<T>(value: T, tier: SpringTierName = 'moderate') {
  const motion = springValue(value, tier);
  return {
    ...motion,
    set: (next: T) => motion.set(next),
    update: (updater: (value: T) => T) => motion.update(updater),
  };
}
export function exitFallbackMs(tier: SpringTier): number {
  return tier.exit.duration + 100;
}
export { prefersReducedMotion } from '@/lib/motion/environment';
