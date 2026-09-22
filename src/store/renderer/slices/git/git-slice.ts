/**
 * Git Slice
 *
 * Actions and reducer for workspace-scoped git state.
 * Replaces the deprecated git.store.svelte.ts.
 */

import { createAction, createAsyncAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  createCollection,
  getItem,
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
  GitBranchStatusData,
  GitBranchesData,
  GitCommitDetails,
  GitRepoReadState,
  GitEnrichmentRequest,
  GitEnrichmentResult,
} from './git-types';
export type { GitOperationCompletedEvent, GitOperationFailedEvent } from './git-types';
import type { GitStatus } from '$shared/types';
import type { CommitFile } from '$features/file-tracking/types';
import type { GitDiffsOptions, MutationResult } from '$lib/client';
import type { DiffChunk } from '$shared/types';
import type {
  AcceptAction,
  AcceptChangesExecuteOptions,
  AcceptChangesResult,
  PrepareAcceptResponse,
  WorkspaceGitStatus,
} from '$features/accept-changes/types';
import {
  commitDetailsKey,
  gitDiffReadKey,
  gitFileReadKey,
  gitMutationKey,
} from './utils/git-read-keys';

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
  statusReadOperation: {
    requestId: null,
    status: 'idle',
    result: null,
    error: null,
  },
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
  commitDetails: createCollection('key'),
  diffReads: createCollection('key'),
  fileReads: createCollection('key'),
  mutationRequests: createCollection('key'),
  enrichmentReads: createCollection('key'),
};

const emptyRepoReadState: GitRepoReadState = {
  branches: null,
  branchesLoading: false,
  branchesError: null,
  branchStatuses: {},
  branchStatusLoading: {},
  branchStatusErrors: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceState);

export { getWorkspaceState as getGitWorkspaceState };

export const initialState: GitState = {
  byWorkspaceId: {},
  byRepoPath: {},
  lastGitOperation: null,
  lastGitError: null,
  lastAutoCommitHookFailure: null,
};

// ── Actions ──

/** Trigger saga to load git status for a workspace */
export const loadGitStatus = createAction<[wsId: string, forceRefresh?: boolean]>('git/loadStatus');
export const readGitStatusRequested = createAction<
  [wsId: string, forceRefresh?: boolean, requestId?: string],
  [wsId: string, forceRefresh: boolean | undefined, requestId: string]
>('git/readStatusRequested', (wsId, forceRefresh, requestId = globalThis.crypto.randomUUID()) => [
  wsId,
  forceRefresh,
  requestId,
]);
export const setGitStatusReadResult =
  createAction<[wsId: string, requestId: string, result: GitStatus | null]>(
    'git/setStatusReadResult',
  );
export const setGitStatusReadError =
  createAction<[wsId: string, requestId: string, error: string]>('git/setStatusReadError');

/** Set git status result */
export const setGitStatus = createAction('git/setStatus', (wsId: string, status: GitStatus) => ({
  wsId,
  status,
}));

export const loadCommitDetails =
  createAction<[wsId: string, commitHash: string, gitRootId?: string]>('git/loadCommitDetails');
export const readCommitDetailsRequested = createAsyncAction<
  [wsId: string, commitHash: string, gitRootId?: string],
  GitCommitDetails
>('git/readCommitDetails', 'git/readCommitDetailsRequested');
export const setCommitDetailsLoading = createAction<
  [wsId: string, commitHash: string, gitRootId?: string]
>('git/setCommitDetailsLoading');
export const setCommitDetails =
  createAction<[wsId: string, commitHash: string, data: GitCommitDetails, gitRootId?: string]>(
    'git/setCommitDetails',
  );
export const setCommitDetailsError = createAction<
  [wsId: string, commitHash: string, error: string, gitRootId?: string]
>('git/setCommitDetailsError');

export const loadGitDiffs =
  createAction<[wsId: string, options?: GitDiffsOptions]>('git/loadDiffs');
export const readGitDiffsRequested = createAsyncAction<
  [wsId: string, options?: GitDiffsOptions],
  DiffChunk[]
>('git/readDiffs', 'git/readDiffsRequested');
export const setGitDiffsLoading =
  createAction<[wsId: string, options?: GitDiffsOptions]>('git/setDiffsLoading');
