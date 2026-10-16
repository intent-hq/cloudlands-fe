import { hostExecutionConnectionChanged } from '../host-execution/host-execution-slice';
import { createAction, createAsyncAction } from '@themislib/themis/utils/store/create-action';
import { readRepositoryCheckoutDraft } from '../repository-checkout/repository-checkout-draft';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  getItem,
  getItems,
  removeItem,
  upsertItem,
} from '@themislib/themis/utils/collections/collection-utils';
import type {
  CompactWorkspaceInitializerFormState,
  WorkspaceInitializerAgentSettings,
  WorkspaceInitializerHydrationState,
  WorkspaceInitializerDirectoryStatus,
  WorkspaceInitializerDirectoryStatusCheck,
  WorkspaceInitializerDraftAttachment,
  WorkspaceInitializerDraftClear,
  WorkspaceInitializerDraftPayload,
  WorkspaceInitializerDraftRestore,
  WorkspaceInitializerRecentRepo,
  WorkspaceInitializerRecentRepoRefresh,
  WorkspaceInitializerRemoteSetup,
  WorkspaceInitializerPendingGitHubPrefill,
  WorkspaceInitializerRepoSelection,
  WorkspaceInitializerState,
  WorkspaceInitializerOnboardingFormState,
  WorkspaceInitializationConsumer,
  WorkspaceInitializationOutcome,
  WorkspaceInitializationRequest,
  WorkspaceInitializationResult,
} from './workspace-initializer-types';

import { recentRepoKey } from './utils/recent-repo-key';

export const DEFAULT_WORKSPACE_INITIALIZER_PARENT_PATH = '~/Developer';
const MAX_RECENT_REPOS = 9;

export const initialState: WorkspaceInitializerState = {
  gitCheckRequest: 0,
  gitCheck: null,
  hydrated: false,
  compactFormState: null,
  onboardingFormState: null,
  lastSelectedRepo: null,
  branchByRepo: {},
  defaultParentPath: DEFAULT_WORKSPACE_INITIALIZER_PARENT_PATH,
  recentRepos: createCollection<WorkspaceInitializerRecentRepo, 'path'>('path'),
  pendingRecentRepos: null,
  dismissedRecentRepoKeys: {},
  remoteSetups: createCollection<WorkspaceInitializerRemoteSetup, 'id'>('id'),
  lastSubmittedAgent: null,
  pendingGitHubPrefill: null,
  recentRepoRefreshes: createCollection<WorkspaceInitializerRecentRepoRefresh, 'id'>('id'),
  directoryStatusChecks: createCollection<WorkspaceInitializerDirectoryStatusCheck, 'id'>('id'),
  initializationOutcomes: createCollection<WorkspaceInitializationOutcome, 'id'>('id'),
  draftRestores: createCollection<WorkspaceInitializerDraftRestore, 'id'>('id'),
  draftClears: createCollection<WorkspaceInitializerDraftClear, 'id'>('id'),
};

export const workspaceInitializerGitCheckRequested = createAction(
  'workspaceInitializer/gitCheckRequested',
);
export const workspaceInitializerGitCheckResolved = createAction<
  [context: string, available: boolean | 'unknown']
>('workspaceInitializer/gitCheckResolved');

export const hydrateWorkspaceInitializer = createAction<
  [state: WorkspaceInitializerHydrationState]
>('workspaceInitializer/hydrateWorkspaceInitializer');

export const setCompactWorkspaceInitializerFormState = createAction<
  [formState: CompactWorkspaceInitializerFormState | null]
>('workspaceInitializer/setCompactFormState');

export const setWorkspaceInitializerOnboardingFormState = createAction<
  [formState: WorkspaceInitializerOnboardingFormState | null]
>('workspaceInitializer/setOnboardingFormState');

export const debounceWorkspaceInitializerOnboardingFormState = createAction<
  [formState: WorkspaceInitializerOnboardingFormState]
>('workspaceInitializer/debounceOnboardingFormState');

