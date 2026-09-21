import type { ItemRect } from './proximity-hover.svelte';

export type SelectedIndexes = ReadonlySet<number> | readonly number[];

export interface SelectionGroup {
  /** Stable for as long as the new group overlaps its previous geometry. */
  id: number;
  startIndex: number;
  endIndex: number;
  rect: ItemRect;
}

export interface MergeSplit {
  readonly groups: readonly SelectionGroup[];
  /** Reconciles contiguous selected runs against the previous update. */
  update(itemRects: readonly (ItemRect | undefined)[], selectedIndexes: SelectedIndexes): void;
  /** Clears all groups and their identity history. */
  reset(): void;
}

interface SelectionRun {
  startIndex: number;
  endIndex: number;
  rect: ItemRect;
}

function selectedRuns(
  itemRects: readonly (ItemRect | undefined)[],
  selectedIndexes: SelectedIndexes,
): SelectionRun[] {
  const selected = [...selectedIndexes]
    .filter((index) => Number.isInteger(index) && index >= 0 && itemRects[index] !== undefined)
    .sort((a, b) => a - b);
  const runs: Array<{ startIndex: number; endIndex: number }> = [];

  for (const index of selected) {
    const current = runs.at(-1);
    if (!current || index > current.endIndex + 1) {
      runs.push({ startIndex: index, endIndex: index });
    } else if (index > current.endIndex) {
      current.endIndex = index;
    }
  }

  return runs.map(({ startIndex, endIndex }) => {
    let top = Number.POSITIVE_INFINITY;
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (let index = startIndex; index <= endIndex; index += 1) {
      const rect = itemRects[index];
      if (!rect) continue;
      top = Math.min(top, rect.top);
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.left + rect.width);
      bottom = Math.max(bottom, rect.top + rect.height);
    }
    return {
      startIndex,
      endIndex,
      rect: { top, left, width: right - left, height: bottom - top },
    };
  });
}

function overlapSize(group: SelectionGroup, run: SelectionRun): number {
  return Math.max(
    0,
    Math.min(group.endIndex, run.endIndex) - Math.max(group.startIndex, run.startIndex) + 1,
  );
}

/** Creates a reconciler whose group ids survive selection growth, merges, and splits. */
export function createMergeSplit(): MergeSplit {
  let groups = $state<SelectionGroup[]>([]);
  let previous: SelectionGroup[] = [];
  let nextId = 1;

  return {
    get groups() {
      return groups;
    },
    update(itemRects, selectedIndexes) {
      const usedIds = new Set<number>();
      const next = selectedRuns(itemRects, selectedIndexes).map((run) => {
        const match = previous
          .filter((group) => !usedIds.has(group.id) && overlapSize(group, run) > 0)
          .sort((a, b) => overlapSize(b, run) - overlapSize(a, run) || a.id - b.id)[0];
        const id = match?.id ?? nextId++;
        usedIds.add(id);
        return { id, ...run };
      });
      previous = next;
      groups = next;
    },
    reset() {
      previous = [];
      groups = [];
      nextId = 1;
    },
  };
}
