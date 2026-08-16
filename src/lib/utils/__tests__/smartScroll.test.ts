import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  animateScrollTo,
  beforeFollowBottomMutation,
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
  let resizeObserved: Element[];
  let resizeUnobserved: Element[];
  let mutationCallbacks: MutationCallback[];
  let scrollHeight: number;
  let clientHeight: number;
  let scrollTop: number;
  let container: HTMLElement;

  beforeEach(() => {
    animationFrames = [];
    resizeCallbacks = [];
    resizeObserved = [];
    resizeUnobserved = [];
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
        observe(element: Element) {
          resizeObserved.push(element);
        }
        unobserve(element: Element) {
          resizeUnobserved.push(element);
        }
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
      clientWidth: { configurable: true, value: 300 },
      offsetWidth: { configurable: true, value: 320 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.max(0, Math.min(value, scrollHeight - clientHeight));
        },
      },
      getBoundingClientRect: {
        configurable: true,
        value: () => ({
          bottom: 300,
          height: 300,
          left: 0,
          right: 320,
          top: 0,
          width: 320,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }),
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

  function fireResizeFor(element: Element) {
    if (resizeObserved.includes(element)) fireResize();
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

  it('keeps a descendant mutation lease exact until its final settle', () => {
    const child = document.createElement('div');
    container.append(child);
    const action = followBottom(container, { follow: true });
    const mutation = beforeFollowBottomMutation(child);

    scrollHeight += 12;
    runFrame();
    expect(scrollTop).toBe(612);

    scrollHeight += 18;
    mutation.request();
    expect(scrollTop).toBe(630);

    scrollHeight += 24;
    mutation.settle();
    expect(scrollTop).toBe(654);
    action.destroy();
  });

  it('corrects narrow leased growth before an already-queued sampler frame', () => {
    const wrapper = document.createElement('div');
    const row = document.createElement('div');
    wrapper.append(row);
    container.append(wrapper);
    const action = followBottom(container, { follow: true });
    const trace: Array<{
      phase: string;
      maximum: number;
      scrollTop: number;
      distance: number;
      settleFrames: number;
    }> = [];
    requestAnimationFrame(() => {
      const maximum = scrollHeight - clientHeight;
      trace.push({
        phase: 'edit-grow-first-frame',
        maximum,
        scrollTop,
        distance: maximum - scrollTop,
        settleFrames: animationFrames.length,
      });
    });

    const mutation = beforeFollowBottomMutation(row);
    expect(resizeObserved).toContain(row);
    expect(animationFrames).toHaveLength(2);
    scrollHeight += 13;
    fireResizeFor(row);
    runFrame();

    expect(trace).toEqual([
      {
        phase: 'edit-grow-first-frame',
        maximum: 613,
        scrollTop: 613,
        distance: 0,
        settleFrames: 0,
      },
    ]);
    mutation.settle();
    expect(resizeUnobserved).toContain(row);
    action.destroy();
  });

  it('invalidates descendant leases when the follow action is destroyed', () => {
    const child = document.createElement('div');
    container.append(child);
    const action = followBottom(container, { follow: true });
    const mutation = beforeFollowBottomMutation(child);
    action.destroy();
    const framesAfterDestroy = animationFrames.length;

    scrollHeight = 1000;
    mutation.request();
    mutation.settle();

    expect(scrollTop).toBe(600);
    expect(animationFrames).toHaveLength(framesAfterDestroy);
    runFrame();
    expect(scrollTop).toBe(600);
    expect(animationFrames).toHaveLength(0);
  });

  it('leaves an unlocked viewport unchanged through descendant mutation requests', () => {
    const child = document.createElement('div');
    container.append(child);
    const action = followBottom(container, { follow: false });
    const mutation = beforeFollowBottomMutation(child);

    scrollHeight += 120;
    mutation.request();
    runFrame();
    mutation.settle();

    expect(scrollTop).toBe(600);
    expect(isFollowingBottom(container)).toBe(false);
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

  it('stays unlocked after a content click, collapse clamp, and later growth', () => {
    const followChanges: boolean[] = [];
    const action = followBottom(container, {
      follow: true,
      onFollowChange: (follow) => followChanges.push(follow),
    });
    container.dispatchEvent(new WheelEvent('wheel', { deltaY: -20 }));
    container.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 100 }));

    scrollHeight = 600;
    scrollTop = 300;
    container.dispatchEvent(new Event('scroll'));
    scrollHeight = 700;
    fireResize();
    runFrame();

    expect(scrollTop).toBe(300);
    expect(isFollowingBottom(container)).toBe(false);
    expect(followChanges).toEqual([false]);
    action.destroy();
  });

  it('re-locks after a downward scrollbar drag reaches the bottom', () => {
    const followChanges: boolean[] = [];
    const action = followBottom(container, {
      follow: false,
      onFollowChange: (follow) => followChanges.push(follow),
    });
    scrollTop = 300;
    container.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 315 }));
    scrollTop = 600;
    container.dispatchEvent(new Event('scroll'));

    expect(isFollowingBottom(container)).toBe(true);
    expect(followChanges).toEqual([true]);
    action.destroy();
  });

  it('does not re-lock after a scrollbar interaction moves upward because of a clamp', () => {
    const followChanges: boolean[] = [];
    const action = followBottom(container, {
      follow: false,
      onFollowChange: (follow) => followChanges.push(follow),
    });
    scrollTop = 500;
    container.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 315 }));
    scrollHeight = 600;
    scrollTop = 300;
    container.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new MouseEvent('pointerup'));
    scrollHeight = 700;
    fireResize();

    expect(scrollTop).toBe(300);
    expect(isFollowingBottom(container)).toBe(false);
    expect(followChanges).toEqual([]);
    action.destroy();
  });

  it('keeps a followed scrollbar hold locked through shrink and later growth', () => {
    const followChanges: boolean[] = [];
    const action = followBottom(container, {
      follow: true,
      onFollowChange: (follow) => followChanges.push(follow),
    });
    container.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 315 }));
    scrollHeight = 600;
    scrollTop = 300;
    container.dispatchEvent(new Event('scroll'));
    scrollHeight = 700;
    fireResize();
    runFrame();

    expect(scrollTop).toBe(400);
    expect(isFollowingBottom(container)).toBe(true);
    expect(followChanges).toEqual([]);
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
