/**
 * Drag-to-reorder maths for the machine rail: where a dragged item lands and
 * how the others move aside to make room for it.
 */

/** The slot nearest to the dragged item's moved centre, never above `min`. */
export function railDropIndex(
  slotCenters: readonly number[],
  from: number,
  dy: number,
  min: number,
): number {
  const center = slotCenters[from] + dy;
  let best = from;
  for (let index = 0; index < slotCenters.length; index++) {
    if (Math.abs(slotCenters[index] - center) < Math.abs(slotCenters[best] - center)) best = index;
  }
  return Math.max(min, best);
}

/** How many slots item `index` moves while item `from` is dragged to slot `to`. */
export function railShift(index: number, from: number, to: number): -1 | 0 | 1 {
  if (index === from) return 0;
  if (from < to && index > from && index <= to) return -1;
  if (from > to && index >= to && index < from) return 1;
  return 0;
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
