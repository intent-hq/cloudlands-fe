// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as indicatorsApi from './index';
import IntentMarkLoader from './IntentMarkLoader.svelte';
import { intentMarkMotionTiming, intentMarkVariants } from './intent-mark-motion';
import { intentMarkPoses } from './intent-mark-poses';
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
let initiallyIntersecting: boolean | undefined = true;
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
  return Array.from(root.querySelectorAll<SVGPathElement>('[data-mark-arm]')).map(
    (arm) => arm.style.cssText,
  );
}

function isDriven(root: Element): boolean {
  const transforms = armTransforms(root);
  return root.getAttribute('data-motion-state') === 'playing' && transforms.length === 5;
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
  initiallyIntersecting = true;
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
      constructor(private callback: IntersectionObserverCallback) {
        intersectionCallbacks.push(callback);
      }
      observe(target: Element) {
        if (initiallyIntersecting !== undefined)
          this.callback(
            [{ isIntersecting: initiallyIntersecting, target } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
      }
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
  it('reads the entire outgoing pose before the first freeze write', async () => {
    const view = render(IntentMarkLoader, { props: { variant: 'twist', playing: true } });
    completeTransition();
    advanceFrames(40);
    const events: string[] = [];
    const read = window.getComputedStyle;
    const write = CSSStyleDeclaration.prototype.setProperty;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((...args) => {
      events.push('read');
      return read(...args);
    });
    vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty').mockImplementation(function (...args) {
      events.push('write');
      return write.apply(this, args);
    });
    await view.rerender({ variant: 'pulse', playing: true });
    expect(events.filter((event) => event === 'read')).toHaveLength(6);
    expect(events.indexOf('write')).toBeGreaterThan(events.lastIndexOf('read'));
  });

  it('finishes a handoff by timeout and never revives a destroyed driver', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const view = render(IntentMarkLoader, { props: { variant: 'pulse', playing: true } });
      const root = view.getByRole('status');
      const stale = records[0];
      vi.advanceTimersByTime(intentMarkMotionTiming.settleMs);
      expect(isDriven(root)).toBe(true);
      expect(frameCallbacks.size).toBe(1);
      await view.rerender({ variant: 'twist', playing: true });
      view.unmount();
      vi.runAllTimers();
      stale.finish();
      expect(root.getAttribute('data-motion-state')).toBe('destroyed');
      expect(frameCallbacks.size).toBe(0);
      expect(records.every(({ cancel }) => cancel.mock.calls.length > 0)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not rewrite a held Twist pose on subsequent clock slots', async () => {
    const view = render(IntentMarkLoader, { props: { variant: 'twist', playing: true } });
    const root = view.getByRole('status');
    completeTransition();
    advanceFrames(96, 1000 / 30);
    const onMutation = vi.fn();
    const observer = new MutationObserver(onMutation);
    observer.observe(root, { attributes: true, subtree: true, attributeFilter: ['style'] });
    advanceFrames(10, 1000 / 30);
    await Promise.resolve();
    observer.disconnect();
    expect(onMutation).not.toHaveBeenCalled();
  });

  it('defers all animation setup until the first visible observation', async () => {
    initiallyIntersecting = undefined;
    const readStyle = vi.spyOn(window, 'getComputedStyle');
    const view = render(IntentMarkLoader, { props: { variant: 'bloom', playing: true } });
    const root = view.container.querySelector<SVGSVGElement>('svg')!;
    const originalLayer = root.firstElementChild;
    const intersect = (isIntersecting: boolean) =>
      intersectionCallbacks[0](
        [{ isIntersecting, target: root } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    expect(records).toHaveLength(0);
    intersect(false);
    await view.rerender({ variant: 'twist', playing: true });
    intersect(false);
    expect(records).toHaveLength(0);
    expect(readStyle).not.toHaveBeenCalled();
    expect(root.firstElementChild).toBe(originalLayer);
    intersect(true);
    completeTransition();
    expect(isDriven(root)).toBe(true);
    expect(root.querySelector<SVGGElement>('[data-mark-layer]')?.dataset.markLayer).toBe('twist');
  });

  it('falls back to animation when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const view = render(IntentMarkLoader, { props: { variant: 'pulse', playing: true } });
    completeTransition();
    expect(isDriven(view.getByRole('status'))).toBe(true);
  });

  it('leaves the neutral DOM alone during repeated hidden and reduced-motion updates', async () => {
    const view = render(IntentMarkLoader, { props: { variant: 'bloom', playing: true } });
    const root = view.getByRole('status');
    completeTransition();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    const neutral = root.firstElementChild;
    const mutations = vi.spyOn(root, 'replaceChildren');
    const readStyle = vi.spyOn(window, 'getComputedStyle');
    for (const variant of ['pulse', 'twist', 'bloom'] as const) {
      await view.rerender({ variant, playing: true });
      document.dispatchEvent(new Event('visibilitychange'));
      reducedMotion = true;
      mediaChange?.();
    }
    expect(mutations).not.toHaveBeenCalled();
    expect(readStyle).not.toHaveBeenCalled();
    expect(root.firstElementChild).toBe(neutral);
    expect(liveLoops(root)).toHaveLength(0);
    view.unmount();
    intersectionCallbacks[0](
      [{ isIntersecting: true, target: root } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(root.getAttribute('data-motion-state')).toBe('destroyed');
  });

  it.each(['pulse', 'bloom', 'twist'] as const)(
    'shares immutable %s poses without sharing driver lifetimes',
    (variant) => {
      const first = render(IntentMarkLoader, { props: { variant, playing: true } });
      completeTransition();
      const firstRoot = first.getByRole('status');
      const poses = Array.from({ length: 5 }, (_, arm) => intentMarkPoses(variant, arm));
      const second = render(IntentMarkLoader, { props: { variant, playing: true } });
      completeTransition();
      const secondRoot = second.container.querySelector('[data-slot="intent-mark-loader"]')!;
      for (let arm = 0; arm < poses.length; arm++) {
        expect(intentMarkPoses(variant, arm)).toBe(poses[arm]);
        expect(Reflect.set(poses[arm][0], 'opacity', '0.123')).toBe(false);
      }
      expect(frameCallbacks.size).toBe(1);
      first.unmount();
      const stopped = armTransforms(firstRoot);
      const before = armTransforms(secondRoot);
      advanceFrames(10);
      expect(armTransforms(firstRoot)).toEqual(stopped);
      expect(armTransforms(secondRoot)).not.toEqual(before);
      expect(isDriven(secondRoot)).toBe(true);
      expect(frameCallbacks.size).toBe(1);
    },
  );

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
      expect(root.querySelector<SVGGElement>('[data-mark-layer]')?.dataset.markLayer).toBe(to);
      expect(root.dataset.motionState).toBe('playing');
      expect(liveLoops(root)).toHaveLength(0);
      const arms = Array.from(root.querySelectorAll<SVGPathElement>('[data-mark-arm]'));
      const before = armTransforms(root);
      expect(arms.every((arm) => arm.style.willChange === '')).toBe(true);
      advanceFrames(2);
      expect(armTransforms(root)).not.toEqual(before);
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
    expect(isDriven(root)).toBe(true);
    expect(root.querySelector<SVGGElement>('[data-mark-layer]')?.dataset.markLayer).toBe('twist');
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

    expect(isDriven(root)).toBe(true);
    reducedMotion = true;
    mediaChange?.();
    expect(root.dataset.motionState).toBe('neutral');
    expect(isDriven(root)).toBe(false);
    expect(root.querySelector('[data-mark-layer="neutral"]')).not.toBeNull();
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
    expect(root.querySelector('[data-mark-layer="pulse"]')).not.toBeNull();
    completeTransition();
    expect(root.dataset.motionState).toBe('playing');
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

  it.each([
    ['pulse', 61],
    ['bloom', 61],
    ['twist', 110],
  ] as const)(
    'loops %s on native SVG paths with the original 30fps source duration',
    (variant, count) => {
      const view = render(IntentMarkLoader, { props: { variant, playing: true } });
      completeTransition();
      const root = view.getByRole('status');
      expect(liveLoops(root)).toHaveLength(0);
      expect(root.querySelectorAll('path[data-mark-arm]')).toHaveLength(5);
      expect(intentMarkMotionTiming[`${variant}Ms`]).toBe((count * 1000) / 30);
      const first = armTransforms(root);
      advanceFrames(count - 1, 1000 / 30);
      if (variant === 'bloom') expect(armTransforms(root)).not.toEqual(first);
      advanceFrames(1, 1000 / 30);
      expect(armTransforms(root)).toEqual(first);
    },
  );

  it('stops offscreen and resumes when visible without restarting unchanged props', async () => {
    const view = render(IntentMarkLoader, { props: { variant: 'pulse', playing: true } });
    const root = view.getByRole('status');
    completeTransition();
    advanceFrames(10);
    const originalLayer = root.firstElementChild;
    const originalPose = armTransforms(root);
    const recordCount = records.length;
    await view.rerender({ variant: 'pulse', playing: true, size: 64 });
    expect(root.firstElementChild).toBe(originalLayer);
    expect(armTransforms(root)).toEqual(originalPose);
    expect(records).toHaveLength(recordCount);
    const intersect = (isIntersecting: boolean) =>
      intersectionCallbacks[0](
        [{ isIntersecting, target: root } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    intersect(false);
    expect(frameCallbacks.size).toBe(0);
    expect(root.getAttribute('data-motion-state')).toBe('neutral');
    intersect(true);
    completeTransition();
    expect(isDriven(root)).toBe(true);
    expect(root.firstElementChild).not.toBe(originalLayer);
  });

  it('drives every Bloom frame from the shared 30 fps clock without perpetual animations or will-change hints', () => {
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
    const arms = Array.from(root.querySelectorAll<SVGPathElement>('[data-mark-arm]'));
    expect(arms.every((arm) => arm.style.willChange === '')).toBe(true);
    expect(arms.every((path) => path.getAttribute('stroke-width') === '18.45088')).toBe(true);

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
    const neutral = armTransforms(root);
    advanceFrames(60);
    expect(armTransforms(root)).toEqual(neutral);
    expect(frameCallbacks.size).toBe(0);
  });
});
