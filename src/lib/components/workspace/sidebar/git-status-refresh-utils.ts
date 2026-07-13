/**
 * Git Status Refresh Utilities
 *
 * Pure functions extracted from WorkspaceProgressCard.svelte's loadGitStatus()
 * to enable unit testing of the null-guarding logic that prevents workflowStage
 * flickering during same-workspace refreshes.
 */

import type { WorkspaceGitStatus } from '$features/accept-changes/types';

/**
 * State managed by the git status refresh logic.
 */
export interface GitStatusRefreshState {
  gitStatus: WorkspaceGitStatus | null;
  gitStatusLoading: boolean;
  lastLoadedWorkspaceId: string | undefined;
  /**
   * Monotonic counter incremented at the start of each loadGitStatus() call.
   * Used to discard results from older overlapping fetches for the same workspace.
   */
  fetchGeneration: number;
}

/**
 * Determines whether gitStatus should be cleared to null before a refresh.
 * Only clears when switching to a different workspace (to avoid stale data leaking).
 * Same-workspace refreshes preserve existing data to prevent UI flicker.
 */
export function shouldClearGitStatusBeforeLoad(
  currentWorkspaceId: string,
  lastLoadedWorkspaceId: string | undefined,
): boolean {
  return currentWorkspaceId !== lastLoadedWorkspaceId;
}

/**
 * Determines whether to apply the result of a git status fetch.
 * Returns false if the workspace changed during the async call (stale result).
 */
export function shouldApplyGitStatusResult(
  currentWorkspaceId: string,
  capturedWorkspaceId: string,
): boolean {
  return currentWorkspaceId === capturedWorkspaceId;
}

/**
 * Determines whether to clear gitStatus on error.
 * Only clears if this was a workspace switch (not a same-workspace refresh),
 * so that existing data is preserved during transient errors on refresh.
 */
export function shouldClearGitStatusOnError(
  currentWorkspaceId: string,
  capturedWorkspaceId: string,
  lastLoadedWorkspaceId: string | undefined,
): boolean {
  return currentWorkspaceId === capturedWorkspaceId && currentWorkspaceId !== lastLoadedWorkspaceId;
}

/**
 * Checks whether the result of a fetch should be applied based on the fetch generation.
 * Returns false if a newer fetch has been started since this one began (stale result).
 */
export function isFetchCurrent(
  capturedGeneration: number,
  currentGeneration: number,
): boolean {
  return capturedGeneration === currentGeneration;
}

/**
 * Simulates the full loadGitStatus() flow as a pure function.
 * This mirrors the exact logic in WorkspaceProgressCard.svelte's loadGitStatus().
 *
 * @param state - Current state before the load
 * @param workspaceId - The workspace ID to load for
 * @param fetchResult - The result of the async fetch (resolved value or error)
 * @param workspaceIdDuringAwait - The workspaceId at the time the async call resolves
 *   (may differ from workspaceId if user switched workspaces during the fetch)
 * @returns The new state after the load completes
 */
export function simulateLoadGitStatus(
  state: GitStatusRefreshState,
  workspaceId: string,
  fetchResult: { ok: true; data: WorkspaceGitStatus } | { ok: false; error: Error },
  workspaceIdDuringAwait?: string,
): GitStatusRefreshState {
  const capturedWorkspaceId = workspaceId;
  const currentWorkspaceId = workspaceIdDuringAwait ?? workspaceId;

  // Start: increment generation, set loading, conditionally clear
  const capturedGeneration = state.fetchGeneration + 1;
  const newState: GitStatusRefreshState = {
    gitStatus: shouldClearGitStatusBeforeLoad(workspaceId, state.lastLoadedWorkspaceId)
      ? null
      : state.gitStatus,
    gitStatusLoading: true,
    lastLoadedWorkspaceId: state.lastLoadedWorkspaceId,
    fetchGeneration: capturedGeneration,
  };

  // Check both workspace guard AND generation guard
  const isWorkspaceCurrent = shouldApplyGitStatusResult(currentWorkspaceId, capturedWorkspaceId);
  const isGenerationCurrent = isFetchCurrent(capturedGeneration, newState.fetchGeneration);
  const shouldApply = isWorkspaceCurrent && isGenerationCurrent;

  // After async: apply result or handle error
  if (fetchResult.ok) {
    if (shouldApply) {
      newState.gitStatus = fetchResult.data;
      newState.lastLoadedWorkspaceId = capturedWorkspaceId;
    }
    // else: stale result, discard
  } else {
    // Error case
    if (shouldApply && shouldClearGitStatusOnError(currentWorkspaceId, capturedWorkspaceId, newState.lastLoadedWorkspaceId)) {
      newState.gitStatus = null;
    }
    // else: same-workspace refresh error or stale fetch, keep existing data
  }

  // Finally: clear loading if this is still the current fetch
  if (shouldApply) {
    newState.gitStatusLoading = false;
  }

  return newState;
}

/**
 * Simulates overlapping fetches for the same workspace.
 * Runs two fetches where the first resolves after the second.
 *
 * @param state - Initial state
 * @param workspaceId - The workspace ID both fetches target
 * @param firstFetchResult - Result of the first (older) fetch
 * @param secondFetchResult - Result of the second (newer) fetch
 * @returns The final state after both fetches complete (second resolves first, then first)
 */
export function simulateOverlappingFetches(
  state: GitStatusRefreshState,
  workspaceId: string,
  firstFetchResult: { ok: true; data: WorkspaceGitStatus } | { ok: false; error: Error },
  secondFetchResult: { ok: true; data: WorkspaceGitStatus } | { ok: false; error: Error },
): GitStatusRefreshState {
  // Both fetches start for the same workspace. The second fetch increments generation again.
  const gen1 = state.fetchGeneration + 1;
  const gen2 = gen1 + 1;

  // After both start, state has generation = gen2 (the latest)
  const stateAfterBothStart: GitStatusRefreshState = {
    gitStatus: shouldClearGitStatusBeforeLoad(workspaceId, state.lastLoadedWorkspaceId)
      ? null
      : state.gitStatus,
    gitStatusLoading: true,
    lastLoadedWorkspaceId: state.lastLoadedWorkspaceId,
    fetchGeneration: gen2,
  };

  // Second fetch resolves first (it's the newer one, gen2 matches current)
  const isWorkspaceCurrent2 = shouldApplyGitStatusResult(workspaceId, workspaceId);
  const isGenerationCurrent2 = isFetchCurrent(gen2, stateAfterBothStart.fetchGeneration);
  const shouldApply2 = isWorkspaceCurrent2 && isGenerationCurrent2;

  if (secondFetchResult.ok && shouldApply2) {
    stateAfterBothStart.gitStatus = secondFetchResult.data;
    stateAfterBothStart.lastLoadedWorkspaceId = workspaceId;
  }
  if (shouldApply2) {
    stateAfterBothStart.gitStatusLoading = false;
  }

  // First fetch resolves later (it's the older one, gen1 !== gen2)
  const isGenerationCurrent1 = isFetchCurrent(gen1, stateAfterBothStart.fetchGeneration);
  const shouldApply1 = shouldApplyGitStatusResult(workspaceId, workspaceId) && isGenerationCurrent1;

  if (firstFetchResult.ok && shouldApply1) {
    stateAfterBothStart.gitStatus = firstFetchResult.data;
    stateAfterBothStart.lastLoadedWorkspaceId = workspaceId;
  }
  if (shouldApply1) {
    stateAfterBothStart.gitStatusLoading = false;
  }

  return stateAfterBothStart;
}

