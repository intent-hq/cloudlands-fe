/**
 * File Tracking Operations Saga
 *
 * Handles all file-tracking operations (stage, unstage, revert, refresh, sync, load)
 * as saga handlers triggered by request actions.
 *
 * Module-level deduplication state (pending operations, throttling) is kept as
 * saga-local closure variables, NOT in Redux state.
 */

import { call, put, select, takeEvery, delay, fork, type SagaGenerator } from "typed-redux-saga";
import { invoke, invokeWithTimeout, IpcTimeoutError } from "$lib/electron-bridge";
import { Logger } from "$lib/utils/logger";
import {
  setChanges,
  setChangesData,
  setTransitions,
  setCommitsData,
  setLoading,
  setError,
  setLoadingOlderCommits,
  appendOlderCommits,
  clearAllChanges,
  stageChangesRequested,
  unstageChangesRequested,
  stageByPathRequested,
  unstageByPathRequested,
  revertChangeRequested,
  revertChangesRequested,
  revertByPathRequested,
  refreshRequested,
  syncWithGitRequested,
  loadWorkspaceDataRequested,
  trackChangeRequested,
  clearTrackedChangesRequested,
  loadOlderCommitsRequested,
} from "../file-tracking-slice";
import {
  selectFileTrackingChanges,
  selectCurrentWorkspaceId,
} from "../file-tracking-selectors";
import { ChangeStage } from "$features/file-tracking/types";
import type { TrackedChange, StageTransition, CommitInfo } from "../file-tracking-types";
import { FILE_TRACKING_CHANNELS } from "$shared/ipc/channels";
import {
  hasChangesDifference,
  hasTransitionsDifference,
  hasCommitsDifference,
} from "$features/file-tracking/change-difference-utils";

const logger = new Logger({ category: "FileTrackingOpsSaga" });

const IPC_SYNC_TIMEOUT_MS = 30000;
const IPC_LOAD_TIMEOUT_MS = 30000;

// ---------------------------------------------------------------------------
// Saga-local deduplication state (closures, NOT Redux state)
// ---------------------------------------------------------------------------

const pendingStageOperations = new Set<string>();
const pendingStageOperationsByPath = new Set<string>();
const recentOperationPaths = new Map<string, number>();
const OPERATION_COOLDOWN_MS = 1000;

let lastSyncTime = 0;
let syncInProgress = false;
let syncDirty = false;
let syncDirtyForce = false;
const SYNC_THROTTLE_MS = 10000;

let loadInProgress = false;
let loadDirty = false;
let refreshInProgress = false;

export function hasPendingOperations(): boolean {
  return pendingStageOperations.size > 0 || pendingStageOperationsByPath.size > 0;
}

export function resetTrackingState(): void {
  pendingStageOperations.clear();
  pendingStageOperationsByPath.clear();
  recentOperationPaths.clear();
  lastSyncTime = 0;
  syncInProgress = false;
  syncDirty = false;
  syncDirtyForce = false;
  loadInProgress = false;
  loadDirty = false;
  refreshInProgress = false;
}

function clearPendingState(changeIds: string[], pendingPaths: string[]): void {
  changeIds.forEach((id) => pendingStageOperations.delete(id));
  const now = Date.now();
  pendingPaths.forEach((path) => {
    pendingStageOperationsByPath.delete(path);
    recentOperationPaths.set(path, now);
  });
}

// ---------------------------------------------------------------------------
// syncWithGit
// ---------------------------------------------------------------------------

function* handleSyncWithGit(action: ReturnType<typeof syncWithGitRequested>): SagaGenerator<void> {
  const [wsId, force] = action.payload;
  if (!wsId) return;
  yield* call(doSyncWithGit, wsId, force ?? false);
}

