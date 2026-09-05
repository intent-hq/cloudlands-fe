import { store } from '../../store';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';

export const selectWorkspaceCreationSettingsHydrated = store.createSelector(
  (state) => state.workspaceCreationSettings.hydrated,
);

export const selectWorkspaceCreationLastSelectedRepo = store.createSelector(
  (state) => state.workspaceCreationSettings.lastSelectedRepo,
);

export const selectWorkspaceCreationBranchByRepo = store.createSelector(
  (state) => state.workspaceCreationSettings.branchByRepo,
);

export const selectWorkspaceCreationDefaultParentPath = store.createSelector(
  (state) => state.workspaceCreationSettings.defaultParentPath,
);

export const selectWorkspaceCreationRecentRepos = store.createSelector((state) =>
  getItems(state.workspaceCreationSettings.recentRepos),
);

export const selectWorkspaceCreationRemoteSetups = store.createSelector((state) =>
  getItems(state.workspaceCreationSettings.remoteSetups),
);
