import { store } from "../../store";
import { getItems } from "ag-redux-toolkit/utils/collections/collection-utils";

export const selectWorkspaceInitializerState = store.createSelector(
  (state) => state.workspaceInitializer,
);

export const selectWorkspaceInitializerHydrated = store.createSelector(
  (state) => state.workspaceInitializer.hydrated,
);

export const selectCompactWorkspaceInitializerFormState = store.createSelector(
  (state) => state.workspaceInitializer.compactFormState,
);

export const selectWorkspaceInitializerOnboardingFormState = store.createSelector(
  (state) => state.workspaceInitializer.onboardingFormState,
);

export const selectWorkspaceInitializerLastSelectedRepo = store.createSelector(
  (state) => state.workspaceInitializer.lastSelectedRepo,
);

export const selectWorkspaceInitializerBranchByRepo = store.createSelector(
  (state) => state.workspaceInitializer.branchByRepo,
);

export const selectWorkspaceInitializerBranchForRepo = store.createSelector(
  (state, repoPath: string) => state.workspaceInitializer.branchByRepo[repoPath] || "",
);

export const selectWorkspaceInitializerDefaultParentPath = store.createSelector(
  (state) => state.workspaceInitializer.defaultParentPath,
);

export const selectWorkspaceInitializerRecentRepos = store.createSelector(
  (state) => getItems(state.workspaceInitializer.recentRepos),
);

export const selectWorkspaceInitializerRemoteSetups = store.createSelector(
  (state) => getItems(state.workspaceInitializer.remoteSetups),
);

export const selectWorkspaceInitializerLastSubmittedAgent = store.createSelector(
  (state) => state.workspaceInitializer.lastSubmittedAgent,
);