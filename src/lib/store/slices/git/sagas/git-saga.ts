/**
 * Git Saga
 *
 * Side effects for git operations: IPC calls to gitClient,
 * git:status-changed listener, loadStatus/commits/diffs handlers.
 */

import { call, put, fork, delay, takeEvery, takeLatest } from "typed-redux-saga";
import { Logger } from "$shared/logger";
import { gitClient } from "$features/git/git.client";
import { gitCache } from "$features/git/git-cache";
import type { GitStatus } from "$shared/types";
import { isValidWorkspaceId, WorkspaceId } from "$shared/types/branded-ids";
import { takeEveryFromElectronChannel } from "$lib/store/utils/ipc-channel";
import {
  loadGitStatus,
  setGitLoading,
  setGitStatus,
  setGitError,
  clearGitError,
  loadGitCommits,
  setGitCommits,
  loadGitDiffs,
  setGitDiffs,
  gitCommit,
  gitPush,
  gitPull,
  gitStageFile,
  gitUnstageFile,
  gitStageHunk,
  gitUnstageHunk,
  gitRemoveLockFile,
} from "../git-slice";

const logger = new Logger("GitSaga");

// ── Load Status ──

function* handleLoadStatus(action: ReturnType<typeof loadGitStatus>) {
  const [wsId, forceRefresh] = action.payload;

  if (!wsId || !isValidWorkspaceId(wsId as WorkspaceId)) {
    yield* put(setGitError(wsId, "Invalid workspace ID"));
    return;
  }

  // Check cache first unless force refresh
  const cacheKey = `git-status-${wsId}`;
  if (!forceRefresh) {
    const cached = gitCache.get<GitStatus>(cacheKey, 30000);
    if (cached) {
      yield* put(setGitStatus(wsId, cached));
      // Background refresh if cache older than 5s
      const cacheAge = gitCache.getAge(cacheKey);
      if (cacheAge && cacheAge > 5000) {
        yield* fork(backgroundRefreshStatus, wsId, cacheKey);
      }
      return;
    }
  }

  yield* put(setGitLoading(wsId, true));
  yield* put(clearGitError(wsId));

  try {
    const result = yield* call([gitClient, gitClient.getStatus], wsId as WorkspaceId);
    if (result.ok) {
      gitCache.set(cacheKey, result.data);
      yield* put(setGitStatus(wsId, result.data));
    } else {
      yield* put(setGitError(wsId, result.error));
    }
  } catch (error) {
    yield* put(
      setGitError(wsId, error instanceof Error ? error.message : "Failed to load git status")
    );
  }
}

function* backgroundRefreshStatus(wsId: string, cacheKey: string) {
  try {
    const result = yield* call([gitClient, gitClient.getStatus], wsId as WorkspaceId);
    if (result.ok) {
      gitCache.set(cacheKey, result.data);
      yield* put(setGitStatus(wsId, result.data));
    }
  } catch {
    // Silently fail — we already have cached data
  }
}

// ── Load Commits ──

function* handleLoadCommits(action: ReturnType<typeof loadGitCommits>) {
  const { wsId, limit, since, baseRef, baseCommitSha } = action.payload;
  yield* put(setGitLoading(wsId, true));
  yield* put(clearGitError(wsId));

  try {
    const result = yield* call(
      [gitClient, gitClient.getHistory],
      wsId as WorkspaceId,
      limit,
      since,
      baseRef,
      baseCommitSha
    );
    if (result.ok) {
      yield* put(setGitCommits(wsId, result.data));
    } else {
      yield* put(setGitError(wsId, result.error));
    }
  } catch (error) {
    yield* put(
      setGitError(wsId, error instanceof Error ? error.message : "Failed to load commits")
    );
  }
}

// ── Load Diffs ──

function* handleLoadDiffs(action: ReturnType<typeof loadGitDiffs>) {
  const [wsId] = action.payload;
  yield* put(setGitLoading(wsId, true));
  yield* put(clearGitError(wsId));

  try {
    const result = yield* call([gitClient, gitClient.getDiff], wsId as WorkspaceId);
    if (result.ok) {
      yield* put(setGitDiffs(wsId, result.data));
    } else {
      yield* put(setGitError(wsId, result.error));
    }
  } catch (error) {
    yield* put(
      setGitError(wsId, error instanceof Error ? error.message : "Failed to load diffs")
    );
  }
}

// ── Git Commit ──

function* handleGitCommit(action: ReturnType<typeof gitCommit>) {
  const [wsId, message] = action.payload;
  try {
    const result = yield* call([gitClient, gitClient.commit], wsId as WorkspaceId, message);
    if (result.ok) {
      gitCache.invalidateWorkspace(wsId);
      yield* put(loadGitStatus(wsId, true));
    } else {
      yield* put(setGitError(wsId, result.error));
    }
  } catch (error) {
    yield* put(
      setGitError(wsId, error instanceof Error ? error.message : "Commit failed")
    );
  }
}

// ── Git Push ──

function* handleGitPush(action: ReturnType<typeof gitPush>) {
  const [wsId, force] = action.payload;
  try {
    const result = yield* call([gitClient, gitClient.push], wsId as WorkspaceId, undefined, force);
    if (result.ok) {
      gitCache.invalidateWorkspace(wsId);
      yield* put(loadGitStatus(wsId, true));
    } else {
      yield* put(setGitError(wsId, result.error));
    }
  } catch (error) {
    yield* put(
      setGitError(wsId, error instanceof Error ? error.message : "Push failed")
    );
  }
}

// ── Git Pull ──

function* handleGitPull(action: ReturnType<typeof gitPull>) {
  const [wsId] = action.payload;
  try {
    const result = yield* call([gitClient, gitClient.pull], wsId as WorkspaceId);
    if (result.ok) {
      gitCache.invalidateWorkspace(wsId);
      yield* put(loadGitStatus(wsId, true));
    } else {
      yield* put(setGitError(wsId, result.error));
    }
  } catch (error) {
    yield* put(
      setGitError(wsId, error instanceof Error ? error.message : "Pull failed")
    );
  }
}

// ── Stage / Unstage File ──

function* handleStageFile(action: ReturnType<typeof gitStageFile>) {
  const [wsId, filePath] = action.payload;
  try {
    const result = yield* call([gitClient, gitClient.stageFiles], wsId as WorkspaceId, [filePath]);
    if (result.ok) {
      yield* put(loadGitStatus(wsId));
    } else {
      yield* put(setGitError(wsId, result.error));
    }
  } catch (error) {
    yield* put(
      setGitError(wsId, error instanceof Error ? error.message : "Failed to stage file")
    );
  }
}

function* handleUnstageFile(action: ReturnType<typeof gitUnstageFile>) {
  const [wsId, filePath] = action.payload;
  try {
    const result = yield* call([gitClient, gitClient.unstageFiles], wsId as WorkspaceId, [filePath]);
    if (result.ok) {
      yield* put(loadGitStatus(wsId));
    } else {
      yield* put(setGitError(wsId, result.error));
    }
  } catch (error) {
    yield* put(
      setGitError(wsId, error instanceof Error ? error.message : "Failed to unstage file")
    );
  }
}

// ── Stage / Unstage Hunk ──

function* handleStageHunk(action: ReturnType<typeof gitStageHunk>) {
  const [wsId, filePath, hunkPatch] = action.payload;
  try {
    const result = yield* call(
      [gitClient, gitClient.stageHunk],
      wsId as WorkspaceId,
      filePath,
      hunkPatch
    );
    if (result.ok) {
      gitCache.invalidateWorkspace(wsId);
      yield* put(loadGitStatus(wsId, true));
    } else {
      yield* put(setGitError(wsId, result.error));
    }
  } catch (error) {
    yield* put(
      setGitError(wsId, error instanceof Error ? error.message : "Failed to stage hunk")
    );
  }
}

function* handleUnstageHunk(action: ReturnType<typeof gitUnstageHunk>) {
  const [wsId, filePath, hunkPatch] = action.payload;
  try {
    const result = yield* call(
      [gitClient, gitClient.unstageHunk],
      wsId as WorkspaceId,
      filePath,
      hunkPatch
    );
    if (result.ok) {
      gitCache.invalidateWorkspace(wsId);
      yield* put(loadGitStatus(wsId, true));
    } else {
      yield* put(setGitError(wsId, result.error));
    }
  } catch (error) {
    yield* put(
      setGitError(wsId, error instanceof Error ? error.message : "Failed to unstage hunk")
    );
  }
}

// ── Remove Lock File ──

function* handleRemoveLockFile(action: ReturnType<typeof gitRemoveLockFile>) {
  const [wsId] = action.payload;
  try {
    const result = yield* call([gitClient, gitClient.removeLockFile], wsId as WorkspaceId);
    if (result.ok) {
      yield* put(loadGitStatus(wsId));
    } else {
      yield* put(setGitError(wsId, result.error));
    }
  } catch (error) {
    yield* put(
      setGitError(wsId, error instanceof Error ? error.message : "Failed to remove lock file")
    );
  }
}

// ── git:status-changed IPC listener ──

function* watchGitStatusChanged() {
  if (typeof window === "undefined" || !window.electronAPI) return;

  yield* takeEveryFromElectronChannel<{ workspaceId?: string }>(
    "git:status-changed",
    function* (data) {
      if (!data?.workspaceId) return;
      const wsId = data.workspaceId;
      logger.debug("[GitSaga] git:status-changed received", { wsId });
      // Debounce: delay, then force refresh
      yield* delay(500);
      gitCache.invalidateWorkspace(wsId);
      yield* put(loadGitStatus(wsId, true));
    }
  );
}

// ── Root Saga ──

export function* gitSaga() {
  yield* fork(watchGitStatusChanged);
  yield* takeLatest(loadGitStatus, handleLoadStatus);
  yield* takeEvery(loadGitCommits, handleLoadCommits);
  yield* takeEvery(loadGitDiffs, handleLoadDiffs);
  yield* takeEvery(gitCommit, handleGitCommit);
  yield* takeEvery(gitPush, handleGitPush);
  yield* takeEvery(gitPull, handleGitPull);
  yield* takeEvery(gitStageFile, handleStageFile);
  yield* takeEvery(gitUnstageFile, handleUnstageFile);
  yield* takeEvery(gitStageHunk, handleStageHunk);
  yield* takeEvery(gitUnstageHunk, handleUnstageHunk);
  yield* takeEvery(gitRemoveLockFile, handleRemoveLockFile);
}

