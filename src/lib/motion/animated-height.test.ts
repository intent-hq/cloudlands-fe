import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { animatedHeight } from './animated-height.svelte';

describe('animatedHeight', () => {
  let resize: ResizeObserverCallback;
  let frames: FrameRequestCallback[];
  let now: number;
  let reducedMotion: boolean;

  beforeEach(() => {
    frames = [];
    now = 0;
    reducedMotion = false;
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
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
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

  it('retargets in-flight height easing without resetting the current height', () => {
    let contentHeight = 20;
    const wrapper = document.createElement('div');
    const content = document.createElement('div');
    vi.spyOn(content, 'offsetHeight', 'get').mockImplementation(() => contentHeight);
    wrapper.append(content);

    const action = animatedHeight(wrapper);
    flushSync();
    expect(wrapper.style.height).toBe('20px');

    contentHeight = 100;
    resize([], {} as ResizeObserver);
    runFrame();
    const heightBeforeRetarget = Number.parseFloat(wrapper.style.height);
    expect(heightBeforeRetarget).toBeGreaterThan(20);
    expect(frames).toHaveLength(1);

    contentHeight = 10;
    resize([], {} as ResizeObserver);
    expect(Number.parseFloat(wrapper.style.height)).toBe(heightBeforeRetarget);

    let previousHeight = heightBeforeRetarget;
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

  it('updates instantly without scheduling animation frames under reduced motion', () => {
    reducedMotion = true;
    let contentHeight = 20;
    const wrapper = document.createElement('div');
    const content = document.createElement('div');
    vi.spyOn(content, 'offsetHeight', 'get').mockImplementation(() => contentHeight);
    wrapper.append(content);

    const action = animatedHeight(wrapper);
    flushSync();
    contentHeight = 60;
    resize([], {} as ResizeObserver);
    flushSync();

    expect(wrapper.style.height).toBe('60px');
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
    expect(wrapper.style.height).toBe('0px');

    action?.update?.({ open: true, tier: 'moderate' });
    flushSync();
    expect(wrapper.style.height).toBe('48px');
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
    expect(wrapper.style.height).toBe('80px');

    const incoming = document.createElement('div');
    incoming.dataset.animatedHeightTarget = '';
    vi.spyOn(incoming, 'offsetHeight', 'get').mockReturnValue(44);
    stack.append(incoming);
    await Promise.resolve();
    flushSync();

    expect(wrapper.style.height).toBe('44px');
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
    expect(wrapper.style.height).toBe('26.5px');
    action?.destroy?.();
  });
});
