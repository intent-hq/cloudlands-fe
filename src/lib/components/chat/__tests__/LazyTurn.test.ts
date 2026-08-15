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
    const scrollRoot = document.createElement('div');
    const heightCache = createLazyTurnHeightCache('large-transcript');
    const view = render(LazyTurn, {
      props: { turnKey: 'turn-1', heightCache, scrollRoot, forceVisible: true, children },
    });
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
    await new Promise((resolve) => setTimeout(resolve, 60));
    await tick();

    expect(view.queryByTestId('turn-content')).toBeNull();
    expect(view.container.querySelector<HTMLElement>('.lazy-turn-placeholder')?.style.height).toBe(
      '320px',
    );
    expect(heightCache.get('turn-1', 800)).toBe(320);
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
});
