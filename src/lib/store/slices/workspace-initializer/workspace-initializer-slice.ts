import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import {
  createCollection,
  removeItem,
  upsertItem,
} from "../../utils/collection-utils";
import type {
  CompactWorkspaceInitializerFormState,
  WorkspaceInitializerAgentSettings,
  WorkspaceInitializerHydrationState,
  WorkspaceInitializerRecentRepo,
  WorkspaceInitializerRemoteSetup,
  WorkspaceInitializerRepoSelection,
  WorkspaceInitializerState,
  WorkspaceInitializerOnboardingFormState,
} from "./workspace-initializer-types";

export const DEFAULT_WORKSPACE_INITIALIZER_PARENT_PATH = "~/Developer";
const MAX_RECENT_REPOS = 9;

export const initialState: WorkspaceInitializerState = {
  hydrated: false,
  compactFormState: null,
  onboardingFormState: null,
  lastSelectedRepo: null,
  branchByRepo: {},
  defaultParentPath: DEFAULT_WORKSPACE_INITIALIZER_PARENT_PATH,
  recentRepos: createCollection<WorkspaceInitializerRecentRepo, "path">("path"),
  remoteSetups: createCollection<WorkspaceInitializerRemoteSetup, "id">("id"),
  lastSubmittedAgent: null,
};

export const hydrateWorkspaceInitializer = createAction<[
  state: WorkspaceInitializerHydrationState,
]>("workspaceInitializer/hydrateWorkspaceInitializer");

export const setCompactWorkspaceInitializerFormState = createAction<[
  formState: CompactWorkspaceInitializerFormState | null,
]>("workspaceInitializer/setCompactFormState");

export const setWorkspaceInitializerOnboardingFormState = createAction<[
  formState: WorkspaceInitializerOnboardingFormState | null,
]>("workspaceInitializer/setOnboardingFormState");

export const debounceWorkspaceInitializerOnboardingFormState = createAction<[
  formState: WorkspaceInitializerOnboardingFormState,
]>("workspaceInitializer/debounceOnboardingFormState");

export const cancelWorkspaceInitializerOnboardingFormStateDebounce = createAction(
  "workspaceInitializer/cancelOnboardingFormStateDebounce",
);

export const setWorkspaceInitializerLastSelectedRepo = createAction<[
  repo: WorkspaceInitializerRepoSelection | null,
]>("workspaceInitializer/setLastSelectedRepo");

export const setWorkspaceInitializerBranchForRepo = createAction<[
  repoPath: string,
  branch: string,
]>("workspaceInitializer/setBranchForRepo");

export const setWorkspaceInitializerDefaultParentPath = createAction<[
  path: string,
]>("workspaceInitializer/setDefaultParentPath");

export const setWorkspaceInitializerRecentRepos = createAction<[
  repos: WorkspaceInitializerRecentRepo[],
]>("workspaceInitializer/setRecentRepos");

export const setWorkspaceInitializerRemoteSetups = createAction<[
  setups: WorkspaceInitializerRemoteSetup[],
]>("workspaceInitializer/setRemoteSetups");

export const upsertWorkspaceInitializerRemoteSetup = createAction<[
  setup: WorkspaceInitializerRemoteSetup,
]>("workspaceInitializer/upsertRemoteSetup");

export const removeWorkspaceInitializerRemoteSetup = createAction<[
  id: string,
]>("workspaceInitializer/removeRemoteSetup");

export const setWorkspaceInitializerLastSubmittedAgent = createAction<[
  settings: WorkspaceInitializerAgentSettings | null,
]>("workspaceInitializer/setLastSubmittedAgent");

function recentReposCollection(repos: WorkspaceInitializerRecentRepo[]) {
  return createCollection<WorkspaceInitializerRecentRepo, "path">(
    "path",
    repos.filter((repo) => repo.path).slice(0, MAX_RECENT_REPOS),
  );
}

export const workspaceInitializerReducer = createReducer<WorkspaceInitializerState>(initialState)
  .with(hydrateWorkspaceInitializer, (state, { payload: [hydration] }) => ({
    ...state,
    hydrated: true,
    compactFormState: hydration.compactFormState ?? state.compactFormState,
    onboardingFormState: hydration.onboardingFormState ?? state.onboardingFormState,
    lastSelectedRepo: hydration.lastSelectedRepo ?? state.lastSelectedRepo,
    branchByRepo: hydration.branchByRepo ?? state.branchByRepo,
    defaultParentPath: hydration.defaultParentPath || state.defaultParentPath,
    recentRepos: hydration.recentRepos
      ? recentReposCollection(hydration.recentRepos)
      : state.recentRepos,
    remoteSetups: hydration.remoteSetups
      ? createCollection<WorkspaceInitializerRemoteSetup, "id">("id", hydration.remoteSetups)
      : state.remoteSetups,
    lastSubmittedAgent: hydration.lastSubmittedAgent ?? state.lastSubmittedAgent,
  }))
  .with(setCompactWorkspaceInitializerFormState, (state, { payload: [compactFormState] }) => ({
    ...state,
    compactFormState,
  }))
  .with(setWorkspaceInitializerOnboardingFormState, (state, { payload: [onboardingFormState] }) => ({
    ...state,
    onboardingFormState,
  }))
  .with(setWorkspaceInitializerLastSelectedRepo, (state, { payload: [lastSelectedRepo] }) => ({
    ...state,
    lastSelectedRepo,
  }))
  .with(setWorkspaceInitializerBranchForRepo, (state, { payload: [repoPath, branch] }) => {
    if (!repoPath) return state;
    return {
      ...state,
      branchByRepo: {
        ...state.branchByRepo,
        [repoPath]: branch,
      },
    };
  })
  .with(setWorkspaceInitializerDefaultParentPath, (state, { payload: [defaultParentPath] }) => ({
    ...state,
    defaultParentPath: defaultParentPath || DEFAULT_WORKSPACE_INITIALIZER_PARENT_PATH,
  }))
  .with(setWorkspaceInitializerRecentRepos, (state, { payload: [recentRepos] }) => ({
    ...state,
    recentRepos: recentReposCollection(recentRepos),
  }))
  .with(setWorkspaceInitializerRemoteSetups, (state, { payload: [remoteSetups] }) => ({
    ...state,
    remoteSetups: createCollection<WorkspaceInitializerRemoteSetup, "id">("id", remoteSetups),
  }))
  .with(upsertWorkspaceInitializerRemoteSetup, (state, { payload: [setup] }) => ({
    ...state,
    remoteSetups: upsertItem(state.remoteSetups, setup),
  }))
  .with(removeWorkspaceInitializerRemoteSetup, (state, { payload: [id] }) => ({
    ...state,
    remoteSetups: removeItem(state.remoteSetups, id),
  }))
  .with(setWorkspaceInitializerLastSubmittedAgent, (state, { payload: [lastSubmittedAgent] }) => ({
    ...state,
    lastSubmittedAgent,
  }));