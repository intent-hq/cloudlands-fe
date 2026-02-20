/**
 * Two-factor color scale for line attribution indicators
 *
 * This module implements a color scaling system that considers both:
 * 1. Relative recency - where an edit falls in the note's edit history
 * 2. Absolute recency - how recent the edit is in absolute terms
 *
 * The goal is to make truly recent edits stand out (bright yellow) while
 * showing older edits with progressively more transparency based on their
 * position in the edit timeline.
 */

/**
 * Calculate color for a line attribution indicator
 *
 * Factor 1: Relative recency (rank within note's edit history)
 * - Oldest edit in note → 0 opacity (transparent)
 * - Newest edit in note → 0.6 opacity (medium yellow)
 *
 * Factor 2: Absolute recency (how recent in absolute terms)
 * - Edits within the recency window get a brightness boost (up to +0.4 opacity)
 * - Edits older than the window get no boost
 *
 * Special case: If all edits are within 5 minutes, everything is transparent
 * (the whole note is fresh, so no need to highlight)
 *
 * @param timestamp - The timestamp to calculate color for
 * @param oldestTime - The oldest timestamp in the note's attributions
 * @param newestTime - The newest timestamp in the note's attributions
 * @param absoluteRecencyWindowMinutes - Time window for absolute recency boost (default: 10 minutes)
 * @returns opacity value between 0 and 1
 *
 * @example
 * // 6-month-old note with edit 2 days ago
 * getAttributionColor(twoDaysAgo, sixMonthsAgo, twoDaysAgo)
 * // Returns: 0.2
 *
 * @example
 * // 6-month-old note with edit 2 minutes ago
 * getAttributionColor(twoMinutesAgo, sixMonthsAgo, twoMinutesAgo)
 * // Returns: 0.6
 */
export function getAttributionOpacity(
  timestamp: number,
  oldestTime: number,
  newestTime: number,
  absoluteRecencyWindowMinutes: number = 10,
): number {
  const now = Date.now();
  const range = newestTime - oldestTime;

  // If range is too small (<5 mins), everything is very transparent
  // This means the whole note is fresh, so no need to highlight
  if (range < 5 * 60 * 1000) {
    // AW: removing these to cut down on noise
    return 0;
    // return 'rgba(250, 204, 21, 0.1)';
  }

  // Factor 1: Relative position within the note's edit history (0 = oldest, 1 = newest)
  const relativePosition = (timestamp - oldestTime) / range;

  // Factor 2: Absolute recency - how recent is this in absolute terms?
  // Maps 0-N minutes to 1.0-0.0 (fully recent to not recent)
  const ageInMinutes = (now - timestamp) / (60 * 1000);
  const absoluteRecency = Math.max(0, 1 - ageInMinutes / absoluteRecencyWindowMinutes);

  // Combine factors:
  // - Base opacity from relative position: 0 → 0.3 (60% of range)
  // - Boost from absolute recency: up to +0.2 (40% boost for very recent edits)
  const baseOpacity = relativePosition * 0.3;
  const boost = absoluteRecency * 0.2;
  const finalOpacity = Math.min(1.0, baseOpacity + boost);

  return finalOpacity;
}
