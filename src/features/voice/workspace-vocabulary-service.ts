/**
 * Cached read of a workspace's auto-derived vocabulary
 * (`voice.getWorkspaceVocabulary`, PROTOCOL §5.41 v5.1) for the local
 * OS-engine dictation path — the client-side counterpart of the daemon's
 * `workspaceId`-driven vocabulary injection on cloud `voice.transcribe`
 * calls, so both engines bias with the same terms.
 *
 * Single-flight per workspace with a TTL: concurrent dictations share one
 * in-flight promise, and a fresh result is reused for subsequent dictations
 * instead of refetching per keystroke of the mic (the daemon already
 * content-hash caches the derivation; this cache only avoids the RPC).
 * Resilient by design: a failed fetch resolves to no terms (dictation
 * proceeds without workspace bias) and drops the entry so the next
 * dictation retries.
 */
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('WorkspaceVocabularyService');

/** Reuse window for a fetched vocabulary before the next dictation refetches. */
export const WORKSPACE_VOCABULARY_TTL_MS = 5 * 60_000;

interface CacheEntry {
  promise: Promise<string[]>;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * The workspace's derived vocabulary terms (§5.41 `{ terms }`), cached and
 * coalesced per workspace. Never rejects: a transport/daemon failure
 * resolves to `[]` so the transcription flow proceeds without the terms.
 */
export function getWorkspaceVocabularyTerms(workspaceId: string): Promise<string[]> {
  const now = Date.now();
  const entry = cache.get(workspaceId);
  if (entry && now - entry.fetchedAt < WORKSPACE_VOCABULARY_TTL_MS) return entry.promise;
  const promise = appClient.voice
    .getWorkspaceVocabulary(workspaceId)
    .then((result) => result.terms)
    .catch((error: unknown) => {
      logger.warn('voice.getWorkspaceVocabulary failed; proceeding without workspace terms', {
        error,
        workspaceId,
      });
      // Drop only this fetch's entry (a newer refetch may already be cached).
      if (cache.get(workspaceId)?.promise === promise) cache.delete(workspaceId);
      return [];
    });
  cache.set(workspaceId, { promise, fetchedAt: now });
  return promise;
}

/** Test seam: forget every cached vocabulary. */
export function resetWorkspaceVocabularyCache(): void {
  cache.clear();
}