export const setGitDiffs =
  createAction<[wsId: string, options: GitDiffsOptions | undefined, data: DiffChunk[]]>(
    'git/setDiffs',
  );
export const setGitDiffsError =
  createAction<[wsId: string, options: GitDiffsOptions | undefined, error: string]>(
    'git/setDiffsError',
  );

export const loadGitEnrichment =
  createAction<[wsId: string, key: string, requestId: string, request: GitEnrichmentRequest]>(
    'git/loadEnrichment',
  );
export const setGitEnrichment =
  createAction<[wsId: string, key: string, requestId: string, data: GitEnrichmentResult]>(
    'git/setEnrichment',
  );
export const setGitEnrichmentError =
  createAction<[wsId: string, key: string, requestId: string, error: string]>(
    'git/setEnrichmentError',
  );

export const readGitBranchesRequested = createAsyncAction<
  [repoPath: string, includeRemote: boolean],
  GitBranchesData
>('git/readBranches', 'git/readBranchesRequested');
export const loadGitBranches =
  createAction<
    [
      repoPath: string,
      includeRemote: boolean,
      forceRefresh?: boolean,
      cacheEnabled?: boolean,
      networkDelayMs?: number,
    ]
  >('git/loadBranches');
export const setGitBranches =
  createAction<[repoPath: string, data: GitBranchesData]>('git/setBranches');
export const setGitBranchesError =
  createAction<[repoPath: string, error: string]>('git/setBranchesError');
export const readGitBranchStatusRequested = createAsyncAction<
  [repoPath: string, branchName: string],
  GitBranchStatusData
>('git/readBranchStatus', 'git/readBranchStatusRequested');
export const setGitBranchStatus =
  createAction<[repoPath: string, branchName: string, data: GitBranchStatusData]>(
    'git/setBranchStatus',
  );
export const setGitBranchStatusError = createAction<
  [repoPath: string, branchName: string, error: string]
>('git/setBranchStatusError');

const setGitFileReadLoading =
  createAction<[wsId: string, path: string, ref: string, gitRootId?: string]>(
    'git/setFileReadLoading',
  );
const setGitFileRead =
  createAction<[wsId: string, path: string, ref: string, data: string, gitRootId?: string]>(
    'git/setFileRead',
  );
const setGitFileReadError =
  createAction<[wsId: string, path: string, ref: string, error: string, gitRootId?: string]>(
    'git/setFileReadError',
  );

const setGitMutationLoading =
  createAction<[wsId: string, operation: string, scope?: string]>('git/setMutationLoading');
const setGitMutationResult =
  createAction<
    [
      wsId: string,
      operation: string,
      scope: string,
      data: MutationResult | AcceptChangesResult | PrepareAcceptResponse | WorkspaceGitStatus,
    ]
  >('git/setMutationResult');
const setGitMutationError =
  createAction<[wsId: string, operation: string, scope: string, error: string]>(
    'git/setMutationError',
  );

export const readGitFileRequested = createAsyncAction<
  [wsId: string, path: string, ref: string, gitRootId?: string],
  string
>('git/readFile', 'git/readFileRequested');
export const stageGitHunkRequested = createAsyncAction<
  [wsId: string, path: string, patch: string],
  MutationResult
>('git/stageHunk', 'git/stageHunkRequested');
export const unstageGitHunkRequested = createAsyncAction<
  [wsId: string, path: string, patch: string],
  MutationResult
>('git/unstageHunk', 'git/unstageHunkRequested');
export const fetchGitRequested = createAsyncAction<[wsId: string], MutationResult>(
  'git/fetch',
  'git/fetchRequested',
);
export const pushGitRequested = createAsyncAction<
  [wsId: string, branch?: string, force?: boolean],
  MutationResult
>('git/push', 'git/pushRequested');
export const pullGitRequested = createAsyncAction<
  [wsId: string, repoPath: string, branchName: string],
  MutationResult
>('git/pull', 'git/pullRequested');
export const executeAcceptChangesRequested = createAsyncAction<
  [wsId: string, action: AcceptAction, options?: AcceptChangesExecuteOptions],
  AcceptChangesResult
>('git/executeAcceptChanges', 'git/executeAcceptChangesRequested');
export const readAcceptChangesStatusRequested = createAsyncAction<
  [wsId: string, forceRefresh?: boolean],
  WorkspaceGitStatus
