import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  animateScrollTo,
  beforeFollowBottomMutation,
  captureScrollAnchor,
  followBottom,
  followToBottom,
  isFollowingBottom,
  isNativeScrollAnchoringActive,
  restoreScrollAnchor,
} from '../smartScroll';
import { safeDisclosureTransition } from '../../components/chat/disclosure-motion';

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
    const onComplete = vi.fn();
    animateScrollTo(() => container, 100, 150, onComplete);
    expect(rafCallbacks).toHaveLength(1);

    runFrames(75);
    expect(container.scrollTop).toBeGreaterThan(0);
    expect(container.scrollTop).toBeLessThan(100);
    expect(rafCallbacks).toHaveLength(1);
    expect(onComplete).not.toHaveBeenCalled();

    runFrames(150);
    expect(container.scrollTop).toBe(100);
    expect(rafCallbacks).toHaveLength(0);
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith(container);
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
    Object.defineProperty(container, 'scrollHeight', {
      configurable: true,
      value: opts.scrollHeight,
    });
    Object.defineProperty(container, 'clientHeight', {
      configurable: true,
      value: opts.clientHeight,
    });
    container.getBoundingClientRect = () =>
      ({
        top: 0,
        bottom: opts.clientHeight,
        left: 0,
        right: 0,
        width: 0,
        height: opts.clientHeight,
      }) as DOMRect;
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
    const container = makeScrollContainer({
      scrollTop: 550,
      scrollHeight: 1000,
      clientHeight: 400,
    });
    addMessage(container, 'm1', 20);

    const anchor = captureScrollAnchor(container);
    expect(anchor.isNearBottom).toBe(true);
    expect(anchor.element).toBeNull();

    restoreScrollAnchor(container, anchor);
    expect(container.scrollTop).toBe(550);
  });

  it('anchors the first visible element and compensates scrollTop by its movement', () => {
    // distance from bottom = 2000 - 500 - 400 = 1100 > 100 threshold
    const container = makeScrollContainer({
      scrollTop: 500,
      scrollHeight: 2000,
      clientHeight: 400,
    });
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
    const container = makeScrollContainer({
      scrollTop: 500,
      scrollHeight: 2000,
      clientHeight: 400,
    });
    const anchorEl = addMessage(container, 'doomed', 20);

    const anchor = captureScrollAnchor(container);
    expect(anchor.element).toBe(anchorEl);

    anchorEl.remove();
    expect(anchorEl.isConnected).toBe(false);

    expect(() => restoreScrollAnchor(container, anchor)).not.toThrow();
    expect(container.scrollTop).toBe(500);
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
  let resizeActive: Set<Element>;
  let mutationCallbacks: MutationCallback[];
  let mutationDisconnects: number;
  let scrollHeight: number;
  let clientHeight: number;
  let scrollTop: number;
  let container: HTMLElement;

  beforeEach(() => {
    animationFrames = [];
    resizeCallbacks = [];
    resizeObserved = [];
    resizeUnobserved = [];
    resizeActive = new Set();
    mutationCallbacks = [];
    mutationDisconnects = 0;
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
          resizeActive.add(element);
        }
        unobserve(element: Element) {
          resizeUnobserved.push(element);
          resizeActive.delete(element);
        }
        disconnect() {
          resizeActive.clear();
        }
      },
    );
    vi.stubGlobal(
      'MutationObserver',
      class {
        constructor(callback: MutationCallback) {
          mutationCallbacks.push(callback);
        }
        observe() {}
        disconnect() {
          mutationDisconnects += 1;
        }
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
    if (resizeActive.has(element)) fireResize();
  }

  function fireMutation() {
    mutationCallbacks[0]?.([], {} as MutationObserver);
  }

  function fireAttributeMutation(target: Node = container) {
    mutationCallbacks[0]?.(
      [{ type: 'attributes', target } as MutationRecord],
      {} as MutationObserver,
    );
  }

  function runSettleTail() {
    for (let frame = 0; frame < 10 && animationFrames.length > 0; frame += 1) runFrame();
  }

  function fireAddedMutation(node: Node) {
    mutationCallbacks[0]?.(
      [
        {
          type: 'childList',
          addedNodes: [node],
          removedNodes: [],
        } as unknown as MutationRecord,
      ],
      {} as MutationObserver,
    );
  }

  it('detaches and restores every listener and observer when disabled', () => {
    const removeContainerListener = vi.spyOn(container, 'removeEventListener');
    const removeWindowListener = vi.spyOn(window, 'removeEventListener');
    const action = followBottom(container, { enabled: true, follow: true });

    expect(isFollowingBottom(container)).toBe(true);
    expect(resizeActive.size).toBeGreaterThan(0);

    action.update({ enabled: false, follow: true });
    expect(isFollowingBottom(container)).toBe(false);
    expect(resizeActive.size).toBe(0);
    expect(mutationDisconnects).toBe(1);
    expect(removeContainerListener).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith('pointerup', expect.any(Function));

    action.update({ enabled: true, follow: true });
    expect(isFollowingBottom(container)).toBe(true);
    expect(resizeActive.size).toBeGreaterThan(0);

    action.destroy();
  });

  function fireRemovedMutation(node: Node) {
    mutationCallbacks[0]?.(
      [
        {
          type: 'childList',
          addedNodes: [],
          removedNodes: [node],
        } as unknown as MutationRecord,
      ],
      {} as MutationObserver,
    );
  }

  it('owns one native bottom anchor and restores existing child styles on destroy', () => {
    const child = document.createElement('div');
    const nested = document.createElement('div');
    child.style.overflowAnchor = 'auto';
    child.append(nested);
    container.append(child);

    const action = followBottom(container, { follow: true });
    const anchor = container.querySelector<HTMLElement>('[data-follow-bottom-anchor]');

    expect(anchor).not.toBeNull();
    expect(container.querySelectorAll('[data-follow-bottom-anchor]')).toHaveLength(1);
    expect(container.lastElementChild).toBe(anchor);
    expect(anchor?.getAttribute('aria-hidden')).toBe('true');
    expect(anchor?.style.height).toBe('1px');
    expect(anchor?.style.overflowAnchor).toBe('auto');
    expect(child.style.overflowAnchor).toBe('none');
    expect(nested.style.overflowAnchor).toBe('');

    action.destroy();
    expect(container.querySelector('[data-follow-bottom-anchor]')).toBeNull();
    expect(child.style.overflowAnchor).toBe('auto');
  });

  it('starts followed and idle with no pending animation frame', () => {
    const action = followBottom(container, { follow: true });

    expect(scrollTop).toBe(600);
    expect(animationFrames).toHaveLength(0);
    action.destroy();
  });

  it('attaches the native anchor only while following', () => {
    const child = document.createElement('div');
    child.style.overflowAnchor = 'auto';
    container.append(child);
    const action = followBottom(container, { follow: false });
    expect(container.querySelector('[data-follow-bottom-anchor]')).toBeNull();
    expect(child.style.overflowAnchor).toBe('auto');
    expect(isNativeScrollAnchoringActive(container)).toBe(true);

    action.update({ follow: true });
    const anchor = container.querySelector<HTMLElement>('[data-follow-bottom-anchor]')!;
    expect(anchor.style.overflowAnchor).toBe('auto');
    expect(child.style.overflowAnchor).toBe('none');
    expect(isNativeScrollAnchoringActive(container)).toBe(false);

    container.dispatchEvent(new WheelEvent('wheel', { deltaY: -20 }));
    expect(container.querySelector('[data-follow-bottom-anchor]')).toBeNull();
    expect(anchor.style.overflowAnchor).toBe('none');
    expect(child.style.overflowAnchor).toBe('auto');
    action.destroy();
  });

  it('keeps the native anchor last and restores mutation-added child styles', () => {
    const action = followBottom(container, { follow: true });
    const anchor = container.querySelector<HTMLElement>('[data-follow-bottom-anchor]')!;
    const child = document.createElement('div');
    child.style.overflowAnchor = 'auto';
    container.append(child);

    fireAddedMutation(child);
    expect(child.style.overflowAnchor).toBe('none');
    expect(container.lastElementChild).toBe(anchor);

    child.remove();
    fireRemovedMutation(child);
    expect(child.style.overflowAnchor).toBe('auto');
    action.destroy();
  });

  it('restores a detached child when destroy precedes mutation delivery', () => {
    const child = document.createElement('div');
    child.style.overflowAnchor = 'auto';
    container.append(child);
    const action = followBottom(container, { follow: true });

    child.remove();
    action.destroy();

    expect(child.style.overflowAnchor).toBe('auto');
  });

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

  it('repairs a non-user scroll without releasing the captured lock', () => {
    const followChanges: boolean[] = [];
    const action = followBottom(container, {
      follow: true,
      onFollowChange: (follow) => followChanges.push(follow),
    });

    scrollTop = 420;
    container.dispatchEvent(new Event('scroll'));

    expect(scrollTop).toBe(600);
    expect(isFollowingBottom(container)).toBe(true);
    expect(followChanges).toEqual([]);
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

  it('retains persistent direct-child observation across overlapping leases', () => {
    const child = document.createElement('div');
    container.append(child);
    const action = followBottom(container, { follow: true });
    expect(resizeActive.has(child)).toBe(true);
    const persistentObserveCalls = resizeObserved.filter((element) => element === child).length;
    const first = beforeFollowBottomMutation(child);
    const second = beforeFollowBottomMutation(child);

    expect(resizeObserved.filter((element) => element === child)).toHaveLength(
      persistentObserveCalls,
    );
    first.settle();
    expect(resizeActive.has(child)).toBe(true);
    expect(resizeUnobserved).not.toContain(child);
    second.settle();
    expect(resizeActive.has(child)).toBe(true);
    expect(resizeUnobserved).not.toContain(child);

    scrollHeight += 21;
    fireResizeFor(child);
    expect(scrollTop).toBe(621);
    action.destroy();
  });

  it('retains mutation-added persistent observation after lease settlement', () => {
    const action = followBottom(container, { follow: true });
    const child = document.createElement('div');
    container.append(child);
    fireAddedMutation(child);
    expect(resizeActive.has(child)).toBe(true);
    const mutation = beforeFollowBottomMutation(child);

    mutation.settle();
    expect(resizeActive.has(child)).toBe(true);
    expect(resizeUnobserved).not.toContain(child);
    scrollHeight += 17;
    fireResizeFor(child);
    expect(scrollTop).toBe(617);
    action.destroy();
  });

  it('releases a nested lease-only target only after its final lease', () => {
    const wrapper = document.createElement('div');
    const row = document.createElement('div');
    wrapper.append(row);
    container.append(wrapper);
    const action = followBottom(container, { follow: true });
    expect(resizeActive.has(row)).toBe(false);
    const first = beforeFollowBottomMutation(row);
    const second = beforeFollowBottomMutation(row);

    expect(resizeObserved.filter((element) => element === row)).toHaveLength(1);
    expect(resizeActive.has(row)).toBe(true);
    first.settle();
    expect(resizeActive.has(row)).toBe(true);
    expect(resizeUnobserved).not.toContain(row);
    second.settle();
    expect(resizeActive.has(row)).toBe(false);
    expect(resizeUnobserved.filter((element) => element === row)).toHaveLength(1);
    action.destroy();
  });

  it('corrects narrow leased growth when its resize observation delivers', () => {
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
    expect(resizeActive.size).toBe(0);

    scrollHeight = 1000;
    mutation.request();
    mutation.settle();

    expect(scrollTop).toBe(600);
    expect(animationFrames).toHaveLength(framesAfterDestroy);
    runFrame();
    expect(scrollTop).toBe(600);
    expect(animationFrames).toHaveLength(0);
  });

  it('releases a single-tick disclosure outro lease so the settle loop drains', () => {
    const child = document.createElement('div');
    container.append(child);
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      height: '40px',
      opacity: '1',
      paddingTop: '0px',
      paddingBottom: '0px',
      marginTop: '0px',
      marginBottom: '0px',
    } as CSSStyleDeclaration);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    const action = followBottom(container, { follow: true });
    // Fresh outro config: Svelte discards the cached options after introend,
    // so a `transition:` outro re-enters safeDisclosureTransition here.
    const outro = safeDisclosureTransition(child, {}, { direction: 'both' });
    expect(outro.tick).toBeDefined();

    // Throttled rAF delivers the whole outro as one tick at its end.
    outro.tick?.(0, 1);
    runSettleTail();

    expect(animationFrames).toHaveLength(0);
    action.destroy();
  });

  it('recovers a fresh outro whose first tick lands exactly on its start time', () => {
    const child = document.createElement('div');
    container.append(child);
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      height: '40px',
      opacity: '1',
      paddingTop: '0px',
      paddingBottom: '0px',
      marginTop: '0px',
      marginBottom: '0px',
    } as CSSStyleDeclaration);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    const action = followBottom(container, { follow: true });
    const outro = safeDisclosureTransition(child, {}, { direction: 'both' });
    expect(outro.tick).toBeDefined();

    // rAF timestamp exactly on the start time: easing(0) = 0 ⇒ t = 1, which
    // the t < 1 first-tick guard excludes — the early settle fires and the
    // falling ticks re-acquire through the reversal path.
    outro.tick?.(1, 0);
    scrollHeight -= 20;
    outro.tick?.(0.5, 0.5);
    expect(scrollTop).toBe(580);
    scrollHeight -= 20;
    outro.tick?.(0, 1);
    expect(scrollTop).toBe(560);
    runSettleTail();

    expect(animationFrames).toHaveLength(0);
    action.destroy();
  });

  it('keeps a both-direction intro pinned from its first tick and drains at rest', () => {
    const child = document.createElement('div');
    container.append(child);
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      height: '40px',
      opacity: '1',
      paddingTop: '0px',
      paddingBottom: '0px',
      marginTop: '0px',
      marginBottom: '0px',
    } as CSSStyleDeclaration);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    const action = followBottom(container, { follow: true });
    const intro = safeDisclosureTransition(child, {}, { direction: 'both' });
    expect(intro.tick).toBeDefined();

    intro.tick?.(0, 1);
    scrollHeight += 20;
    intro.tick?.(0.5, 0.5);
    expect(scrollTop).toBe(620);
    scrollHeight += 20;
    intro.tick?.(1, 0);
    expect(scrollTop).toBe(640);
    runSettleTail();

    expect(animationFrames).toHaveLength(0);
    action.destroy();
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

  it('unlocks after an upward scrollbar drag moves away from the bottom', () => {
    const followChanges: boolean[] = [];
    const action = followBottom(container, {
      follow: true,
      onFollowChange: (follow) => followChanges.push(follow),
    });
    container.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 315 }));
    scrollTop = 300;
    container.dispatchEvent(new Event('scroll'));

    expect(scrollTop).toBe(300);
    expect(isFollowingBottom(container)).toBe(false);
    expect(followChanges).toEqual([false]);
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

  it('keeps an active lease pinned beyond 80 frames, settles idle, and restarts later', () => {
    const followChanges: boolean[] = [];
    const child = document.createElement('div');
    container.append(child);
    const action = followBottom(container, {
      follow: true,
      onFollowChange: (follow) => followChanges.push(follow),
    });
    const mutation = beforeFollowBottomMutation(child);
    for (let frame = 0; frame < 81; frame += 1) {
      scrollHeight += 1;
      runFrame();
      expect(scrollTop).toBe(scrollHeight - clientHeight);
      expect(isFollowingBottom(container)).toBe(true);
    }

    expect(animationFrames).toHaveLength(1);
    mutation.settle();
    runSettleTail();
    expect(animationFrames).toHaveLength(0);

    scrollHeight += 17;
    fireMutation();
    expect(scrollTop).toBe(scrollHeight - clientHeight);
    expect(animationFrames).toHaveLength(1);
    runSettleTail();
    expect(animationFrames).toHaveLength(0);
    expect(followChanges).toEqual([]);
    action.destroy();
  });

  it('restarts an idle settle tail for attribute and resize observations', () => {
    const action = followBottom(container, { follow: true });
    expect(animationFrames).toHaveLength(0);

    scrollHeight += 11;
    fireAttributeMutation();
    expect(scrollTop).toBe(611);
    expect(animationFrames).toHaveLength(1);
    runSettleTail();
    expect(animationFrames).toHaveLength(0);

    scrollHeight += 13;
    fireResize();
    expect(scrollTop).toBe(624);
    expect(animationFrames).toHaveLength(1);
    runSettleTail();
    expect(animationFrames).toHaveLength(0);
    action.destroy();
  });

  it('defers the reactivation snap and layout reads to an animation frame', () => {
    const distances: number[] = [];
    const options = {
      enabled: true,
      follow: true,
      onScrollStateChange: (state: { distanceFromBottom: number }) =>
        distances.push(state.distanceFromBottom),
    };
    const action = followBottom(container, options);
    action.update({ ...options, enabled: false });

    // Content grew while the surface was retained/disabled.
    scrollHeight += 100;
    let layoutReads = 0;
    Object.defineProperty(container, 'scrollHeight', {
      configurable: true,
      get: () => {
        layoutReads += 1;
        return scrollHeight;
      },
    });
    Object.defineProperty(container, 'clientHeight', {
      configurable: true,
      get: () => {
        layoutReads += 1;
        return clientHeight;
      },
    });
    distances.length = 0;

    action.update({ ...options, enabled: true });
    expect(layoutReads).toBe(0);
    expect(scrollTop).toBe(600);
    expect(distances).toEqual([]);
    expect(isFollowingBottom(container)).toBe(true);
    expect(animationFrames).toHaveLength(1);

    runFrame();
    expect(layoutReads).toBeGreaterThan(0);
    expect(scrollTop).toBe(700);
    expect(distances).toEqual([0]);
    action.destroy();
  });

  it('applies an unfollowed reactivation without snapping to the bottom', () => {
    const options = { enabled: true, follow: true };
    const action = followBottom(container, options);
    action.update({ ...options, enabled: false });
    scrollTop = 300;

    action.update({ ...options, enabled: true, follow: false });
    expect(isFollowingBottom(container)).toBe(false);
    runFrame();

    expect(scrollTop).toBe(300);
    action.destroy();
  });

  it('abandons a pending reactivation snap when disabled before the frame', () => {
    const options = { enabled: true, follow: true };
    const action = followBottom(container, options);
    action.update({ ...options, enabled: false });
    scrollTop = 300;

    action.update({ ...options, enabled: true });
    expect(animationFrames).toHaveLength(1);
    action.update({ ...options, enabled: false });
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    runFrame();

    expect(scrollTop).toBe(300);
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