export const cancelWorkspaceInitializerOnboardingFormStateDebounce = createAction(
  'workspaceInitializer/cancelOnboardingFormStateDebounce',
);

export const setWorkspaceInitializerLastSelectedRepo = createAction<
  [repo: WorkspaceInitializerRepoSelection | null]
>('workspaceInitializer/setLastSelectedRepo');

export const setWorkspaceInitializerBranchForRepo = createAction<
  [repoPath: string, branch: string]
>('workspaceInitializer/setBranchForRepo');

export const setWorkspaceInitializerDefaultParentPath = createAction<[path: string]>(
  'workspaceInitializer/setDefaultParentPath',
);

export const setWorkspaceInitializerRecentRepos = createAction<
  [repos: WorkspaceInitializerRecentRepo[]]
>('workspaceInitializer/setRecentRepos');

export const dismissWorkspaceInitializerRecentRepo = createAction<
  [repo: Pick<WorkspaceInitializerRecentRepo, 'path' | 'type'>]
>('workspaceInitializer/dismissRecentRepo');

export const workspaceInitializerRecentReposRefreshRequested = createAction<
  [id: string, requestId: string, admission: string, gitlabInstance?: string]
>('workspaceInitializer/recentReposRefreshRequested');
export const workspaceInitializerRecentReposRefreshFinished = createAction<
  [
    id: string,
    requestId: string,
    status: 'ready' | 'failed',
    repos: WorkspaceInitializerRecentRepo[],
    workspaces: WorkspaceInitializerRecentRepoRefresh['workspaces'],
    registryRepos: WorkspaceInitializerRecentRepoRefresh['registryRepos'],
  ]
>('workspaceInitializer/recentReposRefreshFinished');
export const workspaceInitializerRecentReposRefreshReleased = createAction<
  [id: string, requestId: string]
>('workspaceInitializer/recentReposRefreshReleased');

export const workspaceInitializerDirectoryStatusRequested = createAction<
  [id: string, requestId: string, admission: string, path: string]
>('workspaceInitializer/directoryStatusRequested');
export const workspaceInitializerDirectoryStatusFinished = createAction<
  [
    id: string,
    requestId: string,
    status: 'ready' | 'failed' | 'unsupported',
    result: WorkspaceInitializerDirectoryStatus | null,
  ]
>('workspaceInitializer/directoryStatusFinished');
export const workspaceInitializerDirectoryStatusReleased = createAction<
  [id: string, requestId: string]
>('workspaceInitializer/directoryStatusReleased');

export const setWorkspaceInitializerRemoteSetups = createAction<
  [setups: WorkspaceInitializerRemoteSetup[]]
>('workspaceInitializer/setRemoteSetups');

export const upsertWorkspaceInitializerRemoteSetup = createAction<
  [setup: WorkspaceInitializerRemoteSetup]
>('workspaceInitializer/upsertRemoteSetup');

export const removeWorkspaceInitializerRemoteSetup = createAction<[id: string]>(
  'workspaceInitializer/removeRemoteSetup',
);

export const setWorkspaceInitializerLastSubmittedAgent = createAction<
  [settings: WorkspaceInitializerAgentSettings | null]
>('workspaceInitializer/setLastSubmittedAgent');

export const setWorkspaceInitializerPendingGitHubPrefill = createAction<
  [prefill: WorkspaceInitializerPendingGitHubPrefill]
>('workspaceInitializer/setPendingGitHubPrefill');

export const clearWorkspaceInitializerPendingGitHubPrefill = createAction(
  'workspaceInitializer/clearPendingGitHubPrefill',
);

export const workspaceInitializerDraftRestoreRequested = createAction<
  [id: string, requestId: string, legacyKey: string, admission?: string]
>('workspaceInitializer/draftRestoreRequested');
export const workspaceInitializerDraftRestoreFinished = createAction<
  [
    id: string,
    requestId: string,
    status: 'restored' | 'empty' | 'error',
    text: string,
    attachments: WorkspaceInitializerDraftAttachment[],
  ]
