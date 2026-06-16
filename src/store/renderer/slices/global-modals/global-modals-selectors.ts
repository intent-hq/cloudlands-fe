import { store } from "../../store";

export const selectGlobalModals = store.createSelector((state) => {
  return state.globalModals;
});

const selectGitHubAuthModal = store.createSelector((state) => {
  return state.globalModals.githubAuth;
});

export const selectPendingGitHubAuth = store.createSelector((state) => {
  return selectGitHubAuthModal.select(state).pendingAuth;
});

const selectGitCredentialsModal = store.createSelector((state) => {
  return state.globalModals.gitCredentials;
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