>('git/readAcceptChangesStatus', 'git/readAcceptChangesStatusRequested');
export const prepareAcceptChangesRequested = createAsyncAction<
  [wsId: string, action: AcceptAction, files?: string[]],
  PrepareAcceptResponse
>('git/prepareAcceptChanges', 'git/prepareAcceptChangesRequested');
export const mergePullRequestRequested = createAsyncAction<
  [wsId: string, prNumber: number, mergeMethod: 'merge' | 'squash' | 'rebase'],
  AcceptChangesResult
>('git/mergePullRequest', 'git/mergePullRequestRequested');
export const createPullRequestRequested = createAsyncAction<
  [
    wsId: string,
    prTitle: string,
    prDescription: string,
    targetBranch?: string,
    hasStaged?: boolean,
  ],
  AcceptChangesResult
>('git/createPullRequest', 'git/createPullRequestRequested');
export const addGitRemoteRequested = createAsyncAction<
  [wsId: string, remoteUrl: string],
  WorkspaceGitStatus
>('git/addRemote', 'git/addRemoteRequested');
export const amendCommitMessageRequested = createAsyncAction<
  [wsId: string, repoPath: string, message: string, wasPushed: boolean],
  MutationResult
>('git/amendCommitMessage', 'git/amendCommitMessageRequested');
export const refreshPullRequestRequested = createAsyncAction<[wsId: string], MutationResult>(
  'git/refreshPullRequest',
  'git/refreshPullRequestRequested',
);

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
gitReducer.with(readGitStatusRequested, (state, { payload: [wsId, , requestId] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...ws,
    statusReadOperation: {
      requestId,
      status: 'loading',
      result: null,
      error: null,
    },
  });
});
gitReducer.with(setGitStatusReadResult, (state, { payload: [wsId, requestId, result] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (ws.statusReadOperation.requestId !== requestId) return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    ...(result
      ? {
          status: result,
          loading: false,
          error: null,
          branch: result.branch || null,
          ahead: result.ahead || 0,
          behind: result.behind || 0,
        }
      : {}),
    statusReadOperation: {
      requestId,
      status: 'success',
      result,
      error: null,
    },
  });
});
gitReducer.with(setGitStatusReadError, (state, { payload: [wsId, requestId, error] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (ws.statusReadOperation.requestId !== requestId) return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    statusReadOperation: {
      requestId,
      status: 'error',
      result: null,
      error,
    },
  });
});
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
gitReducer.with(setCommitDetailsLoading, (state, { payload: [wsId, commitHash, gitRootId] }) => {
  const ws = getWorkspaceState(state, wsId);
  const key = commitDetailsKey(commitHash, gitRootId);
  const current = getItem(ws.commitDetails, key);
  return setWorkspaceState(state, wsId, {
    ...ws,
    commitDetails: upsertItem(ws.commitDetails, {
      key,
      commitHash,
      ...(gitRootId ? { gitRootId } : {}),
      data: current?.data ?? null,
      loading: true,
      error: null,
    }),
  });
});
gitReducer.with(setCommitDetails, (state, { payload: [wsId, commitHash, data, gitRootId] }) => {
  const ws = getWorkspaceState(state, wsId);
  const key = commitDetailsKey(commitHash, gitRootId);
  return setWorkspaceState(state, wsId, {
    ...ws,
    commitDetails: upsertItem(ws.commitDetails, {
      key,
      commitHash,
      ...(gitRootId ? { gitRootId } : {}),
      data,
      loading: false,
      error: null,
    }),
  });
});
gitReducer.with(
  setCommitDetailsError,
  (state, { payload: [wsId, commitHash, error, gitRootId] }) => {
    const ws = getWorkspaceState(state, wsId);
    const key = commitDetailsKey(commitHash, gitRootId);
    const current = getItem(ws.commitDetails, key);
    return setWorkspaceState(state, wsId, {
      ...ws,
      commitDetails: upsertItem(ws.commitDetails, {
        key,
        commitHash,
        ...(gitRootId ? { gitRootId } : {}),
        data: current?.data ?? null,
        loading: false,
        error,
      }),
    });
  },
);
const reduceGitDiffsLoading = (
  state: GitState,
  { payload: [wsId, options] }: ReturnType<typeof loadGitDiffs>,
) => {
  const ws = getWorkspaceState(state, wsId);
  const key = gitDiffReadKey(options);
  const current = getItem(ws.diffReads, key);
  return setWorkspaceState(state, wsId, {
    ...ws,
    diffReads: upsertItem(ws.diffReads, {
      key,
      ...options,
      data: current?.data ?? [],
      loading: true,
      error: null,
    }),
  });
};
gitReducer.with(loadGitDiffs, reduceGitDiffsLoading);
gitReducer.with(setGitDiffsLoading, reduceGitDiffsLoading);
gitReducer.with(setGitDiffs, (state, { payload: [wsId, options, data] }) => {
  const ws = getWorkspaceState(state, wsId);
  const key = gitDiffReadKey(options);
  return setWorkspaceState(state, wsId, {
    ...ws,
    diffReads: upsertItem(ws.diffReads, { key, ...options, data, loading: false, error: null }),
  });
});
gitReducer.with(setGitDiffsError, (state, { payload: [wsId, options, error] }) => {
  const ws = getWorkspaceState(state, wsId);
  const key = gitDiffReadKey(options);
  const current = getItem(ws.diffReads, key);
  return setWorkspaceState(state, wsId, {
    ...ws,
    diffReads: upsertItem(ws.diffReads, {
      key,
      ...options,
      data: current?.data ?? [],
      loading: false,
      error,
    }),
  });
});
gitReducer.with(loadGitEnrichment, (state, { payload: [wsId, key, requestId] }) => {
  const ws = getWorkspaceState(state, wsId);
  const current = getItem(ws.enrichmentReads, key);
  return setWorkspaceState(state, wsId, {
    ...ws,
    enrichmentReads: upsertItem(ws.enrichmentReads, {
      key,
      requestId,
      data: current?.data ?? null,
      loading: true,
      error: null,
    }),
  });
});
gitReducer.with(setGitEnrichment, (state, { payload: [wsId, key, requestId, data] }) => {
  const ws = getWorkspaceState(state, wsId);
  const current = getItem(ws.enrichmentReads, key);
  if (current?.requestId !== requestId) return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    enrichmentReads: upsertItem(ws.enrichmentReads, {
      key,
      requestId,
      data,
      loading: false,
      error: null,
    }),
  });
});
gitReducer.with(setGitEnrichmentError, (state, { payload: [wsId, key, requestId, error] }) => {
  const ws = getWorkspaceState(state, wsId);
  const current = getItem(ws.enrichmentReads, key);
  if (current?.requestId !== requestId) return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    enrichmentReads: upsertItem(ws.enrichmentReads, {
      key,
      requestId,
      data: current.data,
      loading: false,
      error,
    }),
  });
});
gitReducer.with(readGitBranchesRequested, (state, { payload: [repoPath] }) => ({
  ...state,
  byRepoPath: {
    ...state.byRepoPath,
    [repoPath]: {
      ...(state.byRepoPath[repoPath] ?? emptyRepoReadState),
      branchesLoading: true,
      branchesError: null,
    },
  },
}));
gitReducer.with(loadGitBranches, (state, { payload: [repoPath] }) => ({
  ...state,
  byRepoPath: {
    ...state.byRepoPath,
    [repoPath]: {
      ...(state.byRepoPath[repoPath] ?? emptyRepoReadState),
      branchesLoading: true,
      branchesError: null,
    },
  },
}));
gitReducer.with(setGitBranches, (state, { payload: [repoPath, branches] }) => ({
  ...state,
  byRepoPath: {
    ...state.byRepoPath,
    [repoPath]: {
      ...(state.byRepoPath[repoPath] ?? emptyRepoReadState),
      branches,
      branchesLoading: false,
      branchesError: null,
    },
  },
}));
gitReducer.with(setGitBranchesError, (state, { payload: [repoPath, error] }) => ({
  ...state,
  byRepoPath: {
    ...state.byRepoPath,
    [repoPath]: {
      ...(state.byRepoPath[repoPath] ?? emptyRepoReadState),
      branchesLoading: false,
      branchesError: error,
    },
  },
}));
gitReducer.with(readGitBranchStatusRequested, (state, { payload: [repoPath, branchName] }) => {
  const repo = state.byRepoPath[repoPath] ?? emptyRepoReadState;
  return {
    ...state,
    byRepoPath: {
      ...state.byRepoPath,
      [repoPath]: {
        ...repo,
        branchStatusLoading: { ...repo.branchStatusLoading, [branchName]: true },
        branchStatusErrors: { ...repo.branchStatusErrors, [branchName]: null },
      },
    },
  };
});
gitReducer.with(setGitBranchStatus, (state, { payload: [repoPath, branchName, data] }) => {
  const repo = state.byRepoPath[repoPath] ?? emptyRepoReadState;
  return {
    ...state,
    byRepoPath: {
      ...state.byRepoPath,
      [repoPath]: {
        ...repo,
        branchStatuses: { ...repo.branchStatuses, [branchName]: data },
        branchStatusLoading: { ...repo.branchStatusLoading, [branchName]: false },
        branchStatusErrors: { ...repo.branchStatusErrors, [branchName]: null },
      },
    },
  };
});
gitReducer.with(setGitBranchStatusError, (state, { payload: [repoPath, branchName, error] }) => {
  const repo = state.byRepoPath[repoPath] ?? emptyRepoReadState;
  return {
    ...state,
    byRepoPath: {
      ...state.byRepoPath,
      [repoPath]: {
        ...repo,
        branchStatusLoading: { ...repo.branchStatusLoading, [branchName]: false },
        branchStatusErrors: { ...repo.branchStatusErrors, [branchName]: error },
      },
    },
  };
});
gitReducer.with(setGitFileReadLoading, (state, { payload: [wsId, path, ref, gitRootId] }) => {
  const ws = getWorkspaceState(state, wsId);
  const key = gitFileReadKey(path, ref, gitRootId);
  const current = getItem(ws.fileReads, key);
  return setWorkspaceState(state, wsId, {
    ...ws,
    fileReads: upsertItem(ws.fileReads, {
      key,
      path,
      ref,
      ...(gitRootId ? { gitRootId } : {}),
      data: current?.data ?? null,
      loading: true,
      error: null,
    }),
  });
});
gitReducer.with(setGitFileRead, (state, { payload: [wsId, path, ref, data, gitRootId] }) => {
  const ws = getWorkspaceState(state, wsId);
  const key = gitFileReadKey(path, ref, gitRootId);
  return setWorkspaceState(state, wsId, {
    ...ws,
    fileReads: upsertItem(ws.fileReads, {
      key,
      path,
      ref,
      ...(gitRootId ? { gitRootId } : {}),
      data,
      loading: false,
      error: null,
    }),
  });
});
gitReducer.with(setGitFileReadError, (state, { payload: [wsId, path, ref, error, gitRootId] }) => {
  const ws = getWorkspaceState(state, wsId);
  const key = gitFileReadKey(path, ref, gitRootId);
  const current = getItem(ws.fileReads, key);
  return setWorkspaceState(state, wsId, {
    ...ws,
    fileReads: upsertItem(ws.fileReads, {
      key,
      path,
      ref,
      ...(gitRootId ? { gitRootId } : {}),
      data: current?.data ?? null,
      loading: false,
      error,
    }),
  });
});
gitReducer.with(setGitMutationLoading, (state, { payload: [wsId, operation, scope = ''] }) => {
  const ws = getWorkspaceState(state, wsId);
  const key = gitMutationKey(operation, scope);
  const current = getItem(ws.mutationRequests, key);
  return setWorkspaceState(state, wsId, {
    ...ws,
    mutationRequests: upsertItem(ws.mutationRequests, {
      key,
      operation,
      scope,
      data: current?.data ?? null,
      loading: true,
      error: null,
      version: (current?.version ?? 0) + 1,
    }),
  });
});
gitReducer.with(setGitMutationResult, (state, { payload: [wsId, operation, scope, data] }) => {
  const ws = getWorkspaceState(state, wsId);
  const key = gitMutationKey(operation, scope);
  const current = getItem(ws.mutationRequests, key);
  return setWorkspaceState(state, wsId, {
    ...ws,
    mutationRequests: upsertItem(ws.mutationRequests, {
      key,
      operation,
      scope,
      data,
      loading: false,
      error: null,
      version: current?.version ?? 1,
    }),
  });
});
gitReducer.with(setGitMutationError, (state, { payload: [wsId, operation, scope, error] }) => {
  const ws = getWorkspaceState(state, wsId);
  const key = gitMutationKey(operation, scope);
  const current = getItem(ws.mutationRequests, key);
  return setWorkspaceState(state, wsId, {
    ...ws,
    mutationRequests: upsertItem(ws.mutationRequests, {
      key,
      operation,
      scope,
      data: current?.data ?? null,
      loading: false,
      error,
      version: current?.version ?? 1,
    }),
  });
});

