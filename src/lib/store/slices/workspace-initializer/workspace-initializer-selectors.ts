import { createSelector } from "../../utils/create-selector";
import { getItems } from "../../utils/collection-utils";

export const selectWorkspaceInitializerState = createSelector(
  (state) => state.workspaceInitializer,
);

export const selectWorkspaceInitializerHydrated = createSelector(
  (state) => state.workspaceInitializer.hydrated,
);

export const selectCompactWorkspaceInitializerFormState = createSelector(
  (state) => state.workspaceInitializer.compactFormState,
);

export const selectWorkspaceInitializerOnboardingFormState = createSelector(
  (state) => state.workspaceInitializer.onboardingFormState,
);

export const selectWorkspaceInitializerLastSelectedRepo = createSelector(
  (state) => state.workspaceInitializer.lastSelectedRepo,
);

export const selectWorkspaceInitializerBranchByRepo = createSelector(
  (state) => state.workspaceInitializer.branchByRepo,
);

export const selectWorkspaceInitializerBranchForRepo = createSelector(
  (state, repoPath: string) => state.workspaceInitializer.branchByRepo[repoPath] || "",
);

export const selectWorkspaceInitializerDefaultParentPath = createSelector(
  (state) => state.workspaceInitializer.defaultParentPath,
);

export const selectWorkspaceInitializerRecentRepos = createSelector(
  (state) => getItems(state.workspaceInitializer.recentRepos),
);

export const selectWorkspaceInitializerRemoteSetups = createSelector(
  (state) => getItems(state.workspaceInitializer.remoteSetups),
);

export const selectWorkspaceInitializerLastSubmittedAgent = createSelector(
  (state) => state.workspaceInitializer.lastSubmittedAgent,
);