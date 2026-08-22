import { describe, expect, it } from 'vitest';
import {
  arePanelTabCachesEqual,
  BROWSER_TAB_CACHE_TTL_MS,
  getNextPanelTabCacheExpiryDelay,
  updatePanelTabCache,
  type PanelTabCacheTab,
} from '../panel-tab-cache';

function tabs(...ids: string[]): PanelTabCacheTab[] {
  return ids.map((id) => ({ id }));
}

describe('panel tab cache', () => {
  it('keeps the active tab and drops tabs no longer in the panel', () => {
    const cache = new Map([
      ['active', 100],
      ['recent', 90],
      ['closed', 80],
    ]);

    const next = updatePanelTabCache(cache, tabs('active', 'recent'), 'active', 200, {
      ttlMs: 1_000,
    });

    expect(Array.from(next.keys()).sort()).toEqual(['active', 'recent']);
    expect(next.get('active')).toBe(200);
    expect(next.get('recent')).toBe(90);
  });

  it('evicts inactive tabs once their ttl has elapsed', () => {
    const cache = new Map([
      ['active', 0],
      ['stale', 0],
      ['recent', 50],
    ]);

    const next = updatePanelTabCache(cache, tabs('active', 'stale', 'recent'), 'active', 100, {
      ttlMs: 100,
    });

    expect(next.has('active')).toBe(true);
    expect(next.has('stale')).toBe(false);
    expect(next.has('recent')).toBe(true);
  });

  it('keeps an inactive browser tab mounted until its 30-minute ttl elapses', () => {
    const browserTabs: PanelTabCacheTab[] = [
      { id: 'active', type: 'note' },
      { id: 'browser', type: 'browser' },
    ];
    const cache = new Map([
      ['active', 0],
      ['browser', 0],
    ]);

    const fresh = updatePanelTabCache(cache, browserTabs, 'active', BROWSER_TAB_CACHE_TTL_MS - 1);
    const stale = updatePanelTabCache(cache, browserTabs, 'active', BROWSER_TAB_CACHE_TTL_MS);

    expect(fresh.has('browser')).toBe(true);
    expect(stale.has('browser')).toBe(false);
  });

  it('caps inactive tabs by evicting the oldest entries first', () => {
    const cache = new Map([
      ['active', 400],
      ['oldest', 100],
      ['middle', 200],
      ['newest', 300],
    ]);

    const next = updatePanelTabCache(
      cache,
      tabs('active', 'oldest', 'middle', 'newest'),
      'active',
      500,
      { ttlMs: 1_000, maxInactiveTabs: 2 },
    );

    expect(Array.from(next.keys()).sort()).toEqual(['active', 'middle', 'newest']);
  });

  it('evicts non-browser tabs before a fresh cached browser tab', () => {
    const cache = new Map([
      ['active', 400],
      ['browser', 100],
      ['note', 200],
      ['diff', 300],
    ]);
    const cacheTabs: PanelTabCacheTab[] = [
      { id: 'active', type: 'agent' },
      { id: 'browser', type: 'browser' },
      { id: 'note', type: 'note' },
      { id: 'diff', type: 'diff' },
    ];

    const next = updatePanelTabCache(cache, cacheTabs, 'active', 500, {
      ttlMs: 1_000,
      maxInactiveTabs: 2,
    });

    expect(Array.from(next.keys()).sort()).toEqual(['active', 'browser', 'diff']);
  });

  it('returns the delay until the next inactive tab expires', () => {
    const cache = new Map([
      ['active', 1_000],
      ['soon', 100],
      ['later', 400],
    ]);

    expect(getNextPanelTabCacheExpiryDelay(cache, 'active', 900, 1_000)).toBe(200);
    expect(getNextPanelTabCacheExpiryDelay(new Map([['active', 1_000]]), 'active', 900)).toBeNull();
  });

  it('schedules browser expiry using the browser-specific ttl', () => {
    const cache = new Map([
      ['active', 100],
      ['browser', 100],
    ]);
    const browserTabs: PanelTabCacheTab[] = [
      { id: 'active', type: 'note' },
      { id: 'browser', type: 'browser' },
    ];

    expect(getNextPanelTabCacheExpiryDelay(cache, 'active', 200, 30_000, browserTabs)).toBe(
      BROWSER_TAB_CACHE_TTL_MS - 100,
    );
  });

  it('compares cache contents by tab id and timestamp', () => {
    expect(arePanelTabCachesEqual(new Map([['a', 1]]), new Map([['a', 1]]))).toBe(true);
    expect(arePanelTabCachesEqual(new Map([['a', 1]]), new Map([['a', 2]]))).toBe(false);
  });

  // Agent-owned browser tabs stay mounted for the agent's lifetime
  // (monorepo#2857): seeded immediately, exempt from TTL and the cap.
  describe('agent-owned browser tabs', () => {
    const owned: PanelTabCacheTab = { id: 'owned', type: 'browser', ownerAgentId: 'agent-1' };

    it('mounts an owned browser tab immediately, without activation', () => {
      const next = updatePanelTabCache(new Map(), [{ id: 'active' }, owned], 'active', 100);
      expect(next.has('owned')).toBe(true);
    });

    it('exempts owned browser tabs from ttl eviction', () => {
      const cache = new Map([
        ['active', 0],
        ['owned', 0],
      ]);
      const next = updatePanelTabCache(
        cache,
        [{ id: 'active' }, owned],
        'active',
        BROWSER_TAB_CACHE_TTL_MS + 1,
        { ttlMs: 100 },
      );
      expect(next.has('owned')).toBe(true);
    });

    it('exempts owned browser tabs from the inactive cap and does not count them against it', () => {
      const cache = new Map([
        ['active', 100],
        ['owned', 10],
        ['b', 20],
        ['c', 30],
      ]);
      const next = updatePanelTabCache(
        cache,
        [{ id: 'active' }, owned, { id: 'b' }, { id: 'c' }],
        'active',
        200,
        { ttlMs: 10_000, maxInactiveTabs: 2 },
      );
      expect(next.has('owned')).toBe(true);
      expect(next.has('b')).toBe(true);
      expect(next.has('c')).toBe(true);
    });

    it('unowned tabs still evict normally alongside an owned tab', () => {
      const cache = new Map([
        ['active', 100],
        ['owned', 10],
        ['old', 20],
        ['newer', 30],
        ['newest', 40],
      ]);
      const next = updatePanelTabCache(
        cache,
        [{ id: 'active' }, owned, { id: 'old' }, { id: 'newer' }, { id: 'newest' }],
        'active',
        200,
        { ttlMs: 10_000, maxInactiveTabs: 2 },
      );
      expect(next.has('owned')).toBe(true);
      expect(next.has('old')).toBe(false);
      expect(next.has('newer')).toBe(true);
      expect(next.has('newest')).toBe(true);
    });

    it('excludes owned browser tabs from expiry scheduling', () => {
      const cache = new Map([
        ['active', 100],
        ['owned', 100],
      ]);
      expect(
        getNextPanelTabCacheExpiryDelay(cache, 'active', 200, 30_000, [
          { id: 'active', type: 'note' },
          owned,
        ]),
      ).toBeNull();
    });
  });
});
