import { store } from "../../store";
import { getItems } from "$lib/store-shim/utils/collections/collection-utils";

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