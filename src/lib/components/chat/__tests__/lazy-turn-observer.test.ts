/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectLazyTurnObserverOwnership, observeLazyTurnVisibility } from '../lazy-turn-observer';

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  options?: IntersectionObserverInit;
  observed = new Set<Element>();
  disconnect = vi.fn(() => this.observed.clear());
  unobserve = vi.fn((element: Element) => this.observed.delete(element));
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    MockIntersectionObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.add(element);
  }
}

describe('LazyTurn shared observer ownership', () => {
  beforeEach(() => {
    MockIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uses one observer for 1,000 turns in one root and fully releases it', () => {
    const root = document.createElement('div');
    const elements = Array.from({ length: 1_000 }, () => document.createElement('div'));
    const releases = elements.map((element) => observeLazyTurnVisibility(element, root, () => {}));
    expect(MockIntersectionObserver.instances).toHaveLength(1);
    expect(inspectLazyTurnObserverOwnership()).toEqual({ rootCount: 1, targetCount: 1_000 });
    releases.forEach((release) => release());
    expect(inspectLazyTurnObserverOwnership()).toEqual({ rootCount: 0, targetCount: 0 });
  });

  it('materializes turns one viewport before they enter the visible area', () => {
    const root = document.createElement('div');
    const release = observeLazyTurnVisibility(document.createElement('div'), root, () => {});

    expect(MockIntersectionObserver.instances[0].options).toMatchObject({
      root,
      rootMargin: '100% 0px',
      threshold: 0,
    });
    release();
  });
});
