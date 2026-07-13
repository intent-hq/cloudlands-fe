/**
 * Git write service — the sanctioned post-saga git-mutation mechanism.
 *
 * Components/services call these functions instead of dispatching the (now dead)
 * saga-trigger actions. Each operation: (1) applies an optional optimistic store
 * update for instant UI feedback, (2) awaits the matching `appClient.git.*`
 * mutation (which forwards to intentd and never throws — it returns a
 * `MutationResult`), and (3) reconciles: it refetches `git.status` so the store
 * converges to the daemon's source of truth (the same loop the live git
 * subscribe→refetch path drives on `git:*` events); on failure the optimistic
 * change is rolled back to the pre-mutation snapshot.
 *
 * Exposed operations: `stageFiles`, `unstageFiles` (optimistic + rollback),
 * `discardFiles` and `commit` (DESTRUCTIVE — no optimistic mutation; the
 * post-mutation status is reconciled from the daemon regardless of outcome).
 *
 * This module is dependency-light: it imports only the AppClient seam, the
 * configured store, git slice actions, and selectors (per src/store AGENTS.md).
 */
import { appClient } from "$lib/client";
import type { GitCommitParams, MutationResult } from "$lib/client";
import type { GitStatus } from "$shared/types";
import { store as appStore } from "$store/renderer/store";
import { setGitStatus } from "$store/renderer/slices/git/git-slice";
import { selectGitStatus } from "$store/renderer/slices/git/git-selectors";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("GitWriteService");

/** Refetch git status from the seam and converge the store to it. */
async function reconcileGitStatus(workspaceId: string): Promise<void> {
  try {
    const status = await appClient.git.status(workspaceId);
    if (status) appStore.dispatch(setGitStatus(workspaceId, status));
  } catch (error) {
    logger.error("Failed to refetch git status after a mutation", error);
  }
}

/**
 * Stage explicit paths with an optimistic staged-state flip; rolls back to the
 * pre-stage snapshot on failure and reconciles from the daemon on success.
 */
export async function stageFiles(
  workspaceId: string,
  paths: string[],
): Promise<MutationResult> {
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
    logger.error("Failed to stage files", result.error);
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
export async function unstageFiles(
  workspaceId: string,
  paths: string[],
): Promise<MutationResult> {
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
    logger.error("Failed to unstage files", result.error);
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
export async function discardFiles(
  workspaceId: string,
  paths: string[],
): Promise<MutationResult> {
  const result = await appClient.git.discard(workspaceId, paths);
  if (!result.success) {
    logger.error("Failed to discard files", result.error);
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
    logger.error("Failed to commit", result.error);
  }
  await reconcileGitStatus(workspaceId);
  return result;
}
