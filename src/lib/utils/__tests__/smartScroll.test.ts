import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  animateScrollTo,
  FOLLOW_BOTTOM_MAX_SETTLE_FRAMES,
  followBottom,
  followToBottom,
  isFollowingBottom,
} from '../smartScroll';

describe('animateScrollTo', () => {
  let rafCallbacks: FrameRequestCallback[];
  let now: number;

  beforeEach(() => {
    rafCallbacks = [];
    now = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Run all currently scheduled frames at the given timestamp. */
  function runFrames(time: number) {
    const cbs = rafCallbacks;
    rafCallbacks = [];
    for (const cb of cbs) cb(time);
  }

  function makeContainer(scrollTop = 0): HTMLElement {
    return { scrollTop } as HTMLElement;
  }

  it('does nothing when the container is null at start', () => {
    animateScrollTo(() => null, 100);
    expect(rafCallbacks).toHaveLength(0);
  });

  it('animates scrollTop to the target and stops scheduling at completion', () => {
    const container = makeContainer(0);
    animateScrollTo(() => container, 100, 150);
    expect(rafCallbacks).toHaveLength(1);

    runFrames(75);
    expect(container.scrollTop).toBeGreaterThan(0);
    expect(container.scrollTop).toBeLessThan(100);
    expect(rafCallbacks).toHaveLength(1);

    runFrames(150);
    expect(container.scrollTop).toBe(100);
    expect(rafCallbacks).toHaveLength(0);
  });

  it('stops cleanly when the container becomes null mid-animation', () => {
    let container: HTMLElement | null = makeContainer(0);
    animateScrollTo(() => container, 100, 150);

    runFrames(75);
    const scrollTopAtUnmount = container!.scrollTop;
    expect(rafCallbacks).toHaveLength(1);

    const detached = container!;
    container = null;
    runFrames(100);

    expect(detached.scrollTop).toBe(scrollTopAtUnmount);
    expect(rafCallbacks).toHaveLength(0);
  });

  it('stops cleanly when the container is undefined mid-animation', () => {
    let container: HTMLElement | undefined = makeContainer(50);
    animateScrollTo(() => container, 0, 150);

    container = undefined;
    runFrames(75);

    expect(rafCallbacks).toHaveLength(0);
  });
});

describe('followToBottom', () => {
  it('synchronously enables an attached follower before settling at the exact maximum', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    const container = document.createElement('div');
    Object.defineProperties(container, {
      scrollHeight: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 300 },
    });
    const changes: boolean[] = [];
    const action = followBottom(container, {
      follow: false,
      onFollowChange: (follow) => changes.push(follow),
    });

    followToBottom(container);

    expect(container.scrollTop).toBe(600);
    expect(changes).toEqual([true]);
    action.destroy();
    vi.unstubAllGlobals();
  });
});

describe('followBottom policy', () => {
  let animationFrames: FrameRequestCallback[];
  let resizeCallbacks: ResizeObserverCallback[];
  let mutationCallbacks: MutationCallback[];
  let scrollHeight: number;
  let clientHeight: number;
  let scrollTop: number;
  let container: HTMLElement;

  beforeEach(() => {
    animationFrames = [];
    resizeCallbacks = [];
    mutationCallbacks = [];
    scrollHeight = 900;
    clientHeight = 300;
    scrollTop = 600;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      'MutationObserver',
      class {
        constructor(callback: MutationCallback) {
          mutationCallbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    container = document.createElement('div');
    Object.defineProperties(container, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, get: () => clientHeight },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.max(0, Math.min(value, scrollHeight - clientHeight));
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function runFrame() {
    const callbacks = animationFrames;
    animationFrames = [];
    callbacks.forEach((callback) => callback(performance.now()));
  }

  function fireResize() {
    resizeCallbacks[0]?.([], {} as ResizeObserver);
  }

  function fireMutation() {
    mutationCallbacks[0]?.([], {} as MutationObserver);
  }

  it('keeps a captured bottom lock exact through mutation and resize frames', () => {
    const distances: number[] = [];
    const action = followBottom(container, {
      follow: true,
      onScrollStateChange: (state) => distances.push(state.distanceFromBottom),
    });

    scrollHeight += 120;
    fireMutation();
    expect(scrollTop).toBe(720);
    expect(distances.at(-1)).toBe(0);

    scrollHeight += 30;
    fireResize();
    expect(scrollTop).toBe(750);
    runFrame();
    expect(scrollTop).toBe(750);
    expect(distances.every((distance) => distance === 0)).toBe(true);
    action.destroy();
  });

  it('unlocks before upward input and preserves the viewport through later layout changes', () => {
    const followChanges: boolean[] = [];
    const action = followBottom(container, {
      follow: true,
      onFollowChange: (follow) => followChanges.push(follow),
    });

    container.dispatchEvent(new WheelEvent('wheel', { deltaY: -20 }));
    expect(isFollowingBottom(container)).toBe(false);
    scrollHeight += 200;
    fireResize();
    runFrame();

    expect(scrollTop).toBe(600);
    expect(followChanges).toEqual([false]);
    action.destroy();
  });

  it('re-locks only after user input reaches the bottom', () => {
    const followChanges: boolean[] = [];
    const action = followBottom(container, {
      follow: false,
      onFollowChange: (follow) => followChanges.push(follow),
    });
    scrollTop = 600;
    container.dispatchEvent(new WheelEvent('wheel', { deltaY: 20 }));
    runFrame();

    expect(isFollowingBottom(container)).toBe(true);
    expect(followChanges).toEqual([true]);
    action.destroy();
  });

  it('bounds a continuously changing settle burst', () => {
    const action = followBottom(container, { follow: true });
    fireMutation();
    let frames = 0;
    while (animationFrames.length > 0) {
      scrollHeight += 1;
      runFrame();
      frames += 1;
    }

    expect(frames).toBe(FOLLOW_BOTTOM_MAX_SETTLE_FRAMES);
    expect(scrollTop).toBe(scrollHeight - clientHeight);
    action.destroy();
  });

  it('does not echo consumer follow updates and snaps on consumer re-lock', () => {
    const followChanges: boolean[] = [];
    const options = {
      follow: false,
      onFollowChange: (follow: boolean) => followChanges.push(follow),
    };
    const action = followBottom(container, options);
    scrollTop = 100;
    action.update({ ...options, follow: true });

    expect(scrollTop).toBe(600);
    expect(followChanges).toEqual([]);
    action.destroy();
  });
});
