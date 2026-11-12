import { describe, expect, it } from 'vitest';

import { moveItem, railDropIndex, railShift } from './rail-reorder';

// Slot centres 38 px apart: a 32 px button plus the rail's 6 px gap.
const centers = [16, 54, 92, 130];

describe('railDropIndex', () => {
  it('lands in the slot nearest to where the dragged item is', () => {
    expect(railDropIndex(centers, 1, 0, 1)).toBe(1);
    expect(railDropIndex(centers, 1, 20, 1)).toBe(2);
    expect(railDropIndex(centers, 1, 70, 1)).toBe(3);
  });

  it('stays within the group and never above the first movable slot', () => {
    expect(railDropIndex(centers, 2, -200, 1)).toBe(1);
    expect(railDropIndex(centers, 1, 500, 1)).toBe(3);
  });
});

describe('railShift', () => {
  it('moves the items between the old and new slot one slot toward the gap', () => {
    // Item 1 dragged down to slot 3: items 2 and 3 move up.
    expect([0, 2, 3].map((index) => railShift(index, 1, 3))).toEqual([0, -1, -1]);
    // Item 3 dragged up to slot 1: items 1 and 2 move down.
    expect([0, 1, 2].map((index) => railShift(index, 3, 1))).toEqual([0, 1, 1]);
  });

  it('leaves the dragged item to the pointer', () => {
    expect(railShift(1, 1, 3)).toBe(0);
  });
});

describe('moveItem', () => {
  it('moves one item to a new index', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 1, 3)).toEqual(['a', 'c', 'd', 'b']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });
});
