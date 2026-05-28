import { createSelector } from "../../utils/create-selector";

export const selectGlobalModals = createSelector((state) => {
  return state.globalModals;
});

export const selectGitHubAuthModal = createSelector((state) => {
  return state.globalModals.githubAuth;
});

export const selectIsGitHubAuthModalOpen = createSelector((state) => {
  return selectGitHubAuthModal.select(state).open;
});

export const selectPendingGitHubAuth = createSelector((state) => {
  return selectGitHubAuthModal.select(state).pendingAuth;
});

export const selectGitHubAuthModalKey = createSelector((state) => {
  return selectGitHubAuthModal.select(state).modalKey;
});

export const selectGitCredentialsModal = createSelector((state) => {
  return state.globalModals.gitCredentials;
});

export const selectIsGitCredentialsModalOpen = createSelector((state) => {
  return selectGitCredentialsModal.select(state).open;
});

export const selectGitCredentialsError = createSelector((state) => {
  return selectGitCredentialsModal.select(state).error;
});

export const selectHasShownGitCredentialsModalForWorkspace = createSelector(
  (state, workspaceId: string | undefined): boolean => {
    if (!workspaceId) {
      return false;
    }

    return !!selectGitCredentialsModal.select(state).shownForWorkspaceIds[workspaceId];
  }
);
