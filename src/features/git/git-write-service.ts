/**
 * Compatibility facade for existing service callers awaiting MutationResult.
 * The root-owned Git write saga owns ordering, rollback and reconciliation.
 * Keep until the remaining non-component callers migrate to explicit actions;
 * new UI callers dispatch intent and render git-write selectors instead.
 */
import type { GitCommitParams, MutationResult } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import { gitWriteRequested } from '$store/renderer/slices/git/git-write-slice';

/**
 * Stage explicit paths with an optimistic staged-state flip; rolls back to the
 * pre-stage snapshot on failure, then reconciles from the daemon after either
 * outcome.
 */
export async function stageFiles(workspaceId: string, paths: string[]): Promise<MutationResult> {
  return appStore.dispatch(
    gitWriteRequested(workspaceId, crypto.randomUUID(), { kind: 'stage', paths }),
  );
}

/**
 * Unstage explicit paths with an optimistic staged-state flip; rolls back to
 * the pre-unstage snapshot on failure and reconciles from the daemon on
 * success.
 */
export async function unstageFiles(workspaceId: string, paths: string[]): Promise<MutationResult> {
  return appStore.dispatch(
    gitWriteRequested(workspaceId, crypto.randomUUID(), { kind: 'unstage', paths }),
  );
}

/**
 * Discard working-tree changes for explicit paths (`git.discard`; DESTRUCTIVE).
 * No optimistic mutation — the post-discard status is reconciled from the
 * daemon regardless of outcome so the store reflects what actually happened.
 */
export async function discardFiles(workspaceId: string, paths: string[]): Promise<MutationResult> {
  return appStore.dispatch(
    gitWriteRequested(workspaceId, crypto.randomUUID(), { kind: 'discard', paths }),
  );
}

/**
 * Create a commit through the seam (DESTRUCTIVE; requires `userRequested`).
 * No optimistic mutation — the post-commit status is reconciled from the daemon
 * regardless of outcome so the store reflects what actually happened.
 */
export async function commit(
  workspaceId: string,
  params: GitCommitParams,
): Promise<MutationResult> {
  return appStore.dispatch(
    gitWriteRequested(workspaceId, crypto.randomUUID(), { kind: 'commit', params }),
  );
}
