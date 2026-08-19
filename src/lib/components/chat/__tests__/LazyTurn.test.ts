/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LazyTurn from '../LazyTurn.svelte';
import { createLazyTurnHeightCache } from '../lazy-turn-height-cache';
import { inspectLazyTurnObserverOwnership } from '../lazy-turn-observer';

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  observed = new Set<Element>();
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.add(element);
  }
  unobserve(element: Element) {
    this.observed.delete(element);
  }
  disconnect() {
    this.observed.clear();
  }
  fire(isIntersecting: boolean) {
    this.callback(
      [...this.observed].map((target) => ({ target, isIntersecting }) as IntersectionObserverEntry),
      this as unknown as IntersectionObserver,
    );
  }
}

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }
  observe() {}
  disconnect() {}
  fire(height: number, width: number) {
    this.callback(
      [{ contentRect: { height, width } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

const children = createRawSnippet(() => ({
  render: () => '<div data-testid="turn-content">content</div>',
}));

describe('LazyTurn lifecycle', () => {
  beforeEach(() => {
    MockIntersectionObserver.instances = [];
    MockResizeObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    cleanup();
    expect(inspectLazyTurnObserverOwnership()).toEqual({ rootCount: 0, targetCount: 0 });
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('hands an aged force-visible turn to its mounted observer after measurement', async () => {
    vi.useFakeTimers();
    const scrollRoot = document.createElement('div');
    const heightCache = createLazyTurnHeightCache('large-transcript');
    const view = render(LazyTurn, {
      props: { turnKey: 'turn-1', heightCache, scrollRoot, forceVisible: true, children },
    });
    try {
      await tick();
      MockIntersectionObserver.instances[0].fire(false);
      await view.rerender({
        turnKey: 'turn-1',
        heightCache,
        scrollRoot,
        forceVisible: false,
        children,
      });
      MockResizeObserver.instances[0].fire(320, 800);
      // 50ms measurement debounce + the swap-out settle window.
      await vi.advanceTimersByTimeAsync(60 + 250);
      await tick();

      expect(view.queryByTestId('turn-content')).toBeNull();
      expect(
        view.container.querySelector<HTMLElement>('.lazy-turn-placeholder')?.style.height,
      ).toBe('320px');
      expect(heightCache.get('turn-1', 800)).toBe(320);
    } finally {
      view.unmount();
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it('cancels the pending initial animation frame on unmount', () => {
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', () => 41);
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
    const view = render(LazyTurn, {
      props: {
        turnKey: 'turn-unmount',
        heightCache: createLazyTurnHeightCache('unmount'),
        children,
      },
    });

    view.unmount();

    expect(cancelAnimationFrame).toHaveBeenCalledWith(41);
  });

  it('cancels the nested measurement timer on unmount', () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(240);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(640);
    const heightCache = createLazyTurnHeightCache('timer-unmount');
    const view = render(LazyTurn, {
      props: { turnKey: 'turn-unmount', heightCache, children },
    });

    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.runAllTimers();

    expect(heightCache.get('turn-unmount', 640)).toBeUndefined();
  });

  it('rejects a pending initial measurement after turn-key reuse', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(240);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(640);
    const heightCache = createLazyTurnHeightCache('key-reuse');
    const view = render(LazyTurn, {
      props: { turnKey: 'turn-before', heightCache, children },
    });

    await view.rerender({ turnKey: 'turn-after', heightCache, children });
    vi.runAllTimers();

    expect(heightCache.get('turn-before', 640)).toBeUndefined();
    expect(heightCache.get('turn-after', 640)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    view.unmount();
  });

  it('does not thrash content↔placeholder when the intersection state jitters at the boundary', async () => {
    // Repro regime: follow-bottom pinned during streaming. Every frame the
    // tail mutates and the scroller re-pins, so a turn sitting at the
    // IntersectionObserver boundary (rootMargin '100% 0px') is reported
    // alternately inside/outside the extended viewport on consecutive
    // frames. Without a settle window on the swap-out edge, each
    // notification performs a full content↔placeholder DOM swap — a 60fps
    // flicker (and, with a stale cached placeholder height, a per-frame
    // scrollHeight perturbation that feeds the jitter).
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(320);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
    const heightCache = createLazyTurnHeightCache('boundary-jitter');
    // Previously measured turn (placeholder height available → swap-out eligible).
    heightCache.set('turn-osc', 200, 800);
    const scrollRoot = document.createElement('div');
    const view = render(LazyTurn, {
      props: { turnKey: 'turn-osc', heightCache, scrollRoot, children },
    });
    try {
      await tick();
      const io = MockIntersectionObserver.instances[0];
      const container = view.container.querySelector<HTMLElement>('.lazy-turn');
      if (!container) throw new Error('missing .lazy-turn container');
      let swaps = 0;
      let last = container.getAttribute('data-lazy-visible');
      const sample = async () => {
        await tick();
        const current = container.getAttribute('data-lazy-visible');
        if (current !== last) {
          swaps++;
          last = current;
        }
      };

      // ~half a second of per-frame boundary jitter at 60fps.
      for (let frame = 0; frame < 30; frame++) {
        io.fire(frame % 2 === 0);
        await sample();
        await vi.advanceTimersByTimeAsync(16);
        await sample();
      }

      // Jitter stops with the turn outside the boundary; let things settle.
      io.fire(false);
      await vi.advanceTimersByTimeAsync(1000);
      await sample();

      // One swap-in when the turn first entered, one settled swap-out after
      // the noise stops. Pre-fix this swapped on every notification (30+).
      expect(swaps).toBeLessThanOrEqual(3);
      expect(view.queryByTestId('turn-content')).toBeNull();
      // The settled placeholder carries the freshly measured content height
      // (320px), not the stale seeded one (200px) — geometry-neutral swap.
      expect(
        view.container.querySelector<HTMLElement>('.lazy-turn-placeholder')?.style.height,
      ).toBe('320px');
    } finally {
      view.unmount();
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });
});
