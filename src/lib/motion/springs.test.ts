import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  exitFallbackMs,
  prefersReducedMotion,
  spring,
  Spring,
  springValue,
  tweenedValue,
  type SpringTier,
} from './springs';

afterEach(() => vi.unstubAllGlobals());

function simulatedSettleMs(tier: SpringTier): { settleMs: number; peak: number } {
  let previous = 0;
  let current = 0;
  let peak = 0;
  for (let frame = 1; frame < 120; frame += 1) {
    const delta = 1 - current;
    const velocity = current - previous;
    const step = velocity + tier.stiffness * delta - tier.damping * velocity;
    if (Math.abs(step) < tier.precision && Math.abs(delta) < tier.precision) {
      return { settleMs: (frame * 1000) / 60, peak };
    }
    previous = current;
    current += step;
    peak = Math.max(peak, current);
  }
  throw new Error('Spring did not settle');
}

describe('spring tiers', () => {
  it.each([
    ['fast', 80],
    ['moderate', 160],
    ['slow', 240],
  ] as const)('settles the %s tier near %dms', (name, expectedMs) => {
    expect(Math.abs(simulatedSettleMs(spring[name]).settleMs - expectedMs)).toBeLessThan(10);
  });

  it('keeps only the slow tier visibly underdamped', () => {
    expect(simulatedSettleMs(spring.fast).peak).toBeLessThanOrEqual(1);
    expect(simulatedSettleMs(spring.moderate).peak).toBeLessThanOrEqual(1);
    expect(simulatedSettleMs(spring.slow).peak).toBeGreaterThan(1.005);
  });

  it('derives deferred-unmount fallbacks from each exit tween', () => {
    expect(exitFallbackMs(spring.fast)).toBe(160);
    expect(exitFallbackMs(spring.moderate)).toBe(220);
    expect(exitFallbackMs(spring.slow)).toBe(260);
  });

  it('treats an absent matchMedia result as no reduced-motion preference', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => undefined),
    );

    expect(prefersReducedMotion()).toBe(false);
  });

  it('settles class, spring-store, and tweened wrappers instantly for reduced motion', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );

    const value = new Spring(0, 'slow');
    await value.set(10);
    expect(value.current).toBe(10);

    const legacy = springValue(0, 'slow');
    let springCurrent = 0;
    const unsubscribe = legacy.subscribe((current) => (springCurrent = current));
    await legacy.set(10);
    expect(springCurrent).toBe(10);
    unsubscribe();

    const tween = tweenedValue(0, 'slow');
    let tweenCurrent = 0;
    const unsubscribeTween = tween.subscribe((current) => (tweenCurrent = current));
    await tween.set(10);
    expect(tweenCurrent).toBe(10);
    unsubscribeTween();
  });
});
