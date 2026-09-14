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
const frameCallbacks = new Map<number, FrameRequestCallback>();
let frameId = 0;
let nowMs = 0;
let reducedMotion = false;
let mediaChange: (() => void) | undefined;

const frameStepMs = 1000 / 60;

function advanceFrames(count: number, stepMs = frameStepMs): void {
  for (let frame = 0; frame < count; frame += 1) {
    nowMs += stepMs;
    const due = [...frameCallbacks.values()];
    frameCallbacks.clear();
    due.forEach((callback) => callback(nowMs));
  }
}

function armTransforms(root: Element): string[] {
  return Array.from(root.querySelectorAll<SVGSVGElement>('[data-mark-arm-box]')).map(
    (arm) => arm.style.transform,
  );
}

function isDriven(root: Element): boolean {
  const transforms = armTransforms(root);
  return transforms.length === 5 && transforms.every((transform) => transform !== '');
}

beforeEach(() => {
  records.length = 0;
  intersectionCallbacks.length = 0;
  frameCallbacks.clear();
  frameId = 0;
  // Advance monotonically between tests and off the 30 fps slot boundaries,
  // as real frame timestamps are.
  nowMs += 10_007;
  reducedMotion = false;
  mediaChange = undefined;
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      frameId += 1;
      frameCallbacks.set(frameId, callback);
      return frameId;
    }),
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => frameCallbacks.delete(id)),
  );
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
  document.documentElement.removeAttribute('data-window-blurred');
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

