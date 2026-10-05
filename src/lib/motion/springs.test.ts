import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exitFallbackMs,
  prefersReducedMotion,
  spring,
  Spring,
  springValue,
  tweenedValue,
  type SpringTierName,
} from './springs';

let now: number;
let frames: FrameRequestCallback[];

beforeEach(() => {
  now = 0;
  frames = [];
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
});

afterEach(() => {
  advance(1000);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function advance(ms: number) {
  now += ms;
  const pending = frames;
  frames = [];
  pending.forEach((callback) => callback(now));
  flushSync();
}

describe('bounded motion tiers', () => {
  for (const tier of ['fast', 'moderate', 'slow'] as const) {
    for (const frameMs of [1000 / 120, 1000 / 60, 1000 / 30, 100]) {
      it(`${tier} stays bounded and monotonic at ${frameMs}ms frames, including reversal`, async () => {
        const value = new Spring(0, tier);
        void value.set(100);
        advance(16);
        expect(value.current).toBeGreaterThan(0);
        expect(value.current).toBeLessThan(100);
        const before = value.current;
        const settled = value.set(-40);
        expect(value.current).toBe(before);
        let previous = before;
        for (let elapsed = 0; elapsed <= 300; elapsed += frameMs) {
          advance(frameMs);
          expect(value.current).toBeLessThanOrEqual(previous);
          expect(value.current).toBeGreaterThanOrEqual(-40);
          previous = value.current;
        }
        await settled;
        expect(value.current).toBe(-40);
      });
    }
  }

  it.each<[SpringTierName, number]>([
    ['fast', 80],
    ['moderate', 160],
    ['slow', 240],
  ])(
    'settles %s by its bounded %dms duration without restarting for the same target',
    async (tier, duration) => {
      const value = new Spring(0, tier);
      const settled = value.set(100);
      advance(duration / 4);
      const first = value.current;
      expect(first).toBeGreaterThan(25);
      expect(first).toBeLessThan(100);
      expect(value.set(100)).toBe(settled);
      advance(duration / 4);
      expect(value.current - first).toBeLessThan(first);
      expect(value.current).toBeLessThan(100);
      advance(duration / 2 + 1);
      await settled;
      expect(value.current).toBe(100);
    },
  );

  it('retargets via the target property and cancels pending frames for instant updates', async () => {
    const value = new Spring(0);
    value.target = 100;
    advance(16);
    await value.set(20, { instant: true });
    advance(500);
    expect(value.current).toBe(20);
    expect(value.target).toBe(20);
  });

  it.each([springValue, tweenedValue])(
    'bounds legacy stores on reversal and updates from their target',
    async (createValue) => {
      const value = createValue(0, 'moderate');
      let current = 0;
      const unsubscribe = value.subscribe((next) => (current = next));
      void value.set(100);
      advance(16);
      const before = current;
      const settled = value.update((target) => target - 140);
      expect(current).toBe(before);
      let previous = before;
      for (let frame = 0; frame < 20; frame += 1) {
        advance(16);
        expect(current).toBeLessThanOrEqual(previous);
        expect(current).toBeGreaterThanOrEqual(-40);
        previous = current;
      }
      await settled;
      expect(current).toBe(-40);
      unsubscribe();
    },
  );

  it('preserves hard updates for legacy object-valued stores', async () => {
    const value = springValue({ x: 0, scale: 1 });
    let current = { x: 0, scale: 1 };
    const unsubscribe = value.subscribe((next) => (current = next));
    void value.set({ x: 100, scale: 2 });
    advance(16);
    await value.set({ x: 20, scale: 1 }, { hard: true });
    advance(500);
    expect(current).toEqual({ x: 20, scale: 1 });
    unsubscribe();
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
