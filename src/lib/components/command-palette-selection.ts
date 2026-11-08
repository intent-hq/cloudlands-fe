/**
 * Pure helpers for the palette highlight. The highlight follows an item (its
 * row `_key`), not a row number: a keystroke puts it on row 1, and after an
 * arrow key or hover it stays on the same item while results land.
 */
import type { PaletteLateSource } from '$store/renderer/slices/command-palette/command-palette-results';

export function isSelectableResult(item: any): boolean {
  return (
    Boolean(item) &&
    !item._groupLabel &&
    !item._newActionsRow &&
    !item._borderAbove &&
    !item._showMore
  );
}

export function findSelectableIndex(items: any[], startIndex: number, direction: 1 | -1): number {
  for (let index = startIndex; index >= 0 && index < items.length; index += direction) {
    if (isSelectableResult(items[index])) return index;
  }
  return -1;
}

export function rowKey(item: any): string | null {
  return isSelectableResult(item) ? (item._key ?? null) : null;
}

/** The row index holding `key` nearest to `near` (an item can be listed twice). */
function indexOfKey(items: any[], key: string, near: number): number {
  let best = -1;
  items.forEach((item, index) => {
    if (rowKey(item) === key && (best === -1 || Math.abs(index - near) < Math.abs(best - near)))
      best = index;
  });
  return best;
}

/** Move the previous row 1 back to the top of `next` when it is still listed (mutates `next`). */
export function keepRowOne(previous: any[], next: any[]): void {
  const previousFirst = rowKey(previous[findSelectableIndex(previous, 0, 1)]);
  const nextFirst = findSelectableIndex(next, 0, 1);
  if (!previousFirst || nextFirst === -1 || rowKey(next[nextFirst]) === previousFirst) return;
  const from = indexOfKey(next, previousFirst, nextFirst);
  if (from <= nextFirst) return;
  const [row] = next.splice(from, 1);
  next.splice(nextFirst, 0, row);
}

/**
 * Highlighted row after a rebuild: the moved-to item when it is still listed,
 * else the nearest selectable row to the old one; row 1 when not moved.
 */
export function resolveSelection(
  rows: any[],
  previous: { index: number; key: string | null; moved: boolean },
): number {
  let index = -1;
  if (previous.moved && previous.key) index = indexOfKey(rows, previous.key, previous.index);
  if (index === -1 && previous.moved) {
    const clamped = Math.max(0, Math.min(previous.index, rows.length - 1));
    index = findSelectableIndex(rows, clamped, 1);
    if (index === -1) index = findSelectableIndex(rows, clamped, -1);
  }
  if (index === -1) index = findSelectableIndex(rows, 0, 1);
  return Math.max(index, 0);
}

/** Records which late sources answered the current text first. */
export function createLateArrivalTracker() {
  let current: { query: string; order: PaletteLateSource[] } = { query: '', order: [] };
  return (query: string, arrived: Record<PaletteLateSource, boolean>): PaletteLateSource[] => {
    if (current.query !== query) current = { query, order: [] };
    for (const source of ['file', 'note', 'message'] as const) {
      if (arrived[source] && !current.order.includes(source)) current.order.push(source);
    }
    return [...current.order];
  };
}