export function* doSyncWithGit(wsId: string, force: boolean): SagaGenerator<void> {
  if (!wsId) return;

  if (syncInProgress) {
    syncDirty = true;
    syncDirtyForce = syncDirtyForce || force;
    return;
  }

  const now = Date.now();
  if (!force && now - lastSyncTime < SYNC_THROTTLE_MS) {
    return;
  }

  lastSyncTime = Date.now();
  syncInProgress = true;

  try {
    yield* call(invokeWithTimeout, "file-tracking:sync", { workspaceId: wsId, force }, IPC_SYNC_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof IpcTimeoutError) {
      logger.warn("Git sync timed out", { wsId, timeoutMs: IPC_SYNC_TIMEOUT_MS });
    } else {
      logger.error("Failed to sync with git", error as Error, { wsId });
    }
  } finally {
    syncInProgress = false;
    if (syncDirty) {
      const dirtyForce = syncDirtyForce;
      syncDirty = false;
      syncDirtyForce = false;
      yield* delay(0);
      yield* call(doSyncWithGit, wsId, dirtyForce);
    }
  }
}

// ---------------------------------------------------------------------------
// loadWorkspaceData
// ---------------------------------------------------------------------------

function* handleLoadWorkspaceData(action: ReturnType<typeof loadWorkspaceDataRequested>): SagaGenerator<void> {
  const wsId = action.payload[0];
  yield* call(doLoadWorkspaceData, wsId);
}

export function* doLoadWorkspaceData(wsId: string): SagaGenerator<void> {
  if (!wsId) return;

  if (hasPendingOperations()) {
    logger.debug("Skipping loadWorkspaceData - pending stage operations");
    return;
  }

  if (loadInProgress) {
    loadDirty = true;
    return;
  }

  loadInProgress = true;

  try {
    const [changesResponse, transitionsResponse, commitsResponse] = (yield* call(
      () =>
        Promise.all([
          invokeWithTimeout(
            "file-tracking:load",
            { workspaceId: wsId },
            IPC_LOAD_TIMEOUT_MS
          ) as Promise<{ changes: TrackedChange[]; truncated: boolean; totalCount: number } | null>,
          invokeWithTimeout(
            "file-tracking:load-transitions",
            { workspaceId: wsId },
            IPC_LOAD_TIMEOUT_MS
          ) as Promise<StageTransition[] | null>,
          invokeWithTimeout(
            FILE_TRACKING_CHANNELS.LOAD_COMMITS,
            { workspaceId: wsId, limit: 50 },
            IPC_LOAD_TIMEOUT_MS
          ) as Promise<{ commits: CommitInfo[]; boundarySha?: string } | null>,
        ])
    )) as [
      { changes: TrackedChange[]; truncated: boolean; totalCount: number } | null,
      StageTransition[] | null,
      { commits: CommitInfo[]; boundarySha?: string } | null,
    ];

    const currentWsId = yield* selectCurrentWorkspaceId.effect();
    if (currentWsId !== wsId) return;

    const newChanges = changesResponse?.changes || [];
    const isTruncated = changesResponse?.truncated || false;
    const totalCount = changesResponse?.totalCount || newChanges.length;
    const newTransitions = transitionsResponse || [];
    const newCommits: CommitInfo[] = commitsResponse?.commits || [];
    const newBoundarySha = commitsResponse?.boundarySha ?? null;

    const now = Date.now();
    const existingChanges = yield* selectFileTrackingChanges.effect(wsId);
    const filteredChanges = newChanges.filter((c) => {
      if (pendingStageOperations.has(c.id)) return false;
      if (pendingStageOperationsByPath.has(c.relativePath)) return false;
      const lastOpTime = recentOperationPaths.get(c.relativePath);
      if (lastOpTime && now - lastOpTime < OPERATION_COOLDOWN_MS) {
        const existingChange = existingChanges.find(
          (existing) => existing.relativePath === c.relativePath && existing.stage === c.stage
        );
        if (!existingChange) return false;
      }
      return true;
    });

    for (const [path, timestamp] of recentOperationPaths) {
      if (now - timestamp >= OPERATION_COOLDOWN_MS) {
        recentOperationPaths.delete(path);
      }
    }

    const hasChanges = hasChangesDifference(existingChanges, filteredChanges);
    const wsState = yield* select((s: any) => s.fileTracking.byWorkspaceId[wsId]);
    const existingTrans = wsState?.transitions || [];
    const existingCommits = wsState?.commits || [];
    const hasTransitionChanges = hasTransitionsDifference(existingTrans, newTransitions);
    const hasCommitChanges = hasCommitsDifference(existingCommits, newCommits);

    if (hasChanges) {
      yield* put(setChangesData(wsId, filteredChanges, isTruncated, totalCount));
    }
    if (hasTransitionChanges) {
      yield* put(setTransitions(wsId, newTransitions));
    }
    if (hasCommitChanges) {
      yield* put(setCommitsData(wsId, newCommits, newBoundarySha));
    } else if (wsState?.boundarySha !== newBoundarySha) {
      yield* put(setCommitsData(wsId, existingCommits, newBoundarySha));
    }
  } catch (error) {
    const currentWsId = yield* selectCurrentWorkspaceId.effect();
    if (currentWsId === wsId) {
      if (error instanceof IpcTimeoutError) {
        yield* put(setError(wsId, "Loading timed out - please try refreshing"));
      } else {
        yield* put(setError(wsId, error instanceof Error ? error.message : "Failed to load data"));
      }
    }
  } finally {
    yield* put(setLoading(wsId, false));
    loadInProgress = false;
    if (loadDirty) {
      loadDirty = false;
      yield* delay(0);
      yield* call(doLoadWorkspaceData, wsId);
    }
  }
}


