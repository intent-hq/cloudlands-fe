import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  createCollection,
  getItems,
  removeItem,
  upsertItem,
} from '@augmentcode/themis/utils/collections/collection-utils';
import type {
  CompactWorkspaceInitializerFormState,
  WorkspaceInitializerAgentSettings,
  WorkspaceInitializerHydrationState,
  WorkspaceInitializerRecentRepo,
  WorkspaceInitializerRemoteSetup,
  WorkspaceInitializerPendingGitHubPrefill,
  WorkspaceInitializerRepoSelection,
  WorkspaceInitializerState,
  WorkspaceInitializerOnboardingFormState,
} from './workspace-initializer-types';

import { recentRepoKey } from './utils/recent-repo-key';

export const DEFAULT_WORKSPACE_INITIALIZER_PARENT_PATH = '~/Developer';
const MAX_RECENT_REPOS = 9;

export const initialState: WorkspaceInitializerState = {
  hydrated: false,
  compactFormState: null,
  onboardingFormState: null,
  lastSelectedRepo: null,
  branchByRepo: {},
  defaultParentPath: DEFAULT_WORKSPACE_INITIALIZER_PARENT_PATH,
  recentRepos: createCollection<WorkspaceInitializerRecentRepo, 'path'>('path'),
  dismissedRecentRepoKeys: {},
  remoteSetups: createCollection<WorkspaceInitializerRemoteSetup, 'id'>('id'),
  lastSubmittedAgent: null,
  pendingGitHubPrefill: null,
};

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
    compactFormState: state.compactFormState ?? hydration.compactFormState ?? null,
    onboardingFormState: hydration.onboardingFormState ?? state.onboardingFormState,
    lastSelectedRepo: hydration.lastSelectedRepo ?? state.lastSelectedRepo,
    branchByRepo: hydration.branchByRepo ?? state.branchByRepo,
    defaultParentPath: hydration.defaultParentPath || state.defaultParentPath,
    dismissedRecentRepoKeys,
    recentRepos: recentReposCollection(
      hydration.recentRepos ?? getItems(state.recentRepos),
      dismissedRecentRepoKeys,
    ),
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
    compactFormState,
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
