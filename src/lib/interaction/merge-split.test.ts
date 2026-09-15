import { describe, expect, it } from 'vitest';
import { createMergeSplit } from './merge-split.svelte';
import type { ItemRect } from './proximity-hover.svelte';

const rects: ItemRect[] = [
  { top: 0, left: 4, width: 100, height: 20 },
  { top: 20, left: 4, width: 100, height: 20 },
  { top: 40, left: 4, width: 100, height: 20 },
];

describe('createMergeSplit', () => {
  it('merges contiguous selected rows into one measured group', () => {
    const mergeSplit = createMergeSplit();
    mergeSplit.update(rects, new Set([1, 2]));

    expect(mergeSplit.groups).toEqual([
      {
        id: 1,
        startIndex: 1,
        endIndex: 2,
        rect: { top: 20, left: 4, width: 100, height: 40 },
      },
    ]);
  });

  it('preserves a survivor id while groups merge and split', () => {
    const mergeSplit = createMergeSplit();
    mergeSplit.update(rects, new Set([0, 2]));
    const [upperId, lowerId] = mergeSplit.groups.map((group) => group.id);

    mergeSplit.update(rects, new Set([0, 1, 2]));
    expect(mergeSplit.groups).toHaveLength(1);
    expect(mergeSplit.groups[0].id).toBe(upperId);
    expect(mergeSplit.groups[0].rect.height).toBe(60);

    mergeSplit.update(rects, new Set([0, 2]));
    expect(mergeSplit.groups.map((group) => group.id)).toEqual([upperId, expect.any(Number)]);
    expect(mergeSplit.groups[1].id).not.toBe(lowerId);
  });
});
