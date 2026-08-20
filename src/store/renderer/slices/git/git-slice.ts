/**
 * Git Slice
 *
 * Actions and reducer for workspace-scoped git state.
 * Replaces the deprecated git.store.svelte.ts.
 */

import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import type {
  GitWorkspaceState,
  GitState,
  GitOperationCompletedEvent,
  GitOperationFailedEvent,
  GitOperationFlagName,
  GitOperationFlags,
  PostMergeState,
} from './git-types';
export type { GitOperationCompletedEvent, GitOperationFailedEvent } from './git-types';
import type { GitStatus } from '$shared/types';

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
export const loadGitStatus = createAction<[wsId: string, forceRefresh?: boolean]>('git/loadStatus');

/** Set git status result */
export const setGitStatus = createAction('git/setStatus', (wsId: string, status: GitStatus) => ({
  wsId,
  status,
}));

// ── Git Operation Event Actions ──

export const setLastGitOperation =
  createAction<[event: GitOperationCompletedEvent]>('git/setLastGitOperation');

export const setLastGitError =
  createAction<[event: GitOperationFailedEvent]>('git/setLastGitError');

// ── Sidebar git operation actions (moved from transient-ui) ──

export const setPostMergeState =
  createAction<[wsId: string, postMergeState: PostMergeState | null]>('git/setPostMergeState');

export const setGitOperationFlag =
  createAction<[wsId: string, flag: GitOperationFlagName, value: boolean]>(
    'git/setGitOperationFlag',
  );

// ── Reducer ──

export const gitReducer = createReducer<GitState>(initialState);
gitReducer.with(setGitStatus, (state, action) => {
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
});
gitReducer.with(workspaceUnmounted, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
gitReducer.with(setLastGitOperation, (state, { payload: [event] }) => ({
  ...state,
  lastGitOperation: event,
}));
gitReducer.with(setLastGitError, (state, { payload: [event] }) => ({
  ...state,
  lastGitError: event,
}));
gitReducer.with(setPostMergeState, (state, { payload: [wsId, postMergeState] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, { ...ws, postMergeState });
});
gitReducer.with(setGitOperationFlag, (state, { payload: [wsId, flag, value] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...ws,
    gitOperations: { ...ws.gitOperations, [flag]: value },
  });
});