>('workspaceInitializer/draftRestoreFinished');
export const workspaceInitializerDraftSaveScheduled = createAction<
  [
    id: string,
    payload: WorkspaceInitializerDraftPayload,
    ownerRequestId?: string,
    admission?: string,
  ]
>('workspaceInitializer/draftSaveScheduled');
export const workspaceInitializerDraftLegacyMigrationRequested = createAction<
  [
    id: string,
    requestId: string,
    admission: string | undefined,
    restoreEpoch: number,
    payload: WorkspaceInitializerDraftPayload,
  ]
>('workspaceInitializer/draftLegacyMigrationRequested');
export const workspaceInitializerDraftSaveDebounceElapsed = createAction<
  [id: string, version: number]
>('workspaceInitializer/draftSaveDebounceElapsed');
export const workspaceInitializerDraftFlushRequested = createAction<
  [id: string, ownerRequestId?: string, admission?: string]
>('workspaceInitializer/draftFlushRequested');
export const workspaceInitializerDraftSaveCancelled = createAction<
  [id: string, ownerRequestId?: string, admission?: string]
>('workspaceInitializer/draftSaveCancelled');
export const workspaceInitializerDraftClearRequested = createAction<
  [id: string, requestId: string, ownerRequestId?: string, admission?: string]
>('workspaceInitializer/draftClearRequested');
export const workspaceInitializerDraftClearFinished = createAction<
  [id: string, requestId: string, status: 'success' | 'failure']
>('workspaceInitializer/draftClearFinished');
export const workspaceInitializerDraftOwnerReleased = createAction<
  [id: string, restoreRequestId: string]
>('workspaceInitializer/draftOwnerReleased');

export const workspaceInitializationRequested = createAsyncAction<
  [request: WorkspaceInitializationRequest, consumer: WorkspaceInitializationConsumer],
  {
    request: WorkspaceInitializationRequest;
    consumer: WorkspaceInitializationConsumer;
    progressId: string;
  },
  WorkspaceInitializationResult
>(
  'workspaceInitializer/initializationRequested',
  'workspaceInitializer/initialization',
  (request, consumer) => ({ request, consumer, progressId: crypto.randomUUID() }),
);
export const workspaceInitializationFinished = createAction<
  [outcome: WorkspaceInitializationOutcome]
>('workspaceInitializer/initializationFinished');
export const clearWorkspaceInitializationOutcome = createAction<[id: string, seq?: number]>(
  'workspaceInitializer/clearInitializationOutcome',
);

function recentReposCollection(
  repos: WorkspaceInitializerRecentRepo[],
  dismissed: Record<string, true>,
) {
  return createCollection<WorkspaceInitializerRecentRepo, 'path'>(
    'path',
    repos.filter((repo) => repo.path && !dismissed[recentRepoKey(repo)]).slice(0, MAX_RECENT_REPOS),
  );
}

