import { describe, expect, it } from 'vitest';
import {
  areOffscreenWebviewCachesEqual,
  updateOffscreenWebviewCache,
} from './offscreen-webview-cache';

const candidate = (tabId: string, workspaceId = 'ws-1', url = 'https://example.test') => ({
  tabId,
  workspaceId,
  url,
});

describe('updateOffscreenWebviewCache', () => {
  it('mounts new background browser tabs with the current timestamp', () => {
    const next = updateOffscreenWebviewCache(new Map(), [candidate('a'), candidate('b')], 1_000);
    expect([...next.entries()]).toEqual([
      ['a', 1_000],
      ['b', 1_000],
    ]);
  });

  it('keeps surviving entries alive with their original timestamp', () => {
    const first = updateOffscreenWebviewCache(new Map(), [candidate('a')], 1_000);
    const next = updateOffscreenWebviewCache(first, [candidate('a'), candidate('b')], 2_000);
    expect(next.get('a')).toBe(1_000);
    expect(next.get('b')).toBe(2_000);
  });

  it('drops entries whose tab left the candidate set (displayed again, closed, or workspace removed)', () => {
    const first = updateOffscreenWebviewCache(
      new Map(),
      [candidate('a', 'ws-1'), candidate('b', 'ws-2')],
      1_000,
    );
    const next = updateOffscreenWebviewCache(first, [candidate('b', 'ws-2')], 2_000);
    expect(next.has('a')).toBe(false);
    expect(next.get('b')).toBe(1_000);
  });

  it('returns an empty cache when a workspace teardown removes every candidate', () => {
    const first = updateOffscreenWebviewCache(new Map(), [candidate('a'), candidate('b')], 1_000);
    const next = updateOffscreenWebviewCache(first, [], 2_000);
    expect(next.size).toBe(0);
  });

  it('evicts the least recently backgrounded entries beyond the cap', () => {
    let cache = new Map<string, number>();
    cache = updateOffscreenWebviewCache(cache, [candidate('old')], 1_000, 2);
    cache = updateOffscreenWebviewCache(cache, [candidate('old'), candidate('mid')], 2_000, 2);
    cache = updateOffscreenWebviewCache(
      cache,
      [candidate('old'), candidate('mid'), candidate('new')],
      3_000,
      2,
    );
    expect(cache.has('old')).toBe(false);
    expect([...cache.keys()]).toEqual(['mid', 'new']);
  });

  it('breaks timestamp ties deterministically by candidate order', () => {
    const next = updateOffscreenWebviewCache(
      new Map(),
      [candidate('a'), candidate('b'), candidate('c')],
      1_000,
      2,
    );
    expect([...next.keys()]).toEqual(['a', 'b']);
  });

  it('re-admits a previously evicted tab with its original backgrounding time once capacity frees up', () => {
    let cache = updateOffscreenWebviewCache(
      new Map(),
      [candidate('a'), candidate('b'), candidate('c')],
      1_000,
      2,
    );
    expect(cache.has('c')).toBe(false);
    cache = updateOffscreenWebviewCache(cache, [candidate('a'), candidate('c')], 2_000, 2);
    expect([...cache.entries()]).toEqual([
      ['a', 1_000],
      ['c', 1_000],
    ]);
  });

  // intent#4650: evicted-but-eligible candidates used to be re-stamped `now`
  // on every reconcile, so they displaced live guests on unchanged input.
  describe('repeated reconciliation above the cap', () => {
    const tenCandidates = Array.from({ length: 10 }, (_, i) => candidate(String(i)));
    const firstEight = ['0', '1', '2', '3', '4', '5', '6', '7'];

    it('keeps the same mounted set when the candidates do not change', () => {
      let cache = new Map<string, number>();
      const mounted: string[][] = [];
      for (const now of [1_000, 2_000, 3_000, 4_000]) {
        cache = updateOffscreenWebviewCache(cache, tenCandidates, now, 8);
        mounted.push([...cache.keys()]);
      }
      expect(mounted).toEqual([firstEight, firstEight, firstEight, firstEight]);
    });

    it('keeps the mounted set stable when the caller keeps the previous cache on equal results', () => {
      const cache = updateOffscreenWebviewCache(new Map(), tenCandidates, 1_000, 8);
      updateOffscreenWebviewCache(cache, tenCandidates, 2_000, 8);
      const next = updateOffscreenWebviewCache(cache, tenCandidates, 3_000, 8);
      expect([...next.keys()]).toEqual(firstEight);
    });

    it('lets a newly backgrounded tab displace the oldest guest while carried-over evictees do not', () => {
      const seven = tenCandidates.slice(0, 7);
      let cache = updateOffscreenWebviewCache(new Map(), [candidate('old')], 1_000, 8);
      cache = updateOffscreenWebviewCache(cache, [candidate('old'), ...seven], 2_000, 8);
      expect([...cache.keys()]).toEqual(['old', '0', '1', '2', '3', '4', '5', '6']);
      cache = updateOffscreenWebviewCache(
        cache,
        [candidate('old'), ...seven, candidate('fresh')],
        3_000,
        8,
      );
      expect([...cache.keys()]).toEqual(['0', '1', '2', '3', '4', '5', '6', 'fresh']);
      cache = updateOffscreenWebviewCache(
        cache,
        [candidate('old'), ...seven, candidate('fresh')],
        4_000,
        8,
      );
      expect([...cache.keys()]).toEqual(['0', '1', '2', '3', '4', '5', '6', 'fresh']);
    });

    it('treats a candidate that left and re-entered the set as newly backgrounded', () => {
      let cache = new Map<string, number>();
      cache = updateOffscreenWebviewCache(cache, tenCandidates, 1_000, 8);
      cache = updateOffscreenWebviewCache(cache, tenCandidates.slice(0, 9), 2_000, 8);
      expect([...cache.keys()]).toEqual(firstEight);
      cache = updateOffscreenWebviewCache(cache, tenCandidates, 3_000, 8);
      expect([...cache.keys()]).toEqual(['0', '1', '2', '3', '4', '5', '6', '9']);
      expect(cache.get('9')).toBe(3_000);
    });

    it('re-admits carried-over evictees when the cap grows and evicts the oldest when it shrinks', () => {
      let cache = new Map<string, number>();
      cache = updateOffscreenWebviewCache(cache, tenCandidates, 1_000, 8);
      cache = updateOffscreenWebviewCache(cache, tenCandidates, 2_000, 10);
      expect([...cache.keys()]).toEqual(tenCandidates.map((c) => c.tabId));
      expect(new Set(cache.values())).toEqual(new Set([1_000]));
      cache = updateOffscreenWebviewCache(cache, tenCandidates, 3_000, 6);
      expect([...cache.keys()]).toEqual(['0', '1', '2', '3', '4', '5']);
      cache = updateOffscreenWebviewCache(cache, tenCandidates, 4_000, 6);
      expect([...cache.keys()]).toEqual(['0', '1', '2', '3', '4', '5']);
    });
  });

  it('ignores duplicate candidate tab ids', () => {
    const next = updateOffscreenWebviewCache(
      new Map(),
      [candidate('a'), candidate('a', 'ws-2')],
      1_000,
    );
    expect(next.size).toBe(1);
  });

  // Pinned (agent-owned) candidates stay mounted for the agent's lifetime
  // (monorepo#2857): never evicted by the cap and not counted against it.
  describe('pinned (agent-owned) candidates', () => {
    const pinned = (tabId: string) => ({ ...candidate(tabId), pinned: true });

    it('never evicts pinned candidates, even as the oldest entries', () => {
      let cache = new Map<string, number>();
      cache = updateOffscreenWebviewCache(cache, [pinned('owned')], 1_000, 2);
      cache = updateOffscreenWebviewCache(
        cache,
        [pinned('owned'), candidate('b'), candidate('c')],
        2_000,
        2,
      );
      cache = updateOffscreenWebviewCache(
        cache,
        [pinned('owned'), candidate('b'), candidate('c'), candidate('d')],
        3_000,
        2,
      );
      expect(cache.has('owned')).toBe(true);
    });

    it('does not count pinned candidates against the unpinned cap', () => {
      const next = updateOffscreenWebviewCache(
        new Map(),
        [pinned('o1'), pinned('o2'), candidate('a'), candidate('b')],
        1_000,
        2,
      );
      expect([...next.keys()].sort()).toEqual(['a', 'b', 'o1', 'o2']);
    });

    it('still evicts unpinned candidates beyond the cap alongside pinned ones', () => {
      let cache = new Map<string, number>();
      cache = updateOffscreenWebviewCache(cache, [candidate('old')], 1_000, 2);
      cache = updateOffscreenWebviewCache(
        cache,
        [candidate('old'), pinned('owned'), candidate('mid')],
        2_000,
        2,
      );
      cache = updateOffscreenWebviewCache(
        cache,
        [candidate('old'), pinned('owned'), candidate('mid'), candidate('new')],
        3_000,
        2,
      );
      expect(cache.has('old')).toBe(false);
      expect([...cache.keys()]).toEqual(['owned', 'mid', 'new']);
    });

    it('keeps pinned and unpinned guests stable across repeated over-cap reconciliations', () => {
      const candidates = [pinned('owned'), candidate('a'), candidate('b'), candidate('c')];
      let cache = new Map<string, number>();
      const mounted: string[][] = [];
      for (const now of [1_000, 2_000, 3_000]) {
        cache = updateOffscreenWebviewCache(cache, candidates, now, 2);
        mounted.push([...cache.keys()]);
      }
      expect(mounted).toEqual([
        ['owned', 'a', 'b'],
        ['owned', 'a', 'b'],
        ['owned', 'a', 'b'],
      ]);
    });
  });
});

describe('areOffscreenWebviewCachesEqual', () => {
  it('compares entries by tab id and timestamp', () => {
    const a = new Map([['t', 1]]);
    expect(areOffscreenWebviewCachesEqual(a, new Map([['t', 1]]))).toBe(true);
    expect(areOffscreenWebviewCachesEqual(a, new Map([['t', 2]]))).toBe(false);
    expect(areOffscreenWebviewCachesEqual(a, new Map())).toBe(false);
  });
});
