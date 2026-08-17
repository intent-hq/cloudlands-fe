/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeWorkspaceColumnsOverlap } from './workspace-columns-overlap';

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  readonly observe = vi.fn();
  readonly disconnect = vi.fn();

  constructor(readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }
}

function scroller(scrollWidth: number, clientWidth: number) {
  const element = document.createElement('div');
  element.append(document.createElement('div'));
  Object.defineProperties(element, {
    scrollWidth: { configurable: true, value: scrollWidth },
    clientWidth: { configurable: true, value: clientWidth },
    scrollLeft: { configurable: true, value: 0, writable: true },
  });
  return element;
}

describe('workspace columns horizontal overlap', () => {
  beforeEach(() => {
    TestResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('tracks origin, positive scroll, and return to origin synchronously', () => {
    const element = scroller(1200, 800);
    const changes: boolean[] = [];
    observeWorkspaceColumnsOverlap(element, (overlap) => changes.push(overlap));

    expect(changes).toEqual([false]);
    element.scrollLeft = 1;
    element.dispatchEvent(new Event('scroll'));
    element.scrollLeft = 0;
    element.dispatchEvent(new Event('scroll'));
    expect(changes).toEqual([false, true, false]);
  });

  it('never overlaps when the canvas has no horizontal overflow', () => {
    const element = scroller(800, 800);
    const changes: boolean[] = [];
    const observer = observeWorkspaceColumnsOverlap(element, (value) => changes.push(value));
    element.scrollLeft = 40;
    observer.measure();
    expect(changes).toEqual([false]);
  });

  it('updates for programmatic scroll and resized content', () => {
    const element = scroller(800, 800);
    const changes: boolean[] = [];
    const observer = observeWorkspaceColumnsOverlap(element, (value) => changes.push(value));
    Object.defineProperty(element, 'scrollWidth', { configurable: true, value: 1200 });
    element.scrollLeft = 120;
    TestResizeObserver.instances[0].callback([], TestResizeObserver.instances[0] as never);
    observer.measure();
    expect(changes).toEqual([false, true]);
  });

  it('disconnects and clears active overlap on teardown', () => {
    const element = scroller(1200, 800);
    element.scrollLeft = 24;
    const changes: boolean[] = [];
    const observer = observeWorkspaceColumnsOverlap(element, (value) => changes.push(value));
    observer.destroy();
    element.dispatchEvent(new Event('scroll'));
    expect(changes).toEqual([true, false]);
    expect(TestResizeObserver.instances[0].disconnect).toHaveBeenCalledOnce();
  });
});
