/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  inspectLazyTurnObserverOwnership,
  observeLazyTurnVisibility,
  scheduleLazyTurnDeliveryFlush,
} from '../lazy-turn-observer';

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

  it('coalesces same-target entries to the final state and delivers enters first', () => {
    const root = document.createElement('div');
    const old = document.createElement('div');
    const mid = document.createElement('div');
    const newer = document.createElement('div');
    const calls: string[] = [];
    const releaseOld = observeLazyTurnVisibility(old, root, (visible) =>
      calls.push(`old:${visible}`),
    );
    const releaseMid = observeLazyTurnVisibility(mid, root, (visible) =>
      calls.push(`mid:${visible}`),
    );
    const releaseNewer = observeLazyTurnVisibility(newer, root, (visible) =>
      calls.push(`newer:${visible}`),
    );
    const observer = MockIntersectionObserver.instances[0];

    // One delivery can carry several chronological entries per target; only
    // the final state per target is delivered (a stale exit replayed after
    // the final enter would strand an on-screen row as non-intersecting),
    // enters before exits, registration order within each side.
    observer.callback(
      [
        { target: mid, isIntersecting: true },
        { target: mid, isIntersecting: false },
        { target: newer, isIntersecting: false },
        { target: newer, isIntersecting: true },
        { target: old, isIntersecting: false },
        { target: old, isIntersecting: true },
      ] as IntersectionObserverEntry[],
      observer as unknown as IntersectionObserver,
    );

    expect(calls).toEqual(['old:true', 'newer:true', 'mid:false']);
    releaseOld();
    releaseMid();
    releaseNewer();
  });

  it('runs a scheduled flush once after all entry callbacks of one delivery', () => {
    const root = document.createElement('div');
    const first = document.createElement('div');
    const second = document.createElement('div');
    const calls: string[] = [];
    const flush = () => calls.push('flush');
    // Outside a delivery there is nothing to defer to: the caller flushes
    // immediately instead.
    expect(scheduleLazyTurnDeliveryFlush(flush)).toBe(false);
    const releaseFirst = observeLazyTurnVisibility(first, root, (visible) => {
      calls.push(`first:${visible}`);
      expect(scheduleLazyTurnDeliveryFlush(flush)).toBe(true);
    });
    const releaseSecond = observeLazyTurnVisibility(second, root, (visible) => {
      calls.push(`second:${visible}`);
      expect(scheduleLazyTurnDeliveryFlush(flush)).toBe(true);
    });
    const observer = MockIntersectionObserver.instances[0];

    // Both callbacks schedule the same flush during one delivery: it is
    // deduped by identity and runs once, after the last entry callback.
    observer.callback(
      [
        { target: first, isIntersecting: true },
        { target: second, isIntersecting: true },
      ] as IntersectionObserverEntry[],
      observer as unknown as IntersectionObserver,
    );

    expect(calls).toEqual(['first:true', 'second:true', 'flush']);
    releaseFirst();
    releaseSecond();
  });

  it('distinguishes rows in the visible viewport from rows in the preload margin', () => {
    const root = document.createElement('div');
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 300,
    } as DOMRect);
    const preload = document.createElement('div');
    const visible = document.createElement('div');
    const calls: string[] = [];
    const releasePreload = observeLazyTurnVisibility(preload, root, (nearby, onScreen) =>
      calls.push(`preload:${nearby}:${onScreen}`),
    );
    const releaseVisible = observeLazyTurnVisibility(visible, root, (nearby, onScreen) =>
      calls.push(`visible:${nearby}:${onScreen}`),
    );
    const observer = MockIntersectionObserver.instances[0];

    observer.callback(
      [
        { target: preload, isIntersecting: true, boundingClientRect: { top: 20, bottom: 80 } },
        { target: visible, isIntersecting: true, boundingClientRect: { top: 150, bottom: 220 } },
      ] as IntersectionObserverEntry[],
      observer as unknown as IntersectionObserver,
    );

    expect(calls).toEqual(['preload:true:false', 'visible:true:true']);
    releasePreload();
    releaseVisible();
  });
});
