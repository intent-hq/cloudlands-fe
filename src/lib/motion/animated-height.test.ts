import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleLayoutRead, scheduleLayoutWrite } from '$lib/utils/layout-phases';
import { animatedHeight } from './animated-height.svelte';

describe('animatedHeight', () => {
  let resize: ResizeObserverCallback;
  let frames: FrameRequestCallback[];
  let now: number;
  let reducedMotion: boolean;
  let resizeObservers: Array<{
    callback: ResizeObserverCallback;
    observe: ReturnType<typeof vi.fn>;
    unobserve: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }>;
  let motionChange: (event: { matches: boolean }) => void;
  let removeMotionListener: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    frames = [];
    now = 0;
    reducedMotion = false;
    resizeObservers = [];
    removeMotionListener = vi.fn();
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        get matches() {
          return reducedMotion;
        },
        addEventListener: vi.fn((_type, listener) => {
          motionChange = listener;
        }),
        removeEventListener: removeMotionListener,
      })),
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
          resizeObservers.push({
            callback,
            observe: this.observe,
            unobserve: this.unobserve,
            disconnect: this.disconnect,
          });
        }
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function runFrame() {
    now += 1000 / 60;
    const pending = frames;
    frames = [];
    pending.forEach((callback) => callback(now));
    flushSync();
  }

  it('mounts closed empty rows without reading geometry', () => {
    const wrappers = Array.from({ length: 100 }, () => document.createElement('div'));
    const reads = wrappers.map((wrapper) => vi.spyOn(wrapper, 'scrollHeight', 'get'));
    const actions = wrappers.map((wrapper) => animatedHeight(wrapper, false));
    flushSync();
    try {
      expect(reads.reduce((count, read) => count + read.mock.calls.length, 0)).toBe(0);
    } finally {
      actions.forEach((action) => action?.destroy?.());
    }
  });

  it('never measures closed content on resize or mutation', async () => {
    const wrapper = document.createElement('div');
    const content = document.createElement('div');
    wrapper.append(content);
    const read = vi.spyOn(window, 'getComputedStyle');
    const action = animatedHeight(wrapper, false);
    flushSync();
    runFrame();
    resize([], {} as ResizeObserver);
    content.append(document.createElement('span'));
    await Promise.resolve();
    runFrame();
    expect(read).not.toHaveBeenCalled();
    expect(wrapper.style.height).toBe('0px');
    action?.destroy?.();
  });

  it('batches every open measurement before any height writes and snaps historical mounts', () => {
    const events: string[] = [];
    const wrappers = Array.from({ length: 4 }, (_, index) => {
      const wrapper = document.createElement('div');
      vi.spyOn(wrapper, 'scrollHeight', 'get').mockImplementation(() => {
        events.push(`read:${index}`);
        return 40 + index;
      });
      vi.spyOn(wrapper.style, 'height', 'set').mockImplementation(() => {
        events.push(`write:${index}`);
      });
      return wrapper;
    });
    const actions = wrappers.map((wrapper) => animatedHeight(wrapper));
    flushSync();
    expect(events).toEqual([]);
    runFrame();
    expect(events.slice(0, 4)).toEqual(['read:0', 'read:1', 'read:2', 'read:3']);
    expect(events.slice(4)).toEqual(['write:0', 'write:1', 'write:2', 'write:3']);
    expect(frames).toHaveLength(0);
    runFrame();
    expect(frames).toHaveLength(0);
    actions.forEach((action) => action?.destroy?.());
  });

  it('coalesces observer bursts and drops an open measurement superseded in the write phase', () => {
    reducedMotion = true;
    const wrapper = document.createElement('div');
    const read = vi.spyOn(wrapper, 'scrollHeight', 'get').mockReturnValue(80);
    const action = animatedHeight(wrapper, false);
    flushSync();
    runFrame();
    action?.update?.(true);
    resize([], {} as ResizeObserver);
    resize([], {} as ResizeObserver);
    scheduleLayoutWrite(() => action?.update?.(false));
    runFrame();
    expect(read).toHaveBeenCalledTimes(1);
    expect(wrapper.style.height).toBe('0px');
    action?.destroy?.();
  });

  it('defers measurements requested during writes until the next read phase', () => {
    const wrapper = document.createElement('div');
    const read = vi.spyOn(wrapper, 'scrollHeight', 'get').mockReturnValue(90);
    const action = animatedHeight(wrapper, false);
    flushSync();
    runFrame();
    scheduleLayoutWrite(() => action?.update?.(true));
    runFrame();
    expect(read).not.toHaveBeenCalled();
    runFrame();
    expect(read).toHaveBeenCalledOnce();
    action?.destroy?.();
  });

  it('disconnects mutation observers and ignores already-delivered mutation callbacks on teardown', () => {
    const callbacks: MutationCallback[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal(
      'MutationObserver',
      class {
        constructor(callback: MutationCallback) {
          callbacks.push(callback);
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const wrapper = document.createElement('div');
    const action = animatedHeight(wrapper, false);
    flushSync();
    action?.destroy?.();
    wrapper.append(document.createElement('div'));
    callbacks.forEach((callback) => callback([], {} as MutationObserver));
    runFrame();
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(resizeObservers[0].observe).toHaveBeenCalledOnce();
    expect(wrapper.style.height).toBe('');
  });

  it('cancels reads on destroy, disconnects observers and ignores stale callbacks', () => {
    const wrapper = document.createElement('div');
    wrapper.style.height = '7px';
    wrapper.style.overflow = 'visible';
    const read = vi.spyOn(wrapper, 'scrollHeight', 'get');
    const action = animatedHeight(wrapper);
    flushSync();
    action?.destroy?.();
    resize([], {} as ResizeObserver);
    runFrame();
    expect(read).not.toHaveBeenCalled();
    expect(wrapper.style.height).toBe('7px');
    expect(wrapper.style.overflow).toBe('visible');
    expect(resizeObservers[0].disconnect).toHaveBeenCalledOnce();
    expect(removeMotionListener).toHaveBeenCalledOnce();
  });

  it('cancels a measured target if destroyed before the write phase', () => {
    const wrapper = document.createElement('div');
    const read = vi.spyOn(wrapper, 'scrollHeight', 'get').mockReturnValue(90);
    const action = animatedHeight(wrapper);
    flushSync();
    scheduleLayoutRead(() => action?.destroy?.());
    runFrame();
    expect(read).toHaveBeenCalledOnce();
    expect(wrapper.style.height).toBe('');
    expect(wrapper.style.overflow).toBe('');
  });

  it('snaps an in-flight expansion when reduced motion is enabled and restores styles on destroy', () => {
    const wrapper = document.createElement('div');
    vi.spyOn(wrapper, 'scrollHeight', 'get').mockReturnValue(90);
    const action = animatedHeight(wrapper, false);
    flushSync();
    runFrame();
    action?.update?.(true);
    runFrame();
    runFrame();
    reducedMotion = true;
    motionChange({ matches: true });
    runFrame();
    expect(wrapper.style.height).toBe('90px');
    action?.destroy?.();
    runFrame();
    expect(wrapper.style.height).toBe('');
    expect(wrapper.style.overflow).toBe('');
  });

  it('retargets in-flight height easing without resetting the current height', () => {
    let contentHeight = 20;
    const wrapper = document.createElement('div');
    const content = document.createElement('div');
    vi.spyOn(content, 'offsetHeight', 'get').mockImplementation(() => contentHeight);
    wrapper.append(content);

    const action = animatedHeight(wrapper);
    flushSync();
    runFrame();
    expect(wrapper.style.height).toBe('20px');

    contentHeight = 100;
    resize([], {} as ResizeObserver);
    runFrame();
    runFrame();
    runFrame();
    const heightBeforeRetarget = Number.parseFloat(wrapper.style.height);
    expect(heightBeforeRetarget).toBeGreaterThan(20);
    expect(frames.length).toBeGreaterThan(0);

    contentHeight = 10;
    resize([], {} as ResizeObserver);
    expect(Number.parseFloat(wrapper.style.height)).toBe(heightBeforeRetarget);

    runFrame(); // Apply the new destination in the shared write phase.
    let previousHeight = Number.parseFloat(wrapper.style.height);
    for (let frame = 0; frame < 30 && frames.length > 0; frame += 1) {
      runFrame();
      const currentHeight = Number.parseFloat(wrapper.style.height);
      expect(currentHeight).toBeLessThanOrEqual(previousHeight);
      expect(currentHeight).toBeGreaterThanOrEqual(10);
      previousHeight = currentHeight;
    }
    expect(Number.parseFloat(wrapper.style.height)).toBeCloseTo(10, 2);
    action?.destroy?.();
  });

  it('updates in one layout frame without tweening under reduced motion', () => {
    reducedMotion = true;
    let contentHeight = 20;
    const wrapper = document.createElement('div');
    const content = document.createElement('div');
    vi.spyOn(content, 'offsetHeight', 'get').mockImplementation(() => contentHeight);
    wrapper.append(content);

    const action = animatedHeight(wrapper);
    flushSync();
    runFrame();
    contentHeight = 60;
    resize([], {} as ResizeObserver);
    flushSync();

    expect(wrapper.style.height).toBe('20px');
    runFrame();
    expect(wrapper.style.height).toBe('60px');
    runFrame();
    expect(frames).toHaveLength(0);
    action?.destroy?.();
  });

  it('supports tiered open state while preserving reduced-motion behavior', () => {
    reducedMotion = true;
    const wrapper = document.createElement('div');
    const content = document.createElement('div');
    vi.spyOn(content, 'offsetHeight', 'get').mockReturnValue(48);
    wrapper.append(content);

    const action = animatedHeight(wrapper, { open: false, tier: 'moderate' });
    flushSync();
    runFrame();
    expect(wrapper.style.height).toBe('0px');

    action?.update?.({ open: true, tier: 'moderate' });
    flushSync();
    runFrame();
    expect(wrapper.style.height).toBe('48px');
    runFrame();
    expect(frames).toHaveLength(0);
    action?.destroy?.();
  });

  it('measures the newest marked swap target before the outgoing target is removed', async () => {
    reducedMotion = true;
    const wrapper = document.createElement('div');
    const stack = document.createElement('div');
    const outgoing = document.createElement('div');
    outgoing.dataset.animatedHeightTarget = '';
    vi.spyOn(outgoing, 'offsetHeight', 'get').mockReturnValue(80);
    stack.append(outgoing);
    wrapper.append(stack);

    const action = animatedHeight(wrapper);
    flushSync();
    runFrame();
    expect(wrapper.style.height).toBe('80px');

    const incoming = document.createElement('div');
    incoming.dataset.animatedHeightTarget = '';
    vi.spyOn(incoming, 'offsetHeight', 'get').mockReturnValue(44);
    stack.append(incoming);
    await Promise.resolve();
    flushSync();

    runFrame();
    expect(wrapper.style.height).toBe('44px');
    expect(resizeObservers[0].unobserve).toHaveBeenCalledWith(outgoing);
    expect(resizeObservers[0].observe).toHaveBeenLastCalledWith(incoming);
    runFrame();
    expect(frames).toHaveLength(0);
    action?.destroy?.();
  });
  it('preserves fractional layout height under zoom and transforms', () => {
    reducedMotion = true;
    const wrapper = document.createElement('div');
    const content = document.createElement('div');
    content.style.cssText =
      'height: 20.5px; padding: 2px; border: 1px solid; transform: scale(2); zoom: 2';
    vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({ height: 106 } as DOMRect);
    wrapper.append(content);
    const action = animatedHeight(wrapper);
    flushSync();
    runFrame();
    expect(wrapper.style.height).toBe('26.5px');
    action?.destroy?.();
  });
});
