import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  createCollection,
  removeItem,
  upsertItem,
} from '@augmentcode/themis/utils/collections/collection-utils';
import type {
  WorkspaceCreationRecentRepo,
  WorkspaceCreationRemoteSetup,
  WorkspaceCreationRepoSelection,
  WorkspaceCreationSettingsHydrationState,
  WorkspaceCreationSettingsState,
} from './workspace-creation-settings-types';

export const DEFAULT_WORKSPACE_CREATION_PARENT_PATH = '~/Developer';
const MAX_RECENT_REPOS = 9;

export const initialState: WorkspaceCreationSettingsState = {
  hydrated: false,
  lastSelectedRepo: null,
  branchByRepo: {},
  defaultParentPath: DEFAULT_WORKSPACE_CREATION_PARENT_PATH,
  recentRepos: createCollection<WorkspaceCreationRecentRepo, 'path'>('path'),
  remoteSetups: createCollection<WorkspaceCreationRemoteSetup, 'id'>('id'),
};

export const hydrateWorkspaceCreationSettings = createAction<
  [state: WorkspaceCreationSettingsHydrationState]
>('workspaceCreationSettings/hydrate');

export const setWorkspaceCreationLastSelectedRepo = createAction<
  [repo: WorkspaceCreationRepoSelection | null]
>('workspaceCreationSettings/setLastSelectedRepo');

export const setWorkspaceCreationBranchForRepo = createAction<[repoPath: string, branch: string]>(
  'workspaceCreationSettings/setBranchForRepo',
);

export const setWorkspaceCreationDefaultParentPath = createAction<[path: string]>(
  'workspaceCreationSettings/setDefaultParentPath',
);

export const setWorkspaceCreationRecentRepos = createAction<[repos: WorkspaceCreationRecentRepo[]]>(
  'workspaceCreationSettings/setRecentRepos',
);

export const setWorkspaceCreationRemoteSetups = createAction<
  [setups: WorkspaceCreationRemoteSetup[]]
>('workspaceCreationSettings/setRemoteSetups');

export const upsertWorkspaceCreationRemoteSetup = createAction<
  [setup: WorkspaceCreationRemoteSetup]
>('workspaceCreationSettings/upsertRemoteSetup');

export const removeWorkspaceCreationRemoteSetup = createAction<[id: string]>(
  'workspaceCreationSettings/removeRemoteSetup',
);

function recentReposCollection(repos: WorkspaceCreationRecentRepo[]) {
  return createCollection<WorkspaceCreationRecentRepo, 'path'>(
    'path',
    repos.filter((repo) => repo.path).slice(0, MAX_RECENT_REPOS),
  );
}

export const workspaceCreationSettingsReducer =
  createReducer<WorkspaceCreationSettingsState>(initialState);
workspaceCreationSettingsReducer.with(
  hydrateWorkspaceCreationSettings,
  (state, { payload: [hydration] }) => ({
    ...state,
    hydrated: true,
    lastSelectedRepo: hydration.lastSelectedRepo ?? state.lastSelectedRepo,
    branchByRepo: hydration.branchByRepo ?? state.branchByRepo,
    defaultParentPath: hydration.defaultParentPath || state.defaultParentPath,
    recentRepos: hydration.recentRepos
      ? recentReposCollection(hydration.recentRepos)
      : state.recentRepos,
    remoteSetups: hydration.remoteSetups
      ? createCollection<WorkspaceCreationRemoteSetup, 'id'>('id', hydration.remoteSetups)
      : state.remoteSetups,
  }),
);
workspaceCreationSettingsReducer.with(
  setWorkspaceCreationLastSelectedRepo,
  (state, { payload: [lastSelectedRepo] }) => ({
    ...state,
    lastSelectedRepo,
  }),
);
workspaceCreationSettingsReducer.with(
  setWorkspaceCreationBranchForRepo,
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
workspaceCreationSettingsReducer.with(
  setWorkspaceCreationDefaultParentPath,
  (state, { payload: [defaultParentPath] }) => ({
    ...state,
    defaultParentPath: defaultParentPath || DEFAULT_WORKSPACE_CREATION_PARENT_PATH,
  }),
);
workspaceCreationSettingsReducer.with(
  setWorkspaceCreationRecentRepos,
  (state, { payload: [recentRepos] }) => ({
    ...state,
    recentRepos: recentReposCollection(recentRepos),
  }),
);
workspaceCreationSettingsReducer.with(
  setWorkspaceCreationRemoteSetups,
  (state, { payload: [remoteSetups] }) => ({
    ...state,
    remoteSetups: createCollection<WorkspaceCreationRemoteSetup, 'id'>('id', remoteSetups),
  }),
);
workspaceCreationSettingsReducer.with(
  upsertWorkspaceCreationRemoteSetup,
  (state, { payload: [setup] }) => ({
    ...state,
    remoteSetups: upsertItem(state.remoteSetups, setup),
  }),
);
workspaceCreationSettingsReducer.with(
  removeWorkspaceCreationRemoteSetup,
  (state, { payload: [id] }) => ({
    ...state,
    remoteSetups: removeItem(state.remoteSetups, id),
  }),
);
