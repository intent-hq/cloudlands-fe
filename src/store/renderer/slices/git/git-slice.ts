/**
 * Git Slice
 *
 * Actions and reducer for workspace-scoped git state.
 * Replaces the deprecated git.store.svelte.ts.
 */

import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  createCollection,
  upsertItem,
} from '@augmentcode/themis/utils/collections/collection-utils';
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
  SecondaryRootGitData,
} from './git-types';
export type { GitOperationCompletedEvent, GitOperationFailedEvent } from './git-types';
import type { GitStatus } from '$shared/types';
import type { CommitFile } from '$features/file-tracking/types';
import type { WorkspaceGitStatus } from '$features/accept-changes/types';

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
  acceptChangesStatus: null,
  acceptChangesStatusLoading: false,
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

export const loadSecondaryRootGit =
  createAction<[wsId: string, gitRootId: string, registeredCommitSha?: string, limit?: number]>(
    'git/loadSecondaryRoot',
  );
export const loadSecondaryRootCommitFiles = createAction<
  [wsId: string, gitRootId: string, commitHash: string]
>('git/loadSecondaryRootCommitFiles');
export const setSecondaryRootGitLoading = createAction<[wsId: string, gitRootId: string]>(
  'git/setSecondaryRootLoading',
);
export const setSecondaryRootGit = createAction(
  'git/setSecondaryRoot',
  (wsId: string, gitRootId: string, data: SecondaryRootGitData) => ({ wsId, gitRootId, data }),
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

export const acceptChangesConsumerMounted = createAction<[wsId: string]>(
  'git/acceptChangesConsumerMounted',
);
export const acceptChangesConsumerUnmounted = createAction<[wsId: string]>(
  'git/acceptChangesConsumerUnmounted',
);
export const acceptChangesStatusInvalidated = createAction<[wsId: string]>(
  'git/acceptChangesStatusInvalidated',
);
export const setAcceptChangesStatus = createAction<[wsId: string, status: WorkspaceGitStatus]>(
  'git/setAcceptChangesStatus',
);
export const setAcceptChangesStatusLoading = createAction<[wsId: string, loading: boolean]>(
  'git/setAcceptChangesStatusLoading',
);

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
        commits: current?.commits ?? createCollection('hash'),
        nextToken: current?.nextToken,
        commitFiles: current?.commitFiles ?? createCollection('commitHash'),
        loading: true,
        error: null,
      },
    },
  });
});
gitReducer.with(setSecondaryRootGit, (state, { payload: { wsId, gitRootId, data } }) => {
  const ws = getWorkspaceState(state, wsId);
  const commitFiles = Object.entries(data.commitFiles).map(([commitHash, files]) => ({
    commitHash,
    files: files ? createCollection('path', files) : null,
  }));
  return setWorkspaceState(state, wsId, {
    ...ws,
    secondaryRoots: {
      ...ws.secondaryRoots,
      [gitRootId]: {
        ...data,
        commits: createCollection('hash', data.commits),
        commitFiles: createCollection('commitHash', commitFiles),
        loading: false,
        error: null,
      },
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
        commits: current?.commits ?? createCollection('hash'),
        nextToken: current?.nextToken,
        commitFiles: current?.commitFiles ?? createCollection('commitHash'),
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
        commitFiles: upsertItem(current.commitFiles, {
          commitHash,
          files: createCollection('path', files),
        }),
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
gitReducer.with(setAcceptChangesStatus, (state, { payload: [wsId, acceptChangesStatus] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, { ...ws, acceptChangesStatus });
});
gitReducer.with(setAcceptChangesStatusLoading, (state, { payload: [wsId, loading] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, { ...ws, acceptChangesStatusLoading: loading });
});
gitReducer.with(setGitOperationFlag, (state, { payload: [wsId, flag, value] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...ws,
    gitOperations: { ...ws.gitOperations, [flag]: value },
  });
});
