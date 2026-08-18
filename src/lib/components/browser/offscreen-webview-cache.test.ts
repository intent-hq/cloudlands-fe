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

  it('re-admits a previously evicted tab once capacity frees up', () => {
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
      ['c', 2_000],
    ]);
  });

  it('ignores duplicate candidate tab ids', () => {
    const next = updateOffscreenWebviewCache(
      new Map(),
      [candidate('a'), candidate('a', 'ws-2')],
      1_000,
    );
    expect(next.size).toBe(1);
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