// ---------------------------------------------------------------------------
// refresh
// ---------------------------------------------------------------------------

function* handleRefresh(action: ReturnType<typeof refreshRequested>): SagaGenerator<void> {
  const wsId = action.payload[0];
  if (!wsId) return;
  if (refreshInProgress) return;

  refreshInProgress = true;
  try {
    yield* call(doSyncWithGit, wsId, true);
    const currentWsId = yield* selectCurrentWorkspaceId.effect();
    if (currentWsId !== wsId) return;
    yield* call(doLoadWorkspaceData, wsId);
  } finally {
    refreshInProgress = false;
  }
}

// ---------------------------------------------------------------------------
// stageChanges
// ---------------------------------------------------------------------------

function* handleStageChanges(action: ReturnType<typeof stageChangesRequested>): SagaGenerator<void> {
  const { wsId, changeIds, changesFromUI } = action.payload;
  if (!wsId) return;

  changeIds.forEach((id) => pendingStageOperations.add(id));

  const existingChanges = yield* selectFileTrackingChanges.effect(wsId);
  const originalChanges = [...existingChanges];
  const pendingPaths: string[] = [];
  const syntheticChangesToAdd: TrackedChange[] = [];

  for (const id of changeIds) {
    const existing = existingChanges.find((c) => c.id === id);
    if (existing) {
      pendingPaths.push(existing.relativePath);
      pendingStageOperationsByPath.add(existing.relativePath);
    } else if (id.startsWith("git-") && changesFromUI) {
      const uiChange = changesFromUI.find((c) => c.id === id);
      if (uiChange) {
        syntheticChangesToAdd.push({ ...uiChange, stage: ChangeStage.Staged });
        pendingPaths.push(uiChange.relativePath);
        pendingStageOperationsByPath.add(uiChange.relativePath);
      }
    }
  }

  // Build optimistic updated changes
  const updatedChanges: TrackedChange[] = [];
  for (const c of existingChanges) {
    if (changeIds.includes(c.id) && c.stage === ChangeStage.Unstaged) {
      const hasExistingStaged = existingChanges.some(
        (other) => other.relativePath === c.relativePath && other.stage === ChangeStage.Staged
      );
      if (hasExistingStaged) continue;
      updatedChanges.push({ ...c, stage: ChangeStage.Staged });
    } else {
      updatedChanges.push(c);
    }
  }
  for (const syntheticChange of syntheticChangesToAdd) {
    const hasExistingStaged = updatedChanges.some(
      (c) => c.relativePath === syntheticChange.relativePath && c.stage === ChangeStage.Staged
    );
    if (!hasExistingStaged) updatedChanges.push(syntheticChange);
  }

  yield* put(setChanges(wsId, updatedChanges));

  try {
    const response = (yield* call(invoke, "file-tracking:stage-changes", {
      workspaceId: wsId,
      changeIds,
    })) as { ok: boolean; error?: string };

    clearPendingState(changeIds, pendingPaths);
    if (!response.ok) {
      yield* put(setChanges(wsId, originalChanges));
    }
  } catch {
    clearPendingState(changeIds, pendingPaths);
    yield* put(setChanges(wsId, originalChanges));
  }
}


