import { describe, expect, it } from 'vitest';

import {
  MAX_RECENT_SPECIALISTS,
  mergeRecentSpecialists,
  readRecentSpecialists,
  rememberRecentSpecialist,
  sortSpecialistsByRecency,
} from './recent-specialists';

describe('rememberRecentSpecialist', () => {
  it('moves the used specialist to the front without duplicating it', () => {
    expect(rememberRecentSpecialist(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
    expect(rememberRecentSpecialist([], 'a')).toEqual(['a']);
  });

  it('ignores General (null) and blank ids', () => {
    expect(rememberRecentSpecialist(['a'], null)).toEqual(['a']);
    expect(rememberRecentSpecialist(['a'], undefined)).toEqual(['a']);
    expect(rememberRecentSpecialist(['a'], '')).toEqual(['a']);
  });

  it('drops the least recently used beyond the cap', () => {
    let ids: string[] = [];
    for (let i = 0; i <= MAX_RECENT_SPECIALISTS; i++) {
      ids = rememberRecentSpecialist(ids, `s-${i}`);
    }
    expect(ids).toHaveLength(MAX_RECENT_SPECIALISTS);
    expect(ids[0]).toBe(`s-${MAX_RECENT_SPECIALISTS}`);
    expect(ids).not.toContain('s-0');
  });
});

describe('mergeRecentSpecialists', () => {
  it('ranks in-session uses ahead of persisted ones', () => {
    expect(mergeRecentSpecialists(['a', 'b', 'c'], ['c', 'd'])).toEqual(['c', 'd', 'a', 'b']);
  });
});

describe('readRecentSpecialists', () => {
  it('drops malformed entries and non-array payloads', () => {
    expect(readRecentSpecialists(null)).toBeUndefined();
    expect(readRecentSpecialists({ a: 1 })).toBeUndefined();
    expect(readRecentSpecialists(['a', 1, '', null, 'b', 'a'])).toEqual(['a', 'b']);
  });
});

describe('sortSpecialistsByRecency', () => {
  const specialists = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

  it('puts recently used specialists first, newest first, then the rest in order', () => {
    expect(sortSpecialistsByRecency(specialists, ['c', 'a']).map((s) => s.id)).toEqual([
      'c',
      'a',
      'b',
      'd',
    ]);
  });

  it('keeps the original order with no history and ignores unknown ids', () => {
    expect(sortSpecialistsByRecency(specialists, []).map((s) => s.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(sortSpecialistsByRecency(specialists, ['gone', 'd']).map((s) => s.id)).toEqual([
      'd',
      'a',
      'b',
      'c',
    ]);
  });

  it('does not mutate its input', () => {
    const input = [...specialists];
    sortSpecialistsByRecency(input, ['d']);
    expect(input).toEqual(specialists);
  });
});
