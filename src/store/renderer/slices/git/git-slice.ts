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
import type { CommitFile } from '$features/file-tracking/types';

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
  secondaryRoots: {},
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

export const loadSecondaryRootGit = createAction<
  [wsId: string, gitRootId: string, registeredCommitSha?: string, limit?: number]
>('git/loadSecondaryRoot');
export const loadSecondaryRootCommitFiles = createAction<
  [wsId: string, gitRootId: string, commitHash: string]
>('git/loadSecondaryRootCommitFiles');
export const setSecondaryRootGitLoading = createAction<
  [wsId: string, gitRootId: string]
>('git/setSecondaryRootLoading');
export const setSecondaryRootGit = createAction(
  'git/setSecondaryRoot',
  (
    wsId: string,
    gitRootId: string,
    data: Omit<import('./git-types').SecondaryRootGitState, 'loading' | 'error'>,
  ) => ({ wsId, gitRootId, data }),
);
export const setSecondaryRootGitError = createAction<
  [wsId: string, gitRootId: string, error: string]
>('git/setSecondaryRootError');
export const setSecondaryRootCommitFiles = createAction(
  'git/setSecondaryRootCommitFiles',
  (wsId: string, gitRootId: string, commitHash: string, files: CommitFile[]) => ({
    wsId,
    gitRootId,
    commitHash,
    files,
  }),
);

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
gitReducer.with(setSecondaryRootGitLoading, (state, { payload: [wsId, gitRootId] }) => {
  const ws = getWorkspaceState(state, wsId);
  const current = ws.secondaryRoots[gitRootId];
  return setWorkspaceState(state, wsId, {
    ...ws,
    secondaryRoots: {
      ...ws.secondaryRoots,
      [gitRootId]: {
        status: current?.status ?? null,
        commits: current?.commits ?? [],
        nextToken: current?.nextToken,
        commitFiles: current?.commitFiles ?? {},
        loading: true,
        error: null,
      },
    },
  });
});
gitReducer.with(setSecondaryRootGit, (state, { payload: { wsId, gitRootId, data } }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...ws,
    secondaryRoots: {
      ...ws.secondaryRoots,
      [gitRootId]: { ...data, loading: false, error: null },
    },
  });
});
gitReducer.with(setSecondaryRootGitError, (state, { payload: [wsId, gitRootId, error] }) => {
  const ws = getWorkspaceState(state, wsId);
  const current = ws.secondaryRoots[gitRootId];
  return setWorkspaceState(state, wsId, {
    ...ws,
    secondaryRoots: {
      ...ws.secondaryRoots,
      [gitRootId]: {
        status: current?.status ?? null,
        commits: current?.commits ?? [],
        nextToken: current?.nextToken,
        commitFiles: current?.commitFiles ?? {},
        loading: false,
        error,
      },
    },
  });
});
gitReducer.with(setSecondaryRootCommitFiles, (state, { payload }) => {
  const { wsId, gitRootId, commitHash, files } = payload;
  const ws = getWorkspaceState(state, wsId);
  const current = ws.secondaryRoots[gitRootId];
  if (!current) return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    secondaryRoots: {
      ...ws.secondaryRoots,
      [gitRootId]: {
        ...current,
        commitFiles: { ...current.commitFiles, [commitHash]: files },
      },
    },
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
