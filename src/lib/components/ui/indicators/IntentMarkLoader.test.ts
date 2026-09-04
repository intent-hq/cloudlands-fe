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
  expect(live).toHaveLength(5);
  live[0].finish();
}

function liveLoops(root: Element): AnimationRecord[] {
  return records.filter(
    ({ target, options, cancel }) =>
      root.contains(target) && options.iterations === Infinity && cancel.mock.calls.length === 0,
  );
}

describe('IntentMarkLoader', () => {
  it('publishes the shared API and renders one accessible currentColor five-arm SVG', () => {
    const { container, getByRole } = render(IntentMarkLoader, {
      props: { variant: 'pulse', size: 48, playing: false, class: 'custom-mark' },
    });
    const root = getByRole('status', { name: 'Loading' });
    expect(root.tagName).toBe('svg');
    expect(root.getAttribute('width')).toBe('48');
    expect(root.getAttribute('height')).toBe('48');
    expect(root.getAttribute('data-variant')).toBe('pulse');
    expect(root.classList.contains('custom-mark')).toBe(true);
    expect(container.querySelectorAll('[data-mark-arm]')).toHaveLength(5);
    expect(container.querySelectorAll('[data-bloom-arm]')).toHaveLength(5);
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
    'morphs %s to %s on the same root and continues at the handoff frame',
    async (from, to) => {
      const view = render(IntentMarkLoader, { props: { variant: from, playing: true } });
      const root = view.container.querySelector('svg')!;
      completeTransition();
      const originalRoot = root;

      await view.rerender({ variant: to, playing: true });
      expect(view.container.querySelector('svg')).toBe(originalRoot);
      expect(root.dataset.motionState).toBe('morphing');
      expect(root.dataset.handoffVariant).toBe(to);
      const morphs = records.filter(
        ({ options, cancel }) => options.duration === 160 && cancel.mock.calls.length === 0,
      );
      expect(morphs).toHaveLength(5);
      expect(morphs.every(({ frames }) => frames[0].d && frames[1].d)).toBe(true);
      completeTransition();
      const loops = liveLoops(root);
      expect(loops).toHaveLength(5);
      expect(
        loops.every(({ frames }) =>
          frames.every((frame) =>
            Object.keys(frame).every((property) =>
              ['offset', 'opacity', 'transform'].includes(property),
            ),
          ),
        ),
      ).toBe(true);
      expect(root.dataset.motionState).toBe('playing');
    },
  );

  it('samples a rapid mid-morph pose and does not restart the stale destination', async () => {
    const view = render(IntentMarkLoader, { props: { variant: 'pulse', playing: true } });
    const root = view.container.querySelector('svg')!;
    completeTransition();
    await view.rerender({ variant: 'bloom', playing: true });
    const staleMorphs = records.filter(
      ({ options, cancel }) => options.duration === 160 && cancel.mock.calls.length === 0,
    );
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      () =>
        ({
          opacity: '0.47',
          strokeDasharray: '61 39',
          strokeDashoffset: '-17',
          strokeWidth: '18.2px',
          transform: 'matrix(0.8, 0, 0, 0.8, 3, 4)',
          transformOrigin: '128px 99px',
          getPropertyValue: (property: string) =>
            property === 'd' ? 'path("M80 10L98 60C102 74 94 82 80 76L30 48")' : '',
        }) as CSSStyleDeclaration,
    );
    await view.rerender({ variant: 'twist', playing: true });
    expect(staleMorphs.every(({ cancel }) => cancel.mock.calls.length === 1)).toBe(true);
    const current = records.filter(
      ({ options, cancel }) => options.duration === 160 && cancel.mock.calls.length === 0,
    );
    expect(current[0].frames[0]).toMatchObject({
      opacity: '0.47',
      strokeDasharray: '61 39',
      strokeDashoffset: '-17',
      transform: 'matrix(0.8, 0, 0, 0.8, 3, 4)',
    });
    completeTransition();
    expect(root.dataset.loopPhase).toBe('0.2');
  });

  it('stops, reactivates, respects tab visibility and reduced motion, and cleans up', async () => {
    const view = render(IntentMarkLoader, { props: { variant: 'bloom', playing: true } });
    const root = view.container.querySelector('svg')!;
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
    const firstRoot = first.container.querySelector('svg')!;
    completeTransition();
    const second = render(IntentMarkLoader, { props: { variant: 'twist', playing: true } });
    const secondRoot = second.container.querySelector('svg')!;
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

  it('samples Bloom sparsely with compositor properties and no JS frame loop', () => {
    expect(intentMarkMotionTiming).toMatchObject({
      settleMs: 160,
      bloomMs: 61_000 / 30,
      pulseMs: 61_000 / 30,
      twistMs: 110_000 / 30,
    });
    render(IntentMarkLoader, { props: { variant: 'bloom', playing: true } });
    completeTransition();
    const loops = records.slice(-5);
    expect(loops.every(({ frames }) => frames.length === 11)).toBe(true);
    expect(loops.every(({ options }) => options.duration === 61_000 / 30)).toBe(true);
    expect(
      loops.every(({ frames }) =>
        frames.every(
          ({ d, strokeWidth, transformOrigin }) => !d && !strokeWidth && !transformOrigin,
        ),
      ),
    ).toBe(true);
    const paths = loops.map(({ target }) => target as SVGPathElement);
    expect(paths.every((path) => path.style.strokeWidth === '18.45088')).toBe(true);
    expect(paths.every((path) => path.style.transformOrigin === '128px 101px')).toBe(true);
  });
});
