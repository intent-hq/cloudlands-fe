/**
 * Git write service — the sanctioned post-saga git-mutation mechanism.
 *
 * Components/services call these functions instead of dispatching the (now dead)
 * saga-trigger actions. Each operation: (1) applies an optional optimistic store
 * update for instant UI feedback, (2) awaits the matching `appClient.git.*`
 * mutation (which forwards to intentd and never throws — it returns a
 * `MutationResult`), and (3) reconciles: it refetches `git.status` and, before
 * resolving, converges BOTH the git-status slice and the file-tracking changes
 * slice (via `reconcileGitStatusChanges`, the same rebuild the lifecycle read
 * saga applies — though enriched from the current store rows rather than a
 * fresh `trackedChanges` read) to the daemon's source of truth — so a caller
 * awaiting e.g. Stage All holds its in-progress UI until the rendered file
 * lists have actually moved sections.
 *
 * Exposed operations: `stageFiles`, `unstageFiles` (optimistic + rollback;
 * stage reconciles after either outcome, while unstage reconciles on success),
 * `discardFiles` and `commit`
 * (DESTRUCTIVE — no optimistic mutation; the post-mutation status is
 * reconciled from the daemon regardless of outcome, so both slices converge
 * even when the mutation failed).
 *
 * This module is dependency-light: it imports only the AppClient seam, the
 * configured store, slice actions, selectors (per src/store AGENTS.md), and the
 * pure `reconcileGitStatusChanges` helper.
 */
import { appClient } from '$lib/client';
import type { GitCommitParams, MutationResult } from '$lib/client';
import type { GitStatus } from '$shared/types';
import { store as appStore } from '$store/renderer/store';
import { setGitStatus } from '$store/renderer/slices/git/git-slice';
import { selectGitStatus } from '$store/renderer/slices/git/git-selectors';
import { setChangesData } from '$store/renderer/slices/changes/changes-slice';
import { selectFileTrackingChanges } from '$store/renderer/slices/changes/changes-selectors';
import { reconcileGitStatusChanges } from '$features/file-tracking/git-status-reconciliation';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('GitWriteService');

/**
 * Refetch git status from the seam and converge the store to it: the git-status
 * slice first, then the file-tracking changes slice (rows rebuilt from the
 * fresh status, enriched from the current tracked rows; `setChangesData` with
 * `truncated: false` and the row count, matching the lifecycle read saga's
 * dispatch, so the truncation fields stay consistent with the rows). Both
 * dispatches happen before this resolves, so seam callers only settle once the
 * rendered change lists reflect the post-mutation state.
 */
async function reconcileGitStatus(
  workspaceId: string,
  options?: { forceRefresh?: boolean },
): Promise<void> {
  try {
    const status = options
      ? await appClient.git.status(workspaceId, options)
      : await appClient.git.status(workspaceId);
    if (!status) return;
    appStore.dispatch(setGitStatus(workspaceId, status));
    const tracked = selectFileTrackingChanges.select(appStore.state, workspaceId);
    const changes = reconcileGitStatusChanges(status.files, tracked);
    appStore.dispatch(setChangesData(workspaceId, changes, false, changes.length));
  } catch (error) {
    logger.error('Failed to refetch git status after a mutation', error);
  }
}

/**
 * Stage explicit paths with an optimistic staged-state flip; rolls back to the
 * pre-stage snapshot on failure, then reconciles from the daemon after either
 * outcome.
 */
export async function stageFiles(workspaceId: string, paths: string[]): Promise<MutationResult> {
  const snapshot = selectGitStatus.select(appStore.state, workspaceId);
  if (snapshot) {
    const pathSet = new Set(paths);
    const optimistic: GitStatus = {
      ...snapshot,
      files: snapshot.files.map((file) =>
        pathSet.has(file.path) ? { ...file, staged: true } : file,
      ),
    };
    appStore.dispatch(setGitStatus(workspaceId, optimistic));
  }

  const result = await appClient.git.stage(workspaceId, paths);
  if (!result.success) {
    if (snapshot) appStore.dispatch(setGitStatus(workspaceId, snapshot));
    logger.error('Failed to stage files', result.error);
    await reconcileGitStatus(workspaceId, { forceRefresh: true });
    return result;
  }
  await reconcileGitStatus(workspaceId);
  return result;
}

/**
 * Unstage explicit paths with an optimistic staged-state flip; rolls back to
 * the pre-unstage snapshot on failure and reconciles from the daemon on
 * success.
 */
export async function unstageFiles(workspaceId: string, paths: string[]): Promise<MutationResult> {
  const snapshot = selectGitStatus.select(appStore.state, workspaceId);
  if (snapshot) {
    const pathSet = new Set(paths);
    const optimistic: GitStatus = {
      ...snapshot,
      files: snapshot.files.map((file) =>
        pathSet.has(file.path) ? { ...file, staged: false } : file,
      ),
    };
    appStore.dispatch(setGitStatus(workspaceId, optimistic));
  }

  const result = await appClient.git.unstage(workspaceId, paths);
  if (!result.success) {
    if (snapshot) appStore.dispatch(setGitStatus(workspaceId, snapshot));
    logger.error('Failed to unstage files', result.error);
    return result;
  }
  await reconcileGitStatus(workspaceId);
  return result;
}

/**
 * Discard working-tree changes for explicit paths (`git.discard`; DESTRUCTIVE).
 * No optimistic mutation — the post-discard status is reconciled from the
 * daemon regardless of outcome so the store reflects what actually happened.
 */
export async function discardFiles(workspaceId: string, paths: string[]): Promise<MutationResult> {
  const result = await appClient.git.discard(workspaceId, paths);
  if (!result.success) {
    logger.error('Failed to discard files', result.error);
  }
  await reconcileGitStatus(workspaceId);
  return result;
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
  const result = await appClient.git.commit(workspaceId, params);
  if (!result.success) {
    logger.error('Failed to commit', result.error);
  }
  await reconcileGitStatus(workspaceId);
  return result;
}