gitReducer.with(readGitFileRequested, (state, { payload: [wsId, path, ref, gitRootId] }) =>
  gitReducer(state, setGitFileReadLoading(wsId, path, ref, gitRootId)),
);
gitReducer.with(
  readGitFileRequested.success,
  (
    state,
    {
      payload: {
        request: [wsId, path, ref, gitRootId],
        response,
      },
    },
  ) => gitReducer(state, setGitFileRead(wsId, path, ref, response, gitRootId)),
);
gitReducer.with(
  readGitFileRequested.failure,
  (
    state,
    {
      payload: {
        request: [wsId, path, ref, gitRootId],
        error,
      },
    },
  ) => gitReducer(state, setGitFileReadError(wsId, path, ref, error.message, gitRootId)),
);

function reduceMutationRequest(state: GitState, wsId: string, operation: string, scope = '') {
  return gitReducer(state, setGitMutationLoading(wsId, operation, scope));
}

function reduceMutationSuccess(
  state: GitState,
  wsId: string,
  operation: string,
  scope: string,
  data: MutationResult | AcceptChangesResult | PrepareAcceptResponse | WorkspaceGitStatus,
) {
  return gitReducer(state, setGitMutationResult(wsId, operation, scope, data));
}

function reduceMutationFailure(
  state: GitState,
  wsId: string,
  operation: string,
  scope: string,
  error: Error,
) {
  return gitReducer(state, setGitMutationError(wsId, operation, scope, error.message));
}

