/**
 * Process-lifetime, per-`(workspaceId, agentId)` cache of the last known
 * chat composer draft (PROTOCOL §5.16 `drafts.*`), seeded by the manager in
 * `chat-panel-draft.svelte.ts` from settled restores and successful saves.
 *
 * Lets switching back to a previously visited pair hydrate the composer
 * synchronously instead of gating on a fresh `drafts.get` round trip.
 *
 * Transient UI state, not domain state — a plain module-scope `Map`, no
 * Redux store, no persistence across app restarts. Keep this module
 * dependency-light: no stores, services, or side effects.
 */
import type { DraftAttachment } from '$lib/client/app-client';

export interface CachedDraft {
  text: string;
  attachments: DraftAttachment[];
}

const cache = new Map<string, CachedDraft>();

function cacheKey(workspaceId: string, agentId: string): string {
  return `${workspaceId}\u0000${agentId}`;
}

/**
 * Returns the cached draft for `(workspaceId, agentId)`, or `undefined` on a
 * cache miss (pair never visited this process, or never settled a restore).
 */
export function getCachedDraft(workspaceId: string, agentId: string): CachedDraft | undefined {
  return cache.get(cacheKey(workspaceId, agentId));
}

/** Seed or update the cache entry for `(workspaceId, agentId)`. */
export function setCachedDraft(workspaceId: string, agentId: string, draft: CachedDraft): void {
  cache.set(cacheKey(workspaceId, agentId), draft);
}

/** Test-only: reset the process-lifetime cache between test cases. */
export function clearDraftCacheForTests(): void {
  cache.clear();
}