// ---------------------------------------------------------------------------
// unstageChanges
// ---------------------------------------------------------------------------

function* handleUnstageChanges(action: ReturnType<typeof unstageChangesRequested>): SagaGenerator<void> {
  const { wsId, changeIds, changesFromUI } = action.payload;
  if (!wsId) return;

  changeIds.forEach((id) => pendingStageOperations.add(id));

  const existingChanges = yield* selectFileTrackingChanges.effect(wsId);
  const originalChanges = [...existingChanges];
  const pendingPaths: string[] = [];
  const syntheticChangesToAdd: TrackedChange[] = [];

  for (const id of changeIds) {
    const existing = existingChanges.find((c) => c.id === id);
    if (existing) {
      pendingPaths.push(existing.relativePath);
      pendingStageOperationsByPath.add(existing.relativePath);
    } else if (id.startsWith("git-") && changesFromUI) {
      const uiChange = changesFromUI.find((c) => c.id === id);
      if (uiChange) {
        syntheticChangesToAdd.push({ ...uiChange, stage: ChangeStage.Unstaged });
        pendingPaths.push(uiChange.relativePath);
        pendingStageOperationsByPath.add(uiChange.relativePath);
      }
    }
  }

  const updatedChanges: TrackedChange[] = [];
  for (const c of existingChanges) {
    if (changeIds.includes(c.id) && c.stage === ChangeStage.Staged) {
      const hasExistingUnstaged = existingChanges.some(
        (other) => other.relativePath === c.relativePath && other.stage === ChangeStage.Unstaged
      );
      if (hasExistingUnstaged) continue;
      updatedChanges.push({ ...c, stage: ChangeStage.Unstaged });
    } else {
      updatedChanges.push(c);
    }
  }
  for (const syntheticChange of syntheticChangesToAdd) {
    const hasExistingUnstaged = updatedChanges.some(
      (c) => c.relativePath === syntheticChange.relativePath && c.stage === ChangeStage.Unstaged
    );
    if (!hasExistingUnstaged) updatedChanges.push(syntheticChange);
  }

  yield* put(setChanges(wsId, updatedChanges));

  try {
    const response = (yield* call(invoke, "file-tracking:unstage-changes", {
      workspaceId: wsId,
      changeIds,
    })) as { ok: boolean; error?: string };

    clearPendingState(changeIds, pendingPaths);
    if (!response.ok) {
      yield* put(setChanges(wsId, originalChanges));
    }
  } catch {
    clearPendingState(changeIds, pendingPaths);
    yield* put(setChanges(wsId, originalChanges));
  }
}

// ---------------------------------------------------------------------------
// stageByPath / unstageByPath
// ---------------------------------------------------------------------------

function* handleStageByPath(action: ReturnType<typeof stageByPathRequested>): SagaGenerator<void> {
  const [wsId, filePaths] = action.payload;
  const validPaths = filePaths.filter(Boolean);
  if (validPaths.length === 0) return;

  const existingChanges = yield* selectFileTrackingChanges.effect(wsId);
  const changeIds: string[] = [];
  const changesFromUI: TrackedChange[] = [];

  for (const filePath of validPaths) {
    const existing = existingChanges.find(
      (c) => c.relativePath === filePath && c.stage === ChangeStage.Unstaged
    );
    if (existing) {
      changeIds.push(existing.id);
      changesFromUI.push(existing);
    } else {
      const syntheticId = `git-path-${filePath}`;
      changeIds.push(syntheticId);
      changesFromUI.push({
        id: syntheticId,
        file: filePath,
        relativePath: filePath,
        stage: ChangeStage.Unstaged,
        stats: { additions: 0, deletions: 0 },
        attribution: { manual: true, timestamp: Date.now() },
      } as TrackedChange);
    }
  }

  yield* call(handleStageChanges, stageChangesRequested(wsId, changeIds, changesFromUI));
}