gitReducer.with(executeAcceptChangesRequested, (state, { payload: [wsId, operation] }) =>
  reduceMutationRequest(state, wsId, 'accept-changes', operation),
);
gitReducer.with(readAcceptChangesStatusRequested, (state, { payload: [wsId] }) =>
  reduceMutationRequest(state, wsId, 'accept-status'),
);
gitReducer.with(
  readAcceptChangesStatusRequested.success,
  (
    state,
    {
      payload: {
        request: [wsId],
        response,
      },
    },
  ) => reduceMutationSuccess(state, wsId, 'accept-status', '', response),
);
gitReducer.with(
  readAcceptChangesStatusRequested.failure,
  (
    state,
    {
      payload: {
        request: [wsId],
        error,
      },
    },
  ) => reduceMutationFailure(state, wsId, 'accept-status', '', error),
);
gitReducer.with(prepareAcceptChangesRequested, (state, { payload: [wsId, operation] }) =>
  reduceMutationRequest(state, wsId, 'prepare-accept', operation),
);
gitReducer.with(
  prepareAcceptChangesRequested.success,
  (
    state,
    {
      payload: {
        request: [wsId, operation],
        response,
      },
    },
  ) => reduceMutationSuccess(state, wsId, 'prepare-accept', operation, response),
);
gitReducer.with(
  prepareAcceptChangesRequested.failure,
  (
    state,
    {
      payload: {
        request: [wsId, operation],
        error,
      },
    },
  ) => reduceMutationFailure(state, wsId, 'prepare-accept', operation, error),
);
gitReducer.with(mergePullRequestRequested, (state, { payload: [wsId, prNumber] }) =>
  reduceMutationRequest(state, wsId, 'merge-pr', String(prNumber)),
);
gitReducer.with(
  mergePullRequestRequested.success,
  (
    state,
    {
      payload: {
        request: [wsId, prNumber],
        response,
      },
    },
  ) => reduceMutationSuccess(state, wsId, 'merge-pr', String(prNumber), response),
);
gitReducer.with(
  mergePullRequestRequested.failure,
  (
    state,
    {
      payload: {
        request: [wsId, prNumber],
        error,
      },
    },
  ) => reduceMutationFailure(state, wsId, 'merge-pr', String(prNumber), error),
);
gitReducer.with(
  executeAcceptChangesRequested.success,
  (
    state,
    {
      payload: {
        request: [wsId, operation],
        response,
      },
    },
  ) => reduceMutationSuccess(state, wsId, 'accept-changes', operation, response),
);
gitReducer.with(
  executeAcceptChangesRequested.failure,
  (
    state,
    {
      payload: {
        request: [wsId, operation],
        error,
      },
    },
  ) => reduceMutationFailure(state, wsId, 'accept-changes', operation, error),
);
gitReducer.with(createPullRequestRequested, (state, { payload: [wsId] }) =>
  reduceMutationRequest(state, wsId, 'create-pr'),
);
gitReducer.with(
  createPullRequestRequested.success,
  (
    state,
    {
      payload: {
        request: [wsId],
        response,
      },
    },
  ) => reduceMutationSuccess(state, wsId, 'create-pr', '', response),
);
gitReducer.with(
  createPullRequestRequested.failure,
  (
    state,
    {
      payload: {
        request: [wsId],
        error,
      },
    },
  ) => reduceMutationFailure(state, wsId, 'create-pr', '', error),
);
gitReducer.with(addGitRemoteRequested, (state, { payload: [wsId] }) =>
  reduceMutationRequest(state, wsId, 'add-remote'),
);
gitReducer.with(
  addGitRemoteRequested.success,
  (
    state,
    {
      payload: {
        request: [wsId],
        response,
      },
    },
  ) => reduceMutationSuccess(state, wsId, 'add-remote', '', response),
);
gitReducer.with(
  addGitRemoteRequested.failure,
  (
    state,
    {
      payload: {
        request: [wsId],
        error,
      },
    },
  ) => reduceMutationFailure(state, wsId, 'add-remote', '', error),
);
gitReducer.with(amendCommitMessageRequested, (state, { payload: [wsId] }) =>
  reduceMutationRequest(state, wsId, 'amend-commit'),
);
gitReducer.with(
  amendCommitMessageRequested.success,
  (
    state,
    {
      payload: {
        request: [wsId],
        response,
      },
    },
  ) => reduceMutationSuccess(state, wsId, 'amend-commit', '', response),
);
gitReducer.with(
  amendCommitMessageRequested.failure,
  (
    state,
    {
      payload: {
        request: [wsId],
        error,
      },
    },
  ) => reduceMutationFailure(state, wsId, 'amend-commit', '', error),
);
gitReducer.with(refreshPullRequestRequested, (state, { payload: [wsId] }) =>
  reduceMutationRequest(state, wsId, 'refresh-pr'),
);
gitReducer.with(
  refreshPullRequestRequested.success,
  (
    state,
    {
      payload: {
        request: [wsId],
        response,
      },
    },
  ) => reduceMutationSuccess(state, wsId, 'refresh-pr', '', response),
);
gitReducer.with(
  refreshPullRequestRequested.failure,
  (
    state,
    {
      payload: {
        request: [wsId],
        error,
      },
    },
  ) => reduceMutationFailure(state, wsId, 'refresh-pr', '', error),
);
gitReducer.with(pushGitRequested, (state, { payload: [wsId, , force] }) =>
  reduceMutationRequest(state, wsId, 'push', force ? 'force' : ''),
);
gitReducer.with(
  pushGitRequested.success,
  (
    state,
    {
      payload: {
        request: [wsId, , force],
        response,
      },
    },
  ) => reduceMutationSuccess(state, wsId, 'push', force ? 'force' : '', response),
);
gitReducer.with(
  pushGitRequested.failure,
  (
    state,
    {
      payload: {
        request: [wsId, , force],
        error,
      },
    },
  ) => reduceMutationFailure(state, wsId, 'push', force ? 'force' : '', error),
);
gitReducer.with(pullGitRequested, (state, { payload: [wsId] }) =>
  reduceMutationRequest(state, wsId, 'pull'),
);
gitReducer.with(
  pullGitRequested.success,
  (
    state,
    {
      payload: {
        request: [wsId],
        response,
      },
    },
  ) => reduceMutationSuccess(state, wsId, 'pull', '', response),
);
gitReducer.with(
  pullGitRequested.failure,
  (
    state,
    {
      payload: {
        request: [wsId],
        error,
      },
    },
  ) => reduceMutationFailure(state, wsId, 'pull', '', error),
);
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
