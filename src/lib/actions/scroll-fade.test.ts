// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scrollFade } from './scroll-fade';

describe('scrollFade', () => {
  let frames: FrameRequestCallback[];
  let element: HTMLElement;

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(readonly callback: ResizeObserverCallback) {}
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      'MutationObserver',
      class {
        constructor(readonly callback: MutationCallback) {}
        observe() {}
        disconnect() {}
      },
    );
    element = document.createElement('div');
    Object.defineProperties(element, {
      scrollTop: { configurable: true, value: 10 },
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 300 },
      scrollLeft: { configurable: true, value: 0 },
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, value: 100 },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('coalesces notifications and skips identical mask writes', () => {
    const maskSetter = vi.spyOn(element.style, 'maskImage', 'set');
    const action = scrollFade(element);

    expect(maskSetter).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(1);
    frames.shift()?.(performance.now());
    expect(maskSetter).toHaveBeenCalledTimes(2);
    element.dispatchEvent(new Event('scroll'));
    element.dispatchEvent(new Event('scroll'));
    element.dispatchEvent(new Event('scroll'));
    expect(frames).toHaveLength(1);

    frames.shift()?.(performance.now());
    expect(maskSetter).toHaveBeenCalledTimes(2);

    action.update({ fadeSize: 16 });
    action.update({ fadeSize: 16 });
    expect(frames).toHaveLength(1);
    frames.shift()?.(performance.now());
    expect(maskSetter).toHaveBeenCalledTimes(3);

    action.destroy();
  });
});
