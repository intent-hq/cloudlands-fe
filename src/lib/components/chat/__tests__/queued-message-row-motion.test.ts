/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureQueuedMessageRowMotion,
  queuedMessageRowTransition,
} from '../queued-message-row-motion';
import { followBottom } from '$lib/utils/smartScroll';

interface AnimationStub {
  onfinish: (() => void) | null;
  oncancel: (() => void) | null;
  cancel: ReturnType<typeof vi.fn>;
}

function motionNode(initialHeight: number, targetHeight: number) {
  const node = document.createElement('div');
  let visualHeight = initialHeight;
  const animations: AnimationStub[] = [];
  vi.spyOn(node, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        height: node.style.height === 'auto' ? targetHeight : visualHeight,
      }) as DOMRect,
  );
  const animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => {
    const animation: AnimationStub = {
      onfinish: null,
      oncancel: null,
      cancel: vi.fn(() => animation.oncancel?.()),
    };
    animations.push(animation);
    return animation;
  });
  Object.defineProperty(node, 'animate', { configurable: true, value: animate });
  return {
    node,
    animate,
    animations,
    setVisualHeight: (height: number) => (visualHeight = height),
  };
}

function scrollHarness(node: HTMLElement, follow: boolean) {
  let scrollHeight = 900;
  let scrollTop = 600;
  let animationFrames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    animationFrames.push(callback);
    return animationFrames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const root = document.createElement('div');
  root.append(node);
  Object.defineProperties(root, {
    scrollHeight: { configurable: true, get: () => scrollHeight },
    clientHeight: { configurable: true, value: 300 },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => (scrollTop = value),
    },
  });
  const action = followBottom(root, { follow });
  return {
    action,
    grow: (amount: number) => (scrollHeight += amount),
    runFrame() {
      const callbacks = animationFrames;
      animationFrames = [];
      callbacks.forEach((callback) => callback(performance.now()));
    },
    scrollTop: () => scrollTop,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('queued message row motion', () => {
  it('animates the persistent shell from measured height to intrinsic destination', () => {
    const harness = motionNode(28, 76);
    const play = captureQueuedMessageRowMotion(harness.node);
    expect(harness.node.style.height).toBe('28px');
    play();

    const frames = harness.animate.mock.calls[0][0] as Keyframe[];
    expect(frames[0].height).toBe('28px');
    expect(frames.at(-1)?.height).toBe('76px');
    expect(harness.node.style.overflow).toBe('hidden');
    harness.animations[0].onfinish?.();
    expect(harness.node.style.height).toBe('');
    expect(harness.node.style.overflow).toBe('');
  });

  it('interrupts and reverses from the current visual height', () => {
    const harness = motionNode(28, 76);
    captureQueuedMessageRowMotion(harness.node)();
    harness.setVisualHeight(46);
    const reverse = captureQueuedMessageRowMotion(harness.node);
    reverse();

    expect(harness.animations[0].cancel).toHaveBeenCalledOnce();
    const frames = harness.animate.mock.calls[1][0] as Keyframe[];
    expect(frames[0].height).toBe('46px');
  });

  it('uses an immediate shell transition for reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    const harness = motionNode(28, 76);
    expect(queuedMessageRowTransition(harness.node).duration).toBe(0);
    captureQueuedMessageRowMotion(harness.node)();
    expect(harness.animate).not.toHaveBeenCalled();
    expect(harness.node.style.height).toBe('');
  });

  it('keeps a followed root exact through intrinsic row motion frames', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    const harness = motionNode(28, 76);
    const scroll = scrollHarness(harness.node, true);
    captureQueuedMessageRowMotion(harness.node)();

    scroll.grow(12);
    scroll.runFrame();
    expect(scroll.scrollTop()).toBe(612);

    harness.animations[0].onfinish?.();
    scroll.grow(8);
    scroll.runFrame();
    expect(scroll.scrollTop()).toBe(620);
    scroll.action.destroy();
  });

  it('does not move an unlocked root when a row transition requests settlement', () => {
    const harness = motionNode(28, 76);
    const scroll = scrollHarness(harness.node, false);
    const transition = queuedMessageRowTransition(harness.node, undefined, { direction: 'out' });

    scroll.grow(24);
    transition.tick?.(0.5, 0.5);
    transition.tick?.(0, 1);

    expect(scroll.scrollTop()).toBe(600);
    scroll.action.destroy();
  });
});