function liveMorphs(): AnimationRecord[] {
  return records.filter(
    ({ options, cancel }) => options.duration === 160 && cancel.mock.calls.length === 0,
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
    expect(container.querySelectorAll('[data-mark-arm-box]')).toHaveLength(5);
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
      const root = view.container.querySelector<HTMLElement>('[data-slot="intent-mark-loader"]')!;
      completeTransition();
      const originalRoot = root;

      await view.rerender({ variant: to, playing: true });
      expect(view.container.querySelector('[data-slot="intent-mark-loader"]')).toBe(originalRoot);
      expect(root.dataset.motionState).toBe('morphing');
      expect(root.dataset.handoffVariant).toBe(to);
      const morphs = liveMorphs();
      expect(morphs).toHaveLength(5);
      expect(morphs.every(({ frames }) => frames[0].d && frames[1].d)).toBe(true);
      completeTransition();
      expect(root.dataset.motionState).toBe('playing');
      expect(liveLoops(root)).toHaveLength(0);
      const arms = Array.from(root.querySelectorAll<SVGSVGElement>('[data-mark-arm-box]'));
      expect(arms.map((arm) => arm.style.transform)).toEqual(
        morphs.map(({ frames }) => frames[1].transform),
      );
      expect(arms.every((arm) => arm.style.willChange === '')).toBe(true);
      advanceFrames(2);
      expect(arms.map((arm) => arm.style.transform)).not.toEqual(
        morphs.map(({ frames }) => frames[1].transform),
      );
    },
  );

  it('samples a rapid mid-morph pose and does not restart the stale destination', async () => {
    const view = render(IntentMarkLoader, { props: { variant: 'pulse', playing: true } });
    const root = view.container.querySelector<HTMLElement>('[data-slot="intent-mark-loader"]')!;
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

    expect(isDriven(root)).toBe(true);
    reducedMotion = true;
    mediaChange?.();
    expect(root.dataset.motionState).toBe('neutral');
    expect(isDriven(root)).toBe(false);
    expect(armTransforms(root)).toEqual(['', '', '', '', '']);
    expect(frameCallbacks.size).toBe(0);
    view.unmount();
    expect(root.dataset.motionState).toBe('destroyed');
    expect(records.every(({ cancel }) => cancel.mock.calls.length > 0)).toBe(true);
  });

  it('rests while the window is blurred and resumes through the canonical handoff', async () => {
    const view = render(IntentMarkLoader, { props: { variant: 'bloom', playing: true } });
    const root = view.container.querySelector<HTMLElement>('[data-slot="intent-mark-loader"]')!;
    completeTransition();
    expect(root.dataset.motionState).toBe('playing');

    document.documentElement.setAttribute('data-window-blurred', '');
    await vi.waitFor(() => expect(root.dataset.motionState).toBe('neutral'));
    expect(isDriven(root)).toBe(false);
    expect(frameCallbacks.size).toBe(0);
    expect(records.every(({ cancel }) => cancel.mock.calls.length > 0)).toBe(true);

    await view.rerender({ variant: 'pulse', playing: true });
    expect(root.dataset.motionState).toBe('neutral');
    expect(isDriven(root)).toBe(false);

    document.documentElement.removeAttribute('data-window-blurred');
    await vi.waitFor(() => expect(root.dataset.motionState).toBe('morphing'));
    expect(root.dataset.handoffVariant).toBe('pulse');
    completeTransition();
    expect(root.dataset.motionState).toBe('playing');
    expect(root.dataset.loopPhase).toBe('0.5');
    expect(isDriven(root)).toBe(true);

    const observedRecords = records.length;
    view.unmount();
    document.documentElement.setAttribute('data-window-blurred', '');
    document.documentElement.removeAttribute('data-window-blurred');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.dataset.motionState).toBe('destroyed');
    expect(records).toHaveLength(observedRecords);
    expect(frameCallbacks.size).toBe(0);
  });

  it('stays neutral when mounted into an already blurred window', async () => {
    document.documentElement.setAttribute('data-window-blurred', '');
    const view = render(IntentMarkLoader, { props: { variant: 'twist', playing: true } });
    const root = view.container.querySelector<HTMLElement>('[data-slot="intent-mark-loader"]')!;
    expect(root.dataset.motionState).toBe('neutral');
    expect(records).toHaveLength(0);
    expect(frameCallbacks.size).toBe(0);

    document.documentElement.removeAttribute('data-window-blurred');
    await vi.waitFor(() => expect(root.dataset.motionState).toBe('morphing'));
    completeTransition();
    expect(root.dataset.motionState).toBe('playing');
    expect(isDriven(root)).toBe(true);
  });

  it('keeps concurrent indicators independent when one stops', async () => {
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
    expect(isDriven(firstRoot)).toBe(true);
    expect(isDriven(secondRoot)).toBe(true);

    await first.rerender({ variant: 'bloom', playing: false });
    completeTransition();
    expect(firstRoot.dataset.motionState).toBe('neutral');
    expect(isDriven(firstRoot)).toBe(false);
    expect(secondRoot.dataset.motionState).toBe('playing');
    const before = armTransforms(secondRoot);
    advanceFrames(2);
    expect(armTransforms(secondRoot)).not.toEqual(before);
    expect(isDriven(firstRoot)).toBe(false);
  });

  it('drives every Bloom frame from the shared 30 fps clock without compositor layers', () => {
    expect(intentMarkMotionTiming).toMatchObject({
      settleMs: 160,
      bloomMs: 61_000 / 30,
      pulseMs: 61_000 / 30,
      twistMs: 110_000 / 30,
    });
    const { container } = render(IntentMarkLoader, { props: { variant: 'bloom', playing: true } });
    const root = container.querySelector<HTMLElement>('[data-slot="intent-mark-loader"]')!;
    completeTransition();
    expect(liveLoops(root)).toHaveLength(0);
    const arms = Array.from(root.querySelectorAll<SVGSVGElement>('[data-mark-arm-box]'));
    expect(arms.every((arm) => arm.style.willChange === '')).toBe(true);
    const paths = arms.map((arm) => arm.querySelector('path')!);
    expect(paths.every((path) => path.style.strokeWidth === '18.45088')).toBe(true);
    expect(paths.every((path) => path.style.transformOrigin === '128px 101px')).toBe(true);

    // Two seconds of 60 Hz frames: poses change on at most every other frame
    // (30 fps slots) and Bloom walks its source frames without repeating a
    // pose between slots.
    const changes: string[][] = [];
    let previous = armTransforms(root);
    for (let frame = 0; frame < 120; frame += 1) {
      advanceFrames(1);
      const current = armTransforms(root);
      if (current.some((transform, index) => transform !== previous[index])) changes.push(current);
      previous = current;
    }
    expect(changes.length).toBeGreaterThanOrEqual(59);
    expect(changes.length).toBeLessThanOrEqual(61);
    const firstArm = changes.map((transforms) => transforms[0]);
    expect(new Set(firstArm).size).toBe(firstArm.length);
    expect(armTransforms(root).every((transform) => transform !== '')).toBe(true);
  });

  it('writes no poses while the window is blurred', async () => {
    const { container } = render(IntentMarkLoader, { props: { variant: 'bloom', playing: true } });
    const root = container.querySelector<HTMLElement>('[data-slot="intent-mark-loader"]')!;
    completeTransition();
    expect(isDriven(root)).toBe(true);
    advanceFrames(4);
    document.documentElement.setAttribute('data-window-blurred', '');
    await vi.waitFor(() => expect(root.dataset.motionState).toBe('neutral'));
    expect(frameCallbacks.size).toBe(0);
    advanceFrames(60);
    expect(armTransforms(root)).toEqual(['', '', '', '', '']);
    expect(frameCallbacks.size).toBe(0);
  });
});
