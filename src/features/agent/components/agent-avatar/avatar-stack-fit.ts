export interface AvatarStackFitOptions {
  itemCount: number;
  maxVisible: number;
  availableWidth: number;
  /** Avatar surface size in px (see `agentAvatarGeometry[variant].surface`). */
  surface: number;
  /** Stack overlap in px (see `agentAvatarGeometry[variant].overlap`). */
  overlap: number;
  /** Gap between the avatar track and the overflow label in px. */
  overflowGap: number;
  /** Measured width in px of the `+N` overflow label for `remaining` items. */
  measureOverflowText: (remaining: number) => number;
}

/**
 * Pure fit computation for an adaptive avatar stack: the largest visible count
 * (capped at `maxVisible`) whose avatars plus any `+N` overflow label fit in
 * `availableWidth`. Derived entirely from geometry constants so callers avoid
 * forced-layout reads.
 */
export function computeAdaptiveVisibleCount(options: AvatarStackFitOptions): number {
  const { itemCount, maxVisible, availableWidth, surface, overlap, overflowGap } = options;
  if (availableWidth <= 0) return 0;
  const step = surface - overlap;
  const cap = Math.min(itemCount, Math.max(0, maxVisible));
  const avatarsWidth = (count: number) => (count === 0 ? 0 : surface + (count - 1) * step);

  if (itemCount <= cap && avatarsWidth(itemCount) <= availableWidth) {
    return itemCount;
  }
  for (let count = cap; count >= 0; count -= 1) {
    const remaining = itemCount - count;
    const requiredWidth =
      avatarsWidth(count) +
      (remaining > 0 ? (count > 0 ? overflowGap : 0) + options.measureOverflowText(remaining) : 0);
    if (requiredWidth <= availableWidth) {
      return count;
    }
  }
  return 0;
}
