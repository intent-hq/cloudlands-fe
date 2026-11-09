import { describe, expect, it } from 'vitest';
import { homeListOrder, stepHomeSelection } from './home-encoder-target';

const ws = (...ids: string[]) => ids.map((id) => ({ id }));

describe('homeListOrder', () => {
  it('lists the flat list when there are no groups, then an expanded shelf', () => {
    expect(
      homeListOrder({ groups: [], workspaces: ws('a', 'b'), aside: ws('c'), asideExpanded: true }),
    ).toEqual(['a', 'b', 'c']);
  });

  it('skips collapsed groups and a collapsed shelf', () => {
    expect(
      homeListOrder({
        groups: [
          { expanded: true, items: ws('b', 'a') },
          { expanded: false, items: ws('c') },
          { expanded: true, items: ws('d') },
        ],
        workspaces: ws('a', 'b', 'c', 'd'),
        aside: ws('e'),
        asideExpanded: false,
      }),
    ).toEqual(['b', 'a', 'd']);
  });
});

describe('stepHomeSelection', () => {
  const ids = ['a', 'b', 'c'];

  it('enters at the top in either direction', () => {
    expect(stepHomeSelection(ids, null, 'clockwise')).toBe('a');
    expect(stepHomeSelection(ids, null, 'counterclockwise')).toBe('a');
    expect(stepHomeSelection(ids, 'gone', 'clockwise')).toBe('a');
  });

  it('moves one row and stops at the ends', () => {
    expect(stepHomeSelection(ids, 'a', 'clockwise')).toBe('b');
    expect(stepHomeSelection(ids, 'b', 'counterclockwise')).toBe('a');
    expect(stepHomeSelection(ids, 'c', 'clockwise')).toBeNull();
    expect(stepHomeSelection(ids, 'a', 'counterclockwise')).toBeNull();
    expect(stepHomeSelection([], null, 'clockwise')).toBeNull();
  });
});
