import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { animateScrollTo, captureScrollAnchor, restoreScrollAnchor } from '../smartScroll';

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

describe('captureScrollAnchor / restoreScrollAnchor', () => {
  /**
   * jsdom performs no layout, so scroll geometry and client rects are stubbed.
   * The container is a real DOM node (so querySelectorAll/isConnected behave
   * normally) with scrollTop/scrollHeight/clientHeight defined explicitly.
   */
  function makeScrollContainer(opts: {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  }): HTMLElement {
    const container = document.createElement('div');
    let scrollTop = opts.scrollTop;
    Object.defineProperty(container, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: opts.scrollHeight });
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: opts.clientHeight });
    container.getBoundingClientRect = () =>
      ({ top: 0, bottom: opts.clientHeight, left: 0, right: 0, width: 0, height: opts.clientHeight }) as DOMRect;
    document.body.appendChild(container);
    return container;
  }

  function addMessage(container: HTMLElement, id: string, top: number): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('data-message-id', id);
    el.getBoundingClientRect = () =>
      ({ top, bottom: top + 40, left: 0, right: 0, width: 0, height: 40 }) as DOMRect;
    container.appendChild(el);
    return el;
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('skips anchoring near the bottom and restore leaves scrollTop untouched', () => {
    // distance from bottom = 1000 - 550 - 400 = 50 <= 100 threshold
    const container = makeScrollContainer({ scrollTop: 550, scrollHeight: 1000, clientHeight: 400 });
    addMessage(container, 'm1', 20);

    const anchor = captureScrollAnchor(container);
    expect(anchor.isNearBottom).toBe(true);
    expect(anchor.element).toBeNull();

    restoreScrollAnchor(container, anchor);
    expect(container.scrollTop).toBe(550);
  });

  it('anchors the first visible element and compensates scrollTop by its movement', () => {
    // distance from bottom = 2000 - 500 - 400 = 1100 > 100 threshold
    const container = makeScrollContainer({ scrollTop: 500, scrollHeight: 2000, clientHeight: 400 });
    addMessage(container, 'above-viewport', -60); // above viewport, not eligible
    const anchorEl = addMessage(container, 'first-visible', 20);
    addMessage(container, 'second-visible', 80);

    const anchor = captureScrollAnchor(container);
    expect(anchor.isNearBottom).toBe(false);
    expect(anchor.element).toBe(anchorEl);
    expect(anchor.offsetFromViewport).toBe(20);

    // Simulate a 300px prepend above the anchor pushing it down in the viewport.
    anchorEl.getBoundingClientRect = () =>
      ({ top: 320, bottom: 360, left: 0, right: 0, width: 0, height: 40 }) as DOMRect;
    restoreScrollAnchor(container, anchor);
    expect(container.scrollTop).toBe(800);

    // Movement within the 5px jitter threshold is not compensated.
    anchorEl.getBoundingClientRect = () =>
      ({ top: 23, bottom: 63, left: 0, right: 0, width: 0, height: 40 }) as DOMRect;
    restoreScrollAnchor(container, { ...anchor, element: anchorEl });
    expect(container.scrollTop).toBe(800);
  });

  it('restores gracefully when the anchor element was removed from the DOM', () => {
    const container = makeScrollContainer({ scrollTop: 500, scrollHeight: 2000, clientHeight: 400 });
    const anchorEl = addMessage(container, 'doomed', 20);

    const anchor = captureScrollAnchor(container);
    expect(anchor.element).toBe(anchorEl);

    anchorEl.remove();
    expect(anchorEl.isConnected).toBe(false);

    expect(() => restoreScrollAnchor(container, anchor)).not.toThrow();
    expect(container.scrollTop).toBe(500);
  });
});
