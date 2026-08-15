/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createColumnVisibilityTracker } from './column-visibility';

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  elements = new Set<Element>();
  disconnected = false;

  constructor(
    private callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    MockIntersectionObserver.instances.push(this);
  }

  observe(element: Element) {
    this.elements.add(element);
  }

  unobserve(element: Element) {
    this.elements.delete(element);
  }

  disconnect() {
    this.elements.clear();
    this.disconnected = true;
  }

  fire(entries: Array<{ target: Element; isIntersecting: boolean }>) {
    this.callback(
      entries as IntersectionObserverEntry[],
      this as unknown as IntersectionObserver,
    );
  }
}

function element(): Element {
  return document.createElement('div');
}

describe('createColumnVisibilityTracker', () => {
  beforeEach(() => {
    MockIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('observes against the root with a one-viewport horizontal overscan', () => {
    const root = element();
    createColumnVisibilityTracker(root, () => {});

    const observer = MockIntersectionObserver.instances[0];
    expect(observer?.options).toEqual({ root, rootMargin: '0px 100% 0px 100%', threshold: 0 });
  });

  it('adds workspaceIds entering the window and removes them on exit', () => {
    const onChange = vi.fn();
    const tracker = createColumnVisibilityTracker(element(), onChange);
    const stackA = element();
    const stackB = element();
    tracker.setElements([
      { element: stackA, workspaceIds: ['ws-1'] },
      { element: stackB, workspaceIds: ['ws-2', 'ws-3'] },
    ]);
    const observer = MockIntersectionObserver.instances[0]!;
    expect(observer.elements).toEqual(new Set([stackA, stackB]));

    observer.fire([{ target: stackA, isIntersecting: true }]);
    expect(onChange).toHaveBeenLastCalledWith(new Set(['ws-1']));

    observer.fire([
      { target: stackA, isIntersecting: false },
      { target: stackB, isIntersecting: true },
    ]);
    expect(onChange).toHaveBeenLastCalledWith(new Set(['ws-2', 'ws-3']));
  });

  it('does not re-emit when the visible set is unchanged', () => {
    const onChange = vi.fn();
    const tracker = createColumnVisibilityTracker(element(), onChange);
    const stack = element();
    tracker.setElements([{ element: stack, workspaceIds: ['ws-1'] }]);
    const observer = MockIntersectionObserver.instances[0]!;

    observer.fire([{ target: stack, isIntersecting: true }]);
    observer.fire([{ target: stack, isIntersecting: true }]);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('unobserves removed stacks and drops their workspaceIds', () => {
    const onChange = vi.fn();
    const tracker = createColumnVisibilityTracker(element(), onChange);
    const stackA = element();
    const stackB = element();
    tracker.setElements([
      { element: stackA, workspaceIds: ['ws-1'] },
      { element: stackB, workspaceIds: ['ws-2'] },
    ]);
    const observer = MockIntersectionObserver.instances[0]!;
    observer.fire([
      { target: stackA, isIntersecting: true },
      { target: stackB, isIntersecting: true },
    ]);
    expect(onChange).toHaveBeenLastCalledWith(new Set(['ws-1', 'ws-2']));

    tracker.setElements([{ element: stackA, workspaceIds: ['ws-1'] }]);

    expect(observer.elements).toEqual(new Set([stackA]));
    expect(onChange).toHaveBeenLastCalledWith(new Set(['ws-1']));
  });

  it('disconnects the observer on destroy', () => {
    const tracker = createColumnVisibilityTracker(element(), () => {});
    tracker.setElements([{ element: element(), workspaceIds: ['ws-1'] }]);

    tracker.destroy();

    expect(MockIntersectionObserver.instances[0]?.disconnected).toBe(true);
  });

  it('seeds visibility synchronously from layout until the observer reports', () => {
    const rect = (left: number, right: number) =>
      ({ left, right, top: 0, bottom: 100, width: right - left, height: 100 }) as DOMRect;
    const root = element();
    root.getBoundingClientRect = () => rect(0, 800);
    const onChange = vi.fn();
    const tracker = createColumnVisibilityTracker(root, onChange);
    const near = element();
    near.getBoundingClientRect = () => rect(100, 500);
    const far = element();
    far.getBoundingClientRect = () => rect(2000, 2400);

    tracker.setElements([
      { element: near, workspaceIds: ['ws-near'] },
      { element: far, workspaceIds: ['ws-far'] },
    ]);

    // Within root + 100% horizontal overscan (-800..1600): near only.
    expect(onChange).toHaveBeenLastCalledWith(new Set(['ws-near']));

    // Observer data supersedes the estimate once entries arrive.
    const observer = MockIntersectionObserver.instances[0]!;
    observer.fire([
      { target: near, isIntersecting: false },
      { target: far, isIntersecting: true },
    ]);
    expect(onChange).toHaveBeenLastCalledWith(new Set(['ws-far']));

    // Later setElements calls no longer re-seed from layout.
    tracker.setElements([
      { element: near, workspaceIds: ['ws-near'] },
      { element: far, workspaceIds: ['ws-far'] },
    ]);
    expect(onChange).toHaveBeenLastCalledWith(new Set(['ws-far']));
  });

  it('does not seed from layout when the root has no size', () => {
    const onChange = vi.fn();
    const tracker = createColumnVisibilityTracker(element(), onChange);

    tracker.setElements([{ element: element(), workspaceIds: ['ws-1'] }]);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports every tracked column visible when IntersectionObserver is undefined', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const onChange = vi.fn();
    const tracker = createColumnVisibilityTracker(element(), onChange);

    tracker.setElements([
      { element: element(), workspaceIds: ['ws-1'] },
      { element: element(), workspaceIds: ['ws-2', 'ws-3'] },
    ]);

    expect(onChange).toHaveBeenLastCalledWith(new Set(['ws-1', 'ws-2', 'ws-3']));
    expect(MockIntersectionObserver.instances).toHaveLength(0);
  });
});