function* handleUnstageByPath(action: ReturnType<typeof unstageByPathRequested>): SagaGenerator<void> {
  const [wsId, filePaths] = action.payload;
  const validPaths = filePaths.filter(Boolean);
  if (validPaths.length === 0) return;

  const existingChanges = yield* selectFileTrackingChanges.effect(wsId);
  const changeIds: string[] = [];
  const changesFromUI: TrackedChange[] = [];

  for (const filePath of validPaths) {
    const existing = existingChanges.find(
      (c) => c.relativePath === filePath && c.stage === ChangeStage.Staged
    );
    if (existing) {
      changeIds.push(existing.id);
      changesFromUI.push(existing);
    } else {
      const syntheticId = `git-path-${filePath}`;
      changeIds.push(syntheticId);
      changesFromUI.push({
        id: syntheticId,
        file: filePath,
        relativePath: filePath,
        stage: ChangeStage.Staged,
        stats: { additions: 0, deletions: 0 },
        attribution: { manual: true, timestamp: Date.now() },
      } as TrackedChange);
    }
  }

  yield* call(handleUnstageChanges, unstageChangesRequested(wsId, changeIds, changesFromUI));
}

// ---------------------------------------------------------------------------
// revertChange / revertChanges / revertByPath
// ---------------------------------------------------------------------------

function* handleRevertChange(action: ReturnType<typeof revertChangeRequested>): SagaGenerator<void> {
  const [wsId, change] = action.payload;
  const filePath = change.relativePath || change.file;
  if (!filePath || !wsId) return;

  const changeId = change.id;
  pendingStageOperations.add(changeId);
  pendingStageOperationsByPath.add(filePath);

  const existingChanges = yield* selectFileTrackingChanges.effect(wsId);
  const originalChanges = [...existingChanges];
  yield* put(setChanges(wsId, existingChanges.filter((c) => c.id !== changeId)));

  try {
    yield* call(invoke, "git:discard", { workspaceId: wsId, paths: [filePath] });
    clearPendingState([changeId], [filePath]);
    // Fire-and-forget refresh after successful revert
    yield* fork(handleRefresh, refreshRequested(wsId));
  } catch (error) {
    logger.error("Failed to revert change", error as Error, { filePath });
    clearPendingState([changeId], [filePath]);
    yield* put(setChanges(wsId, originalChanges));
  }
}

function* handleRevertChanges(action: ReturnType<typeof revertChangesRequested>): SagaGenerator<void> {
  const [wsId, changes] = action.payload;
  if (changes.length === 0 || !wsId) return;

  const filePaths = changes.map((c) => c.relativePath || c.file).filter((p): p is string => !!p);
  if (filePaths.length === 0) return;

  const changeIds = changes.map((c) => c.id);
  changeIds.forEach((id) => pendingStageOperations.add(id));
  filePaths.forEach((path) => pendingStageOperationsByPath.add(path));

  const existingChanges = yield* selectFileTrackingChanges.effect(wsId);
  const originalChanges = [...existingChanges];
  const idsToRemove = new Set(changeIds);
  yield* put(setChanges(wsId, existingChanges.filter((c) => !idsToRemove.has(c.id))));

  try {
    yield* call(invoke, "git:discard", { workspaceId: wsId, paths: filePaths });
    clearPendingState(changeIds, filePaths);
    yield* fork(handleRefresh, refreshRequested(wsId));
  } catch (error) {
    logger.error("Failed to revert changes", error as Error, { filePaths });
    clearPendingState(changeIds, filePaths);
    yield* put(setChanges(wsId, originalChanges));
  }
}

