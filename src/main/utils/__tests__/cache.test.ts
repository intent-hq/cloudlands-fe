import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCache,
  clearAllCaches,
  SWEEP_INTERVAL_MS,
  type Cache,
} from '../cache';

describe('cache', () => {
  const created: Cache<unknown, unknown>[] = [];

  function makeCache<K, V>(options?: Parameters<typeof createCache>[0]): Cache<K, V> {
    const cache = createCache<K, V>(options);
    created.push(cache as Cache<unknown, unknown>);
    return cache;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    for (const cache of created.splice(0)) {
      cache.dispose();
    }
    vi.useRealTimers();
  });

  describe('basic operations', () => {
    it('supports get/set/has/delete/clear/keys/size', () => {
      const cache = makeCache<string, number>({ name: 'basic' });
      expect(cache.name).toBe('basic');
      expect(cache.get('a')).toBeUndefined();
      expect(cache.has('a')).toBe(false);

      cache.set('a', 1);
      cache.set('b', 2);
      expect(cache.get('a')).toBe(1);
      expect(cache.has('b')).toBe(true);
      expect(cache.size).toBe(2);
      expect(cache.keys()).toEqual(expect.arrayContaining(['a', 'b']));

      expect(cache.delete('a')).toBe(true);
      expect(cache.delete('a')).toBe(false);
      expect(cache.size).toBe(1);

      cache.clear();
      expect(cache.size).toBe(0);
    });

    it('has infinite max size by default', () => {
      const cache = makeCache<number, number>();
      for (let i = 0; i < 10_000; i++) cache.set(i, i);
      expect(cache.size).toBe(10_000);
      expect(cache.get(0)).toBe(0);
    });
  });

  describe('TTL expiry', () => {
    it('expires entries lazily on get/has after cache-level TTL', () => {
      const cache = makeCache<string, string>({ ttlMs: 1000 });
      cache.set('k', 'v');
      vi.advanceTimersByTime(999);
      expect(cache.get('k')).toBe('v');
      vi.advanceTimersByTime(1);
      expect(cache.has('k')).toBe(false);
      expect(cache.get('k')).toBeUndefined();
      expect(cache.size).toBe(0);
    });

    it('does not expire entries when no TTL is set', () => {
      const cache = makeCache<string, string>();
      cache.set('k', 'v');
      vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1000);
      expect(cache.get('k')).toBe('v');
    });

    it('honors per-entry TTL override', () => {
      const cache = makeCache<string, string>({ ttlMs: 1000 });
      cache.set('short', 'a', { ttlMs: 100 });
      cache.set('default', 'b');
      vi.advanceTimersByTime(100);
      expect(cache.get('short')).toBeUndefined();
      expect(cache.get('default')).toBe('b');
    });

    it('supports per-entry TTL on a cache without a default TTL', () => {
      const cache = makeCache<string, string>();
      cache.set('ttl', 'a', { ttlMs: 50 });
      cache.set('forever', 'b');
      vi.advanceTimersByTime(50);
      expect(cache.has('ttl')).toBe(false);
      expect(cache.get('forever')).toBe('b');
    });
  });

  describe('LRU eviction', () => {
    it('evicts the least-recently-used entry at maxSize', () => {
      const cache = makeCache<string, number>({ maxSize: 2 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      expect(cache.has('a')).toBe(false);
      expect(cache.keys()).toEqual(['b', 'c']);
    });

    it('get refreshes recency', () => {
      const cache = makeCache<string, number>({ maxSize: 2 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.get('a');
      cache.set('c', 3);
      expect(cache.has('b')).toBe(false);
      expect(cache.keys()).toEqual(['a', 'c']);
    });

    it('re-setting an existing key refreshes recency without evicting', () => {
      const cache = makeCache<string, number>({ maxSize: 2 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('a', 10);
      expect(cache.size).toBe(2);
      cache.set('c', 3);
      expect(cache.has('b')).toBe(false);
      expect(cache.get('a')).toBe(10);
    });
  });

  describe('registry', () => {
    it('clearAllCaches clears every registered cache', () => {
      const a = makeCache<string, number>();
      const b = makeCache<string, number>({ ttlMs: 1000 });
      a.set('x', 1);
      b.set('y', 2);
      clearAllCaches();
      expect(a.size).toBe(0);
      expect(b.size).toBe(0);
    });

    it('dispose clears the cache and unregisters it', () => {
      const cache = makeCache<string, number>();
      cache.set('x', 1);
      cache.dispose();
      expect(cache.size).toBe(0);
      cache.set('y', 2);
      clearAllCaches();
      expect(cache.get('y')).toBe(2);
    });
  });

  describe('sweep timer', () => {
    it('sweeps expired entries periodically without reads', () => {
      const cache = makeCache<string, string>({ ttlMs: 1000 });
      cache.set('k', 'v');
      vi.advanceTimersByTime(SWEEP_INTERVAL_MS);
      expect(cache.size).toBe(0);
    });

    it('starts a single shared timer for multiple TTL caches', () => {
      const spy = vi.spyOn(globalThis, 'setInterval');
      const a = makeCache<string, string>({ ttlMs: 1000 });
      const b = makeCache<string, string>({ ttlMs: 2000 });
      a.set('x', '1');
      b.set('y', '2');
      expect(spy.mock.calls.filter(([, ms]) => ms === SWEEP_INTERVAL_MS)).toHaveLength(1);
      vi.advanceTimersByTime(SWEEP_INTERVAL_MS);
      expect(a.size).toBe(0);
      expect(b.size).toBe(0);
    });

    it('does not start the timer for caches without TTL', () => {
      const spy = vi.spyOn(globalThis, 'setInterval');
      makeCache<string, string>();
      expect(spy.mock.calls.filter(([, ms]) => ms === SWEEP_INTERVAL_MS)).toHaveLength(0);
    });

    it('starts the timer when a per-entry TTL is used on a non-TTL cache', () => {
      const spy = vi.spyOn(globalThis, 'setInterval');
      const cache = makeCache<string, string>();
      cache.set('k', 'v', { ttlMs: 100 });
      expect(spy.mock.calls.filter(([, ms]) => ms === SWEEP_INTERVAL_MS)).toHaveLength(1);
      vi.advanceTimersByTime(SWEEP_INTERVAL_MS);
      expect(cache.size).toBe(0);
    });

    it('stops the timer when no TTL caches remain, and restarts on a new TTL cache', () => {
      const clearSpy = vi.spyOn(globalThis, 'clearInterval');
      const cache = makeCache<string, string>({ ttlMs: 1000 });
      expect(vi.getTimerCount()).toBe(1);
      cache.dispose();
      expect(clearSpy).toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);

      const setSpy = vi.spyOn(globalThis, 'setInterval');
      makeCache<string, string>({ ttlMs: 1000 });
      expect(setSpy.mock.calls.filter(([, ms]) => ms === SWEEP_INTERVAL_MS)).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(1);
    });

    it('keeps the timer running while another TTL cache remains', () => {
      const a = makeCache<string, string>({ ttlMs: 1000 });
      const b = makeCache<string, string>({ ttlMs: 1000 });
      a.dispose();
      expect(vi.getTimerCount()).toBe(1);
      b.dispose();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});

