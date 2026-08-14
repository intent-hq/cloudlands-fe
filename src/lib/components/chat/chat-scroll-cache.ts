/**
 * Process-lifetime, per-`(workspaceId, agentId)` cache of the chat transcript
 * scroll state, saved by `ChatPanel.svelte` on destroy and consulted on mount.
 *
 * Lets a panel unmounted by column windowing (WorkspaceColumnsView replacing
 * an off-screen WorkspaceSurface with a placeholder) come back at the same
 * reading position instead of yanking the user to the bottom.
 *
 * Transient UI state, not domain state — a plain module-scope `Map`, no
 * Redux store, no persistence across app restarts. Keep this module
 * dependency-light: no stores, services, or side effects.
 */

export interface CachedChatScroll {
  /** `scrollTop` of the transcript scroll container at destroy time. */
  scrollTop: number;
  /** Whether the viewport was following the bottom (auto-scroll on). */
  shouldFollowBottom: boolean;
  /** Whether the user had manually unlocked auto-scroll while at bottom. */
  isScrollUnlocked: boolean;
}

const cache = new Map<string, CachedChatScroll>();

function cacheKey(workspaceId: string, agentId: string): string {
  return `${workspaceId}\u0000${agentId}`;
}

/**
 * Returns the cached scroll state for `(workspaceId, agentId)`, or
 * `undefined` on a cache miss (pair never destroyed this process).
 */
export function getCachedChatScroll(
  workspaceId: string,
  agentId: string,
): CachedChatScroll | undefined {
  return cache.get(cacheKey(workspaceId, agentId));
}

/** Seed or update the cache entry for `(workspaceId, agentId)`. */
export function setCachedChatScroll(
  workspaceId: string,
  agentId: string,
  scroll: CachedChatScroll,
): void {
  cache.set(cacheKey(workspaceId, agentId), scroll);
}

/** Test-only: reset the process-lifetime cache between test cases. */
export function clearChatScrollCacheForTests(): void {
  cache.clear();
}