function* handleRevertByPath(action: ReturnType<typeof revertByPathRequested>): SagaGenerator<void> {
  const [wsId, filePaths] = action.payload;
  const validPaths = filePaths.filter(Boolean);
  if (validPaths.length === 0) return;

  const existingChanges = yield* selectFileTrackingChanges.effect(wsId);
  const changesToRevert = existingChanges.filter(
    (c) => validPaths.includes(c.relativePath || c.file)
  );

  if (changesToRevert.length > 0) {
    yield* call(handleRevertChanges, revertChangesRequested(wsId, changesToRevert));
  } else {
    // No tracked changes found, but still try to discard
    try {
      validPaths.forEach((path) => pendingStageOperationsByPath.add(path));
      yield* call(invoke, "git:discard", { workspaceId: wsId, paths: validPaths });
      validPaths.forEach((path) => pendingStageOperationsByPath.delete(path));
      yield* fork(handleRefresh, refreshRequested(wsId));
    } catch (error) {
      logger.error("Failed to revert by path", error as Error, { filePaths: validPaths });
      validPaths.forEach((path) => pendingStageOperationsByPath.delete(path));
    }
  }
}

// ---------------------------------------------------------------------------
// trackChange / clearTrackedChanges / loadOlderCommits
// ---------------------------------------------------------------------------

function* handleTrackChange(action: ReturnType<typeof trackChangeRequested>): SagaGenerator<void> {
  const [wsId, change] = action.payload;
  if (!wsId) return;

  try {
    yield* call(invoke, "file-tracking:track", { workspaceId: wsId, change });
  } catch (error) {
    logger.error("Failed to track change", error as Error);
  }
}

function* handleClearTrackedChanges(action: ReturnType<typeof clearTrackedChangesRequested>): SagaGenerator<void> {
  const wsId = action.payload[0];
  if (!wsId) return;

  try {
    yield* call(invoke, "file-tracking:clear-tracked", { workspaceId: wsId });
    yield* put(clearAllChanges(wsId));
  } catch (error) {
    logger.error("Failed to clear tracked changes", error as Error);
  }
}

function* handleLoadOlderCommits(action: ReturnType<typeof loadOlderCommitsRequested>): SagaGenerator<void> {
  const { wsId, beforeSha, limit } = action.payload;
  if (!wsId) return;

  yield* put(setLoadingOlderCommits(wsId, true));

  try {
    const response = (yield* call(
      invokeWithTimeout,
      FILE_TRACKING_CHANNELS.LOAD_OLDER_COMMITS,
      { workspaceId: wsId, beforeSha, limit: limit ?? 50 },
      IPC_LOAD_TIMEOUT_MS
    )) as { commits: CommitInfo[]; boundarySha?: string } | null;

    if (response?.commits) {
      yield* put(appendOlderCommits(wsId, response.commits));
    }
  } catch (error) {
    logger.error("Failed to load older commits", error as Error);
  } finally {
    yield* put(setLoadingOlderCommits(wsId, false));
  }
}

// ---------------------------------------------------------------------------
// Root watcher
// ---------------------------------------------------------------------------

export function* fileTrackingOperationsSaga(): SagaGenerator<void> {
  yield* takeEvery(syncWithGitRequested, handleSyncWithGit);
  yield* takeEvery(loadWorkspaceDataRequested, handleLoadWorkspaceData);
  yield* takeEvery(refreshRequested, handleRefresh);
  yield* takeEvery(stageChangesRequested, handleStageChanges);
  yield* takeEvery(unstageChangesRequested, handleUnstageChanges);
  yield* takeEvery(stageByPathRequested, handleStageByPath);
  yield* takeEvery(unstageByPathRequested, handleUnstageByPath);
  yield* takeEvery(revertChangeRequested, handleRevertChange);
  yield* takeEvery(revertChangesRequested, handleRevertChanges);
  yield* takeEvery(revertByPathRequested, handleRevertByPath);
  yield* takeEvery(trackChangeRequested, handleTrackChange);
  yield* takeEvery(clearTrackedChangesRequested, handleClearTrackedChanges);
  yield* takeEvery(loadOlderCommitsRequested, handleLoadOlderCommits);
}