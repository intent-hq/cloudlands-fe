/**
 * Git Slice
 *
 * Actions and reducer for workspace-scoped git state.
 * Replaces the deprecated git.store.svelte.ts.
 */

import { createAction } from "@augmentcode/ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "@augmentcode/ag-redux-toolkit/utils/store/create-reducer";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import type {
  GitWorkspaceState,
  GitState,
  GitOperationCompletedEvent,
  GitOperationFailedEvent,
  GitOperationFlagName,
  GitOperationFlags,
  AutoCommitHookFailureEvent,
  PostMergeState,
} from "./git-types";
export type { GitOperationCompletedEvent, GitOperationFailedEvent, AutoCommitHookFailureEvent } from "./git-types";
import type { GitStatus, DiffChunk } from "$shared/types";

export const defaultGitOperationFlags: GitOperationFlags = {
  isPushing: false,
  isPulling: false,
  isForcePushing: false,
  isRebasing: false,
  isRefreshingPR: false,
  isRefreshingGitStatus: false,
  isResettingToTrunk: false,
};

const emptyWorkspaceState: GitWorkspaceState = {
  status: null,
  diffs: [],
  loading: false,
  error: null,
  branch: null,
  ahead: 0,
  behind: 0,
  postMergeState: null,
  gitOperations: { ...defaultGitOperationFlags },
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceState);

export { getWorkspaceState as getGitWorkspaceState };

export const initialState: GitState = {
  byWorkspaceId: {},
  lastGitOperation: null,
  lastGitError: null,
  lastAutoCommitHookFailure: null,
};

// ── Actions ──

/** Trigger saga to load git status for a workspace */
export const loadGitStatus = createAction<[wsId: string, forceRefresh?: boolean]>(
  "git/loadStatus"
);

/** Set loading state for a workspace */
export const setGitLoading = createAction<[wsId: string, loading: boolean]>(
  "git/setLoading"
);

/** Set git status result */
export const setGitStatus = createAction(
  "git/setStatus",
  (wsId: string, status: GitStatus) => ({ wsId, status })
);

/** Set git error */
export const setGitError = createAction<[wsId: string, error: string]>(
  "git/setError"
);

/** Clear git error */
export const clearGitError = createAction<[wsId: string]>(
  "git/clearError"
);

/** Trigger saga to load diffs */
export const loadGitDiffs = createAction<[wsId: string]>(
  "git/loadDiffs"
);

/** Set diffs result */
export const setGitDiffs = createAction(
  "git/setDiffs",
  (wsId: string, diffs: DiffChunk[]) => ({ wsId, diffs })
);

/** Trigger saga: commit */
export const gitCommit = createAction<[wsId: string, message: string]>(
  "git/commit"
);

/** Trigger saga: push */
export const gitPush = createAction<[wsId: string, force?: boolean]>(
  "git/push"
);

/** Trigger saga: pull */
export const gitPull = createAction<[wsId: string]>(
  "git/pull"
);

/** Trigger saga: stage hunk */
export const gitStageHunk = createAction<[wsId: string, filePath: string, hunkPatch: string]>(
  "git/stageHunk"
);

/** Trigger saga: unstage hunk */
export const gitUnstageHunk = createAction<[wsId: string, filePath: string, hunkPatch: string]>(
  "git/unstageHunk"
);

/** Trigger saga: remove lock file */
export const gitRemoveLockFile = createAction<[wsId: string]>(
  "git/removeLockFile"
);

// ── Git Operation Event Actions ──

export const setLastGitOperation = createAction<[event: GitOperationCompletedEvent]>(
  "git/setLastGitOperation"
);

export const setLastGitError = createAction<[event: GitOperationFailedEvent]>(
  "git/setLastGitError"
);

export const setLastAutoCommitHookFailure = createAction<[
  event: AutoCommitHookFailureEvent,
]>("git/setLastAutoCommitHookFailure");

// ── Sidebar git operation actions (moved from transient-ui) ──

export const setPostMergeState = createAction<[
  wsId: string,
  postMergeState: PostMergeState | null,
]>("git/setPostMergeState");

export const setGitOperationFlag = createAction<[
  wsId: string,
  flag: GitOperationFlagName,
  value: boolean,
]>("git/setGitOperationFlag");

// ── Reducer ──

export const gitReducer = createReducer<GitState>(initialState)
  .with(setGitLoading, (state, { payload: [wsId, loading] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, loading });
  })
  .with(setGitStatus, (state, action) => {
    const { wsId, status } = action.payload;
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      status,
      loading: false,
      error: null,
      branch: status.branch || null,
      ahead: status.ahead || 0,
      behind: status.behind || 0,
    });
  })
  .with(setGitError, (state, { payload: [wsId, error] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, error, loading: false });
  })
  .with(clearGitError, (state, { payload: [wsId] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (ws.error === null) return state;
    return setWorkspaceState(state, wsId, { ...ws, error: null });
  })
  .with(setGitDiffs, (state, action) => {
    const { wsId, diffs } = action.payload;
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, diffs, loading: false });
  })
  .with(workspaceUnmounted, (state, { payload: [wsId] }) => clearWorkspaceState(state, wsId))
  .with(setLastGitOperation, (state, { payload: [event] }) => ({
    ...state,
    lastGitOperation: event,
  }))
  .with(setLastGitError, (state, { payload: [event] }) => ({
    ...state,
    lastGitError: event,
  }))
  .with(setLastAutoCommitHookFailure, (state, { payload: [event] }) => ({
    ...state,
    lastAutoCommitHookFailure: event,
  }))
  .with(setPostMergeState, (state, { payload: [wsId, postMergeState] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, postMergeState });
  })
  .with(setGitOperationFlag, (state, { payload: [wsId, flag, value] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      gitOperations: { ...ws.gitOperations, [flag]: value },
    });
  });

