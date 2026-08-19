/**
 * Estimate the conversation ordinal of a seek landing page's FIRST row.
 * Mirrors the daemon's `page_window_around`: half the page budget goes to
 * rows older than the (clamped) target, clamped at either edge so the page
 * stays full. An estimate only — boundaries stay exact via `oldestReached`
 * (nextToken null ⇒ start is 0) and the gap-close overlap detection.
 *
 * SINGLE copy of this daemon-mirroring math — shared by the scrollback saga
 * (segment seeding) and the scrollback composition (spacer split); keep it
 * dependency-light (no stores, no side effects).
 */
export function estimateSeekLandingStartOrdinal(
  targetOrdinal: number,
  pageLimit: number,
  totalMessages: number,
): number {
  if (totalMessages <= 0) return 0;
  const target = Math.min(totalMessages - 1, Math.max(0, Math.floor(targetOrdinal)));
  const start = target - Math.floor(pageLimit / 2);
  return Math.min(Math.max(0, totalMessages - pageLimit), Math.max(0, start));
}
