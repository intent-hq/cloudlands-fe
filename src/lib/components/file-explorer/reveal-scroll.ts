const SUBPIXEL_TOLERANCE = 1;

export interface RevealScrollInput {
  /** Row index in the flattened tree. */
  index: number;
  /** Fixed row height in CSS px. */
  itemHeight: number;
  /** Current scrollTop of the tree's scroll container. */
  viewTop: number;
  /** Visible height of the tree's scroll container. */
  viewHeight: number;
}

/**
 * Scroll target that brings a tree row into view with the least movement.
 *
 * A fully visible row keeps the current position (null), so selecting a row
 * the user can already see never moves the list. A row clipped at an edge
 * scrolls just far enough to show it. A row entirely out of view is centered,
 * so long-distance reveals land with surrounding context.
 */
export function computeRevealScrollTop({
  index,
  itemHeight,
  viewTop,
  viewHeight,
}: RevealScrollInput): number | null {
  const rowTop = index * itemHeight;
  const rowBottom = rowTop + itemHeight;
  const viewBottom = viewTop + viewHeight;

  // Fractional zoom can leave scrollTop off by a sub-pixel from the row grid.
  if (rowTop >= viewTop - SUBPIXEL_TOLERANCE && rowBottom <= viewBottom + SUBPIXEL_TOLERANCE) {
    return null;
  }
  if (rowBottom > viewTop && rowTop < viewTop) return rowTop;
  if (rowTop < viewBottom && rowBottom > viewBottom) return Math.max(0, rowBottom - viewHeight);
  return Math.max(0, rowTop - viewHeight / 2 + itemHeight / 2);
}
