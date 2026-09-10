// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as indicatorsApi from './index';
import IntentMarkLoader from './IntentMarkLoader.svelte';
import { intentMarkMotionTiming, intentMarkVariants } from './intent-mark-motion';
import { spinnerMetadata } from './spinner.meta';

interface AnimationRecord {
  target: Element;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
  cancel: ReturnType<typeof vi.fn>;
  finish(): void;
  readonly currentTime: number | null;
  setPlayState(state: AnimationPlayState): void;
}

const records: AnimationRecord[] = [];
const intersectionCallbacks: IntersectionObserverCallback[] = [];
let reducedMotion = false;
let mediaChange: (() => void) | undefined;

beforeEach(() => {
  records.length = 0;
  intersectionCallbacks.length = 0;
  reducedMotion = false;
  mediaChange = undefined;
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  Element.prototype.animate = vi.fn(function (this: Element, frames, options) {
    let playState: AnimationPlayState = 'running';
    let currentTime: number | null = 0;
    let onfinish: ((event: AnimationPlaybackEvent) => void) | null = null;
    const cancel = vi.fn(() => (playState = 'idle'));
    const animation = {
      cancel,
      get currentTime() {
        return currentTime;
      },
      set currentTime(value: CSSNumberish | null) {
        currentTime = typeof value === 'number' ? value : null;
      },
      get onfinish() {
        return onfinish;
      },
      set onfinish(callback: ((event: AnimationPlaybackEvent) => void) | null) {
        onfinish = callback;
      },
      get playState() {
        return playState;
      },
      finished: Promise.resolve(undefined as unknown as Animation),
    } as unknown as Animation;
    records.push({
      target: this,
      frames: frames as Keyframe[],
      options: (typeof options === 'number' ? { duration: options } : options) ?? {},
      cancel,
      finish: () => onfinish?.({} as AnimationPlaybackEvent),
      get currentTime() {
        return currentTime;
      },
      setPlayState: (state) => (playState = state),
    });
    return animation;
  });
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      get matches() {
        return reducedMotion;
      },
      addEventListener: (_event: string, callback: () => void) => (mediaChange = callback),
      removeEventListener: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function completeTransition(): void {
  const live = records.filter(
    ({ options, cancel }) =>
      options.duration === intentMarkMotionTiming.settleMs && cancel.mock.calls.length === 0,
  );
  expect(live).toHaveLength(2);
  live[0].finish();
}

function liveLoops(root: Element): AnimationRecord[] {
  return records.filter(
    ({ target, options, cancel }) =>
      root.contains(target) && options.iterations === Infinity && cancel.mock.calls.length === 0,
  );
}

describe('IntentMarkLoader', () => {
  it('keeps the public API and accepts size, class, variant, and stopped state', () => {
    const { getByRole } = render(IntentMarkLoader, {
      props: { variant: 'pulse', size: 48, playing: false, class: 'custom-mark' },
    });
    const root = getByRole('status', { name: 'Loading' });
    expect(root.tagName).toBe('svg');
    expect(root.getAttribute('width')).toBe('48');
    expect(root.getAttribute('height')).toBe('48');
    expect(root.getAttribute('data-variant')).toBe('pulse');
    expect(root.classList.contains('custom-mark')).toBe(true);
    expect(root.getAttribute('data-motion-state')).toBe('neutral');
    expect(records).toHaveLength(0);
    expect(intentMarkVariants).toEqual(['bloom', 'pulse', 'twist']);
    expect(spinnerMetadata.exports).toContain('IntentMarkVariant');
    expect(new Set(spinnerMetadata.exports.filter((name) => name !== 'IntentMarkVariant'))).toEqual(
      new Set(Object.keys(indicatorsApi)),
    );
  });

  it.each([
    ['bloom', 'pulse'],
    ['bloom', 'twist'],
    ['pulse', 'bloom'],
    ['pulse', 'twist'],
    ['twist', 'bloom'],
    ['twist', 'pulse'],
  ] as const)(
    'crossfades %s to %s on the same root, then runs only the requested loop',
    async (from, to) => {
      const view = render(IntentMarkLoader, { props: { variant: from, playing: true } });
      const root = view.container.querySelector<HTMLElement>('[data-slot="intent-mark-loader"]')!;
      completeTransition();
      const originalRoot = root;

      await view.rerender({ variant: to, playing: true });
      expect(view.container.querySelector('[data-slot="intent-mark-loader"]')).toBe(originalRoot);
      expect(root.dataset.motionState).toBe('morphing');
      const morphs = records.filter(
        ({ options, cancel }) => options.duration === 160 && cancel.mock.calls.length === 0,
      );
      expect(morphs).toHaveLength(2);
      expect(
        morphs.every(({ frames }) =>
          frames.every((frame) => Object.keys(frame).every((key) => key === 'opacity')),
        ),
      ).toBe(true);
      completeTransition();
      const loops = liveLoops(root);
      expect(loops).toHaveLength(5);
      expect((loops[0].target.parentElement as unknown as SVGGElement).dataset.markLayer).toBe(to);
      expect(root.dataset.motionState).toBe('playing');
    },
  );

  it('cancels stale transitions during rapid updates without retaining extra vector layers', async () => {
    const view = render(IntentMarkLoader, { props: { variant: 'pulse', playing: true } });
    const root = view.container.querySelector<HTMLElement>('[data-slot="intent-mark-loader"]')!;
    completeTransition();
    await view.rerender({ variant: 'bloom', playing: true });
    const staleMorphs = records.filter(
      ({ options, cancel }) => options.duration === 160 && cancel.mock.calls.length === 0,
    );
    await view.rerender({ variant: 'twist', playing: true });
    expect(staleMorphs.every(({ cancel }) => cancel.mock.calls.length === 1)).toBe(true);
    staleMorphs[0].finish();
    expect(liveLoops(root)).toHaveLength(0);
    expect(root.querySelectorAll('[data-mark-layer]')).toHaveLength(2);
    completeTransition();
    expect(liveLoops(root)).toHaveLength(5);
    expect(
      (liveLoops(root)[0].target.parentElement as unknown as SVGGElement).dataset.markLayer,
    ).toBe('twist');
    expect(root.querySelectorAll('[data-mark-layer]')).toHaveLength(1);
  });

  it('stops, reactivates, respects tab visibility and reduced motion, and cleans up', async () => {
    const view = render(IntentMarkLoader, { props: { variant: 'bloom', playing: true } });
    const root = view.container.querySelector<HTMLElement>('[data-slot="intent-mark-loader"]')!;
    completeTransition();
    await view.rerender({ variant: 'bloom', playing: false });
    expect(root.dataset.motionState).toBe('settling');
    completeTransition();
    expect(root.dataset.motionState).toBe('neutral');
    await view.rerender({ variant: 'bloom', playing: true });
    expect(root.dataset.motionState).toBe('morphing');
    completeTransition();

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(root.dataset.motionState).toBe('neutral');
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(root.dataset.motionState).toBe('morphing');
    completeTransition();

    reducedMotion = true;
    mediaChange?.();
    expect(root.dataset.motionState).toBe('neutral');
    expect(liveLoops(root)).toHaveLength(0);
    view.unmount();
    expect(root.dataset.motionState).toBe('destroyed');
    expect(records.every(({ cancel }) => cancel.mock.calls.length > 0)).toBe(true);
  });

  it('keeps concurrent indicators independent when one loop becomes idle', () => {
    const first = render(IntentMarkLoader, { props: { variant: 'bloom', playing: true } });
    const firstRoot = first.container.querySelector<HTMLElement>(
      '[data-slot="intent-mark-loader"]',
    )!;
    completeTransition();
    const second = render(IntentMarkLoader, { props: { variant: 'twist', playing: true } });
    const secondRoot = second.container.querySelector<HTMLElement>(
      '[data-slot="intent-mark-loader"]',
    )!;
    completeTransition();
    const firstLoops = liveLoops(firstRoot);
    const secondLoops = liveLoops(secondRoot);
    firstLoops.forEach((record) => record.setPlayState('idle'));
    intersectionCallbacks[0]?.(
      [{ isIntersecting: true, target: firstRoot } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(firstRoot.dataset.motionState).toBe('morphing');
    expect(liveLoops(secondRoot)).toEqual(secondLoops);
    expect(secondLoops.every(({ cancel }) => cancel.mock.calls.length === 0)).toBe(true);
  });

  it.each([
    ['pulse', 61],
    ['bloom', 61],
    ['twist', 110],
  ] as const)(
    'runs %s on native SVG strokes with the original 30fps source duration',
    (variant, count) => {
      const view = render(IntentMarkLoader, { props: { variant, playing: true } });
      completeTransition();
      const loops = liveLoops(view.container);
      const [loop] = loops;
      expect(loop.options).toMatchObject({
        duration: (count * 1000) / 30,
        iterations: Infinity,
        easing: 'linear',
      });
      expect(
        loops.every(({ target }) => target instanceof SVGElement && target.tagName === 'path'),
      ).toBe(true);
      expect(
        loops.every(({ frames }) => frames.every(({ easing }) => !easing?.startsWith('steps'))),
      ).toBe(true);
      expect(loop.currentTime).toBe(0);
    },
  );

  it('stops offscreen and resumes when visible without restarting unchanged props', async () => {
    const view = render(IntentMarkLoader, { props: { variant: 'pulse', playing: true } });
    const root = view.getByRole('status');
    completeTransition();
    const originalLoop = liveLoops(root)[0];
    await view.rerender({ variant: 'pulse', playing: true, size: 64 });
    expect(liveLoops(root)[0]).toBe(originalLoop);
    const intersect = (isIntersecting: boolean) =>
      intersectionCallbacks[0](
        [{ isIntersecting, target: root } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    intersect(false);
    expect(originalLoop.cancel).toHaveBeenCalledOnce();
    expect(root.getAttribute('data-motion-state')).toBe('neutral');
    intersect(true);
    completeTransition();
    expect(liveLoops(root)).toHaveLength(5);
    expect(liveLoops(root)[0]).not.toBe(originalLoop);
  });
});
