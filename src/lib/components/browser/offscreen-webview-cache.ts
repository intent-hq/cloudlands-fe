/**
 * Offscreen webview keep-alive cache (monorepo#2789 slice 2).
 *
 * Pure bookkeeping for the OffscreenWebviewHost: decides which browser
 * tabs of background (hosted but not displayed) workspaces keep a live
 * offscreen <webview>, so content-level browser ops (evaluate / screenshot /
 * capture) work without the workspace being displayed. Follows the
 * panel-tab-cache.ts precedent: a Map of tabId -> timestamp of when the tab
 * entered the offscreen set, recomputed from candidates on every layout
 * change and capped by evicting the oldest entries.
 *
 * Eviction order is by backgrounding time (FIFO), not use: recency is never
 * refreshed by agent activity, so under cap pressure the longest-backgrounded
 * tab is evicted even if an agent is actively operating on it. Feeding
 * main-process tab-lease touches back into recency is a possible follow-up
 * if the default cap proves too tight.
 */

export const MAX_OFFSCREEN_WEBVIEWS = 8;

export type OffscreenWebviewCandidate = {
  tabId: string;
  workspaceId: string;
  url: string;
  /**
   * Agent-owned tabs keep their webview mounted for the agent's lifetime
   * (monorepo#2857): pinned in the keep-alive set — never evicted by the cap
   * and not counted against it (the cap keeps bounding unowned tabs).
   */
  pinned?: boolean;
};

export function areOffscreenWebviewCachesEqual(
  a: Map<string, number>,
  b: Map<string, number>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [tabId, timestamp] of a) {
    if (b.get(tabId) !== timestamp) return false;
  }
  return true;
}

/**
 * Compute the next keep-alive set from the current cache and the candidate
 * tabs (browser tabs of non-displayed workspaces).
 *
 * - Entries whose tab is no longer a candidate are dropped (tab closed,
 *   workspace displayed again, or workspace layout removed on archive/delete).
 * - Surviving entries keep their original timestamp (recency is when the tab
 *   entered the offscreen set — newly backgrounded tabs are freshest).
 * - New candidates are stamped with `now`.
 * - Pinned (agent-owned) candidates are always kept and never count against
 *   `maxWebviews` (monorepo#2857); the cap bounds unpinned candidates only.
 * - When over `maxWebviews`, the oldest unpinned entries are evicted; ties
 *   break by candidate order (earlier candidates win) so the result is
 *   deterministic.
 */
export function updateOffscreenWebviewCache(
  currentCache: Map<string, number>,
  candidates: readonly OffscreenWebviewCandidate[],
  now: number,
  maxWebviews: number = MAX_OFFSCREEN_WEBVIEWS,
): Map<string, number> {
  const entries: Array<{ tabId: string; timestamp: number; order: number; pinned: boolean }> = [];
  const seen = new Set<string>();

  candidates.forEach((candidate, order) => {
    if (seen.has(candidate.tabId)) return;
    seen.add(candidate.tabId);
    entries.push({
      tabId: candidate.tabId,
      timestamp: currentCache.get(candidate.tabId) ?? now,
      order,
      pinned: candidate.pinned === true,
    });
  });

  const pinnedEntries = entries.filter((entry) => entry.pinned);
  let unpinnedEntries = entries.filter((entry) => !entry.pinned);
  if (unpinnedEntries.length > maxWebviews) {
    // Evict oldest first; on equal timestamps the later candidate loses.
    unpinnedEntries.sort((a, b) => b.timestamp - a.timestamp || a.order - b.order);
    unpinnedEntries = unpinnedEntries.slice(0, Math.max(0, maxWebviews));
  }

  // Preserve candidate order for a stable, deterministic result.
  const kept = [...pinnedEntries, ...unpinnedEntries].sort((a, b) => a.order - b.order);

  const nextCache = new Map<string, number>();
  for (const entry of kept) {
    nextCache.set(entry.tabId, entry.timestamp);
  }
  return nextCache;
}
