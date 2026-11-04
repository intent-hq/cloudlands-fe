import { store } from '../../store';

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
  },
);

/**
 * Show the experimental notice: this page is the web build served to a
 * browser by a Browser access host (intent-web or the desktop's Browser
 * access; never Electron), and it has not been dismissed in this page load.
 */
export const selectShowsWebExperimentalNotice = store.createSelector(
  (state) =>
    state.connections.browserHost != null && !state.globalModals.webExperimentalNoticeDismissed,
);
