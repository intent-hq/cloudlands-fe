import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { animateScrollTo } from '../smartScroll';

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
