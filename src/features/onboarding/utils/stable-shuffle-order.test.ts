import { describe, expect, it } from 'vitest';
import { shuffleArray, stableShuffleOrder } from './stable-shuffle-order';

const entries = (...list: string[]) => list.map((id) => ({ id }));
const ids = (list: { id: string }[]) => list.map((e) => e.id);

/** Deterministic "shuffle" (reverse) so tests can detect when it is invoked. */
const reverse = (input: readonly string[]) => [...input].reverse();

describe('stableShuffleOrder', () => {
  it('shuffles on the first call (no cache) and returns the cache', () => {
    const result = stableShuffleOrder(entries('a', 'b', 'c'), null, reverse);
    expect(ids(result.entries)).toEqual(['c', 'b', 'a']);
    expect(result.cache).toEqual({ key: 'a,b,c', order: ['c', 'b', 'a'] });
  });

  it('preserves the cached order across re-emissions with the same id set', () => {
    const first = stableShuffleOrder(entries('a', 'b', 'c'), null, reverse);
    let calls = 0;
    const countingShuffle = (input: readonly string[]) => {
      calls++;
      return reverse(input);
    };
    // Fresh array + fresh entry objects, same ids — as after a catalog re-hydration.
    const second = stableShuffleOrder(entries('a', 'b', 'c'), first.cache, countingShuffle);
    expect(calls).toBe(0);
    expect(ids(second.entries)).toEqual(ids(first.entries));
  });

  it('maps the current entry objects into the cached order (no stale rows)', () => {
    const first = stableShuffleOrder(entries('a', 'b'), null, reverse);
    const rehydrated = [
      { id: 'a', displayName: 'A v2' },
      { id: 'b', displayName: 'B v2' },
    ];
    const second = stableShuffleOrder(rehydrated, first.cache, reverse);
    expect(second.entries).toEqual([
      { id: 'b', displayName: 'B v2' },
      { id: 'a', displayName: 'A v2' },
    ]);
    expect(second.entries[0]).toBe(rehydrated[1]);
  });

  it('re-shuffles when an id is added', () => {
    const first = stableShuffleOrder(entries('a', 'b'), null, reverse);
    const second = stableShuffleOrder(entries('a', 'b', 'c'), first.cache, reverse);
    expect(ids(second.entries)).toEqual(['c', 'b', 'a']);
    expect(second.cache.key).toBe('a,b,c');
  });

  it('re-shuffles when an id is removed', () => {
    const first = stableShuffleOrder(entries('a', 'b', 'c'), null, reverse);
    const second = stableShuffleOrder(entries('a', 'b'), first.cache, reverse);
    expect(ids(second.entries)).toEqual(['b', 'a']);
    expect(second.cache.key).toBe('a,b');
  });

  it('reuses the cache when the same id set arrives in a different upstream order', () => {
    const first = stableShuffleOrder(entries('a', 'b', 'c'), null, reverse);
    const second = stableShuffleOrder(entries('c', 'a', 'b'), first.cache, reverse);
    expect(ids(second.entries)).toEqual(ids(first.entries));
  });

  it('handles an empty catalog', () => {
    const result = stableShuffleOrder([], null, reverse);
    expect(result.entries).toEqual([]);
    expect(result.cache).toEqual({ key: '', order: [] });
  });
});

describe('shuffleArray', () => {
  it('returns a permutation without mutating the input', () => {
    const input = ['a', 'b', 'c', 'd'];
    const copy = [...input];
    const result = shuffleArray(input);
    expect(input).toEqual(copy);
    expect([...result].sort()).toEqual(copy);
  });
});
