import { store } from "../../store";

export const selectGlobalModals = store.createSelector((state) => {
  return state.globalModals;
});

export const selectGitHubAuthModal = store.createSelector((state) => {
  return state.globalModals.githubAuth;
});

export const selectIsGitHubAuthModalOpen = store.createSelector((state) => {
  return selectGitHubAuthModal.select(state).open;
});

export const selectPendingGitHubAuth = store.createSelector((state) => {
  return selectGitHubAuthModal.select(state).pendingAuth;
});

export const selectGitHubAuthModalKey = store.createSelector((state) => {
  return selectGitHubAuthModal.select(state).modalKey;
});

export const selectGitCredentialsModal = store.createSelector((state) => {
  return state.globalModals.gitCredentials;
});

export const selectIsGitCredentialsModalOpen = store.createSelector((state) => {
  return selectGitCredentialsModal.select(state).open;
});

export const selectGitCredentialsError = store.createSelector((state) => {
  return selectGitCredentialsModal.select(state).error;
});

export const selectHasShownGitCredentialsModalForWorkspace = store.createSelector(
  (state, workspaceId: string | undefined): boolean => {
    if (!workspaceId) {
      return false;
    }

    return !!selectGitCredentialsModal.select(state).shownForWorkspaceIds[workspaceId];
  }
);
