/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { instrument, snapshot } from './operational-row-scale-probe';

const deliveries = new Map<ResizeObserver, ResizeObserverCallback>();
const page = {
  evaluate: async (callback: (argument: unknown) => unknown, argument: unknown) =>
    callback(argument),
} as unknown as Page;

beforeEach(() => {
  deliveries.clear();
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal(
    'PerformanceObserver',
    class {
      observe() {}
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        deliveries.set(this as unknown as ResizeObserver, callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it('attributes shared targets and lifecycle calls without retaining DOM targets strongly', async () => {
  await instrument(page);
  const target = document.createElement('div');
  target.dataset.operationalWindowKey = 'row';
  document.body.append(target);
  const callback = vi.fn();
  const first = new ResizeObserver(callback);
  const second = new ResizeObserver(callback);
  first.observe(target);
  first.observe(target);
  second.observe(target);
  const opened = await snapshot(page, 'opened');
  expect(opened.observed).toBe(2);
  expect(opened.unmatchedRegistrations).toBe(2);
  expect(opened.observerRecords.map((record) => record.callbackId)).toEqual([1, 1]);
  expect(opened.observerRecords.map((record) => record.targets[0].id)).toEqual([1, 1]);
  expect(opened.observerRecords[0].stages.setup.observe).toBe(2);
  expect(opened.observerRecords[0].constructorStack).toContain('ResizeObserver owner');
  expect(window.rowScaleProbe.observers.get(1)?.targets.get(1)?.node).toBeInstanceOf(WeakRef);

  target.remove();
  first.unobserve(target);
  const detached = await snapshot(page, 'detached');
  expect(detached.detachedObserved).toBe(1);
  expect(detached.observerRecords[0].stages.opened.unobserve).toBe(1);
  expect(detached.observerRecords[1].targets[0]).toMatchObject({
    id: 1,
    connected: false,
    collected: false,
  });
  second.disconnect();
  const destroyed = await snapshot(page, 'destroyed');
  expect(destroyed.observed).toBe(0);
  expect(destroyed.unmatchedRegistrations).toBe(0);
  expect(destroyed.observerRecords[1].stages.detached.disconnect).toBe(1);
  expect(destroyed.rowObserved).toBe(0);
});

it('forwards native callbacks while recording delivered target identities and stage', async () => {
  await instrument(page);
  const callback = vi.fn();
  const observer = new ResizeObserver(callback);
  const target = document.createElement('div');
  observer.observe(target);
  await snapshot(page, 'navigation');
  const entries = [{ target }] as ResizeObserverEntry[];
  deliveries.get(observer)!.call(observer, entries, observer);
  expect(callback).toHaveBeenCalledExactlyOnceWith(entries, observer);
  const result = await snapshot(page, 'settled');
  expect(result.observerRecords[0].stages.navigation.callbacks).toBe(1);
  expect(result.observerRecords[0].lastCallback).toEqual({
    stage: 'navigation',
    targets: [1],
    detached: 1,
  });
});