export const workspaceInitializerReducer = createReducer<WorkspaceInitializerState>(initialState);
workspaceInitializerReducer.with(workspaceInitializerGitCheckRequested, (state) => ({
  ...state,
  gitCheckRequest: state.gitCheckRequest + 1,
  gitCheck: null,
}));
workspaceInitializerReducer.with(
  workspaceInitializerGitCheckResolved,
  (state, { payload: [context, available] }) => ({ ...state, gitCheck: { context, available } }),
);
function compactIntent(form: CompactWorkspaceInitializerFormState | null | undefined) {
  if (!form) return null;
  const repositoryCheckoutDraft = readRepositoryCheckoutDraft(form.repositoryCheckoutDraft);
  return {
    ...form,
    repositoryCheckoutDraft,
    ...(form.repoType === 'gitlab'
      ? {
          repoPath: '',
          branch: '',
          githubUrl: '',
          remoteSetup: null,
          isNewRepo: false,
          isValidPath: false,
          skipIsolation: false,
        }
      : {}),
  };
}
workspaceInitializerReducer.with(hydrateWorkspaceInitializer, (state, { payload: [hydration] }) => {
  const dismissedRecentRepoKeys = {
    ...(hydration.dismissedRecentRepoKeys ?? state.dismissedRecentRepoKeys),
    // A removal made while the initial settings read was pending wins over it.
    ...(!state.hydrated ? state.dismissedRecentRepoKeys : {}),
  };
  return {
    ...state,
    hydrated: true,
    // A form edit made during the read belongs to this session, even if it
    // only changes effort (or explicitly clears it). Keep the paired model.
    compactFormState: compactIntent(state.compactFormState ?? hydration.compactFormState),
    onboardingFormState: hydration.onboardingFormState ?? state.onboardingFormState,
    lastSelectedRepo: hydration.lastSelectedRepo ?? state.lastSelectedRepo,
    branchByRepo: hydration.branchByRepo ?? state.branchByRepo,
    defaultParentPath: hydration.defaultParentPath || state.defaultParentPath,
    dismissedRecentRepoKeys,
    recentRepos: recentReposCollection(
      state.pendingRecentRepos
        ? getItems(state.pendingRecentRepos)
        : (hydration.recentRepos ?? getItems(state.recentRepos)),
      dismissedRecentRepoKeys,
    ),
    pendingRecentRepos: null,
    remoteSetups: hydration.remoteSetups
      ? createCollection<WorkspaceInitializerRemoteSetup, 'id'>('id', hydration.remoteSetups)
      : state.remoteSetups,
    lastSubmittedAgent: hydration.lastSubmittedAgent ?? state.lastSubmittedAgent,
  };
});
workspaceInitializerReducer.with(
  setCompactWorkspaceInitializerFormState,
  (state, { payload: [compactFormState] }) => ({
    ...state,
    compactFormState: compactIntent(compactFormState),
  }),
);
workspaceInitializerReducer.with(
  setWorkspaceInitializerOnboardingFormState,
  (state, { payload: [onboardingFormState] }) => ({
    ...state,
    onboardingFormState,
  }),
);
workspaceInitializerReducer.with(
  setWorkspaceInitializerLastSelectedRepo,
  (state, { payload: [lastSelectedRepo] }) => ({
    ...state,
    lastSelectedRepo,
  }),
);
workspaceInitializerReducer.with(
  setWorkspaceInitializerBranchForRepo,
  (state, { payload: [repoPath, branch] }) => {
    if (!repoPath) return state;
    return {
      ...state,
      branchByRepo: {
        ...state.branchByRepo,
        [repoPath]: branch,
      },
    };
  },
);
workspaceInitializerReducer.with(
  setWorkspaceInitializerDefaultParentPath,
  (state, { payload: [defaultParentPath] }) => ({
    ...state,
    defaultParentPath: defaultParentPath || DEFAULT_WORKSPACE_INITIALIZER_PARENT_PATH,
  }),
);
workspaceInitializerReducer.with(
  setWorkspaceInitializerRecentRepos,
  (state, { payload: [recentRepos] }) => ({
    ...state,
    recentRepos: recentReposCollection(recentRepos, state.dismissedRecentRepoKeys),
    // Keep every source candidate until persisted dismissals are known. Retaining
    // only the visible nine would prevent refilling rows excluded by late settings.
    pendingRecentRepos: state.hydrated
      ? null
      : createCollection<WorkspaceInitializerRecentRepo, 'path'>(
          'path',
          recentRepos.filter((repo) => repo.path),
        ),
  }),
);
workspaceInitializerReducer.with(
  dismissWorkspaceInitializerRecentRepo,
  (state, { payload: [repo] }) => {
    if (!repo.path) return state;
    const dismissedRecentRepoKeys = {
      ...state.dismissedRecentRepoKeys,
      [recentRepoKey(repo)]: true as const,
    };
    return {
      ...state,
      dismissedRecentRepoKeys,
      recentRepos: recentReposCollection(getItems(state.recentRepos), dismissedRecentRepoKeys),
    };
  },
);
workspaceInitializerReducer.with(
  workspaceInitializerRecentReposRefreshRequested,
  (state, { payload: [id, requestId, admission] }) => {
    const previous = getItem(state.recentRepoRefreshes, id);
    const retained = previous?.admission === admission ? previous : undefined;
    return {
      ...state,
      recentRepoRefreshes: upsertItem(state.recentRepoRefreshes, {
        id,
        requestId,
        admission,
        status: 'pending',
        repos: retained?.repos ?? [],
        workspaces: retained?.workspaces ?? [],
        registryRepos: retained?.registryRepos ?? [],
      }),
    };
  },
);
workspaceInitializerReducer.with(
  workspaceInitializerRecentReposRefreshFinished,
  (state, { payload: [id, requestId, status, repos, workspaces, registryRepos] }) => {
    const current = getItem(state.recentRepoRefreshes, id);
    if (!current || current.requestId !== requestId) return state;
    return {
      ...state,
      recentRepoRefreshes: upsertItem(state.recentRepoRefreshes, {
        ...current,
        status,
        repos,
        workspaces,
        registryRepos,
      }),
    };
  },
);
workspaceInitializerReducer.with(
  workspaceInitializerRecentReposRefreshReleased,
  (state, { payload: [id, requestId] }) =>
    getItem(state.recentRepoRefreshes, id)?.requestId === requestId
      ? { ...state, recentRepoRefreshes: removeItem(state.recentRepoRefreshes, id) }
      : state,
);
workspaceInitializerReducer.with(
  workspaceInitializerDirectoryStatusRequested,
  (state, { payload: [id, requestId, admission, path] }) => ({
    ...state,
    directoryStatusChecks: upsertItem(state.directoryStatusChecks, {
      id,
      requestId,
      admission,
      path,
      status: 'pending',
      result: null,
    }),
  }),
);
workspaceInitializerReducer.with(
  workspaceInitializerDirectoryStatusFinished,
  (state, { payload: [id, requestId, status, result] }) => {
    const current = getItem(state.directoryStatusChecks, id);
    if (!current || current.requestId !== requestId) return state;
    return {
      ...state,
      directoryStatusChecks: upsertItem(state.directoryStatusChecks, {
        ...current,
        status,
        result,
      }),
    };
  },
);
workspaceInitializerReducer.with(
  workspaceInitializerDirectoryStatusReleased,
  (state, { payload: [id, requestId] }) =>
    getItem(state.directoryStatusChecks, id)?.requestId === requestId
      ? { ...state, directoryStatusChecks: removeItem(state.directoryStatusChecks, id) }
      : state,
);
workspaceInitializerReducer.with(
  setWorkspaceInitializerRemoteSetups,
  (state, { payload: [remoteSetups] }) => ({
    ...state,
    remoteSetups: createCollection<WorkspaceInitializerRemoteSetup, 'id'>('id', remoteSetups),
  }),
);
workspaceInitializerReducer.with(
  upsertWorkspaceInitializerRemoteSetup,
  (state, { payload: [setup] }) => ({
    ...state,
    remoteSetups: upsertItem(state.remoteSetups, setup),
  }),
);
workspaceInitializerReducer.with(
  removeWorkspaceInitializerRemoteSetup,
  (state, { payload: [id] }) => ({
    ...state,
    remoteSetups: removeItem(state.remoteSetups, id),
  }),
);
workspaceInitializerReducer.with(
  setWorkspaceInitializerLastSubmittedAgent,
  (state, { payload: [lastSubmittedAgent] }) => ({
    ...state,
    lastSubmittedAgent,
  }),
);
workspaceInitializerReducer.with(
  setWorkspaceInitializerPendingGitHubPrefill,
  (state, { payload: [pendingGitHubPrefill] }) => ({
    ...state,
    pendingGitHubPrefill,
  }),
);
workspaceInitializerReducer.with(clearWorkspaceInitializerPendingGitHubPrefill, (state) => ({
  ...state,
  pendingGitHubPrefill: null,
}));
workspaceInitializerReducer.with(
  workspaceInitializerDraftRestoreRequested,
  (state, { payload: [id, requestId] }) => ({
    ...state,
    draftRestores: upsertItem(state.draftRestores, {
      id,
      requestId,
      status: 'pending',
      text: '',
      attachments: [],
    }),
  }),
);
workspaceInitializerReducer.with(
  workspaceInitializerDraftRestoreFinished,
  (state, { payload: [id, requestId, status, text, attachments] }) => {
    const current = getItem(state.draftRestores, id);
    if (!current || current.requestId !== requestId) return state;
    return {
      ...state,
      draftRestores: upsertItem(state.draftRestores, {
        id,
        requestId,
        status,
        text,
        attachments,
      }),
    };
  },
);
workspaceInitializerReducer.with(
  workspaceInitializerDraftClearRequested,
  (state, { payload: [id, requestId] }) => ({
    ...state,
    draftClears: upsertItem(state.draftClears, { id, requestId, status: 'pending' }),
  }),
);
workspaceInitializerReducer.with(
  workspaceInitializerDraftClearFinished,
  (state, { payload: [id, requestId, status] }) => {
    const current = getItem(state.draftClears, id);
    if (!current || current.requestId !== requestId) return state;
    return {
      ...state,
      draftClears: upsertItem(state.draftClears, { id, requestId, status }),
    };
  },
);
workspaceInitializerReducer.with(
  workspaceInitializerDraftOwnerReleased,
  (state, { payload: [id, restoreRequestId] }) => ({
    ...state,
    draftRestores:
      getItem(state.draftRestores, id)?.requestId === restoreRequestId
        ? removeItem(state.draftRestores, id)
        : state.draftRestores,
    draftClears: removeItem(state.draftClears, id),
  }),
);
workspaceInitializerReducer.with(workspaceInitializationRequested, (state, action) => {
  const request = action as ReturnType<typeof workspaceInitializationRequested>;
  const { consumer, request: input } = action.payload;
  return {
    ...state,
    initializationOutcomes: upsertItem(state.initializationOutcomes, {
      ...consumer,
      seq: request.seq,
      entrypoint: input.entrypoint,
      status: 'pending',
    }),
  };
});
workspaceInitializerReducer.with(
  workspaceInitializationFinished,
  (state, { payload: [outcome] }) => {
    const current = getItem(state.initializationOutcomes, outcome.id);
    if (
      !current ||
      current.status !== 'pending' ||
      current.seq !== outcome.seq ||
      current.resourceId !== outcome.resourceId ||
      current.entrypoint !== outcome.entrypoint
    )
      return state;
    return { ...state, initializationOutcomes: upsertItem(state.initializationOutcomes, outcome) };
  },
);
workspaceInitializerReducer.with(
  clearWorkspaceInitializationOutcome,
  (state, { payload: [id, seq] }) => {
    const current = getItem(state.initializationOutcomes, id);
    if (!current || (seq !== undefined && current.seq !== seq)) return state;
    return { ...state, initializationOutcomes: removeItem(state.initializationOutcomes, id) };
  },
);

workspaceInitializerReducer.with(hostExecutionConnectionChanged, (state) => ({
  ...initialState,
  gitCheckRequest: state.gitCheckRequest ? state.gitCheckRequest + 1 : 0,
  initializationOutcomes: getItems(state.initializationOutcomes).reduce(
    (outcomes, outcome) =>
      upsertItem(
        outcomes,
        outcome.status === 'pending'
          ? { ...outcome, status: 'cancelled', error: 'initialization-cancelled' }
          : outcome,
      ),
    initialState.initializationOutcomes,
  ),
}));
