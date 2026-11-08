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

  it('enters at the top turning right and at the bottom turning left', () => {
    expect(stepHomeSelection(ids, null, 'cw')).toBe('a');
    expect(stepHomeSelection(ids, null, 'ccw')).toBe('c');
    expect(stepHomeSelection(ids, 'gone', 'cw')).toBe('a');
  });

  it('moves one row and stops at the ends', () => {
    expect(stepHomeSelection(ids, 'a', 'cw')).toBe('b');
    expect(stepHomeSelection(ids, 'b', 'ccw')).toBe('a');
    expect(stepHomeSelection(ids, 'c', 'cw')).toBeNull();
    expect(stepHomeSelection(ids, 'a', 'ccw')).toBeNull();
    expect(stepHomeSelection([], null, 'cw')).toBeNull();
  });
});
