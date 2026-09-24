import { store } from '../../store';

export const selectGitHubAuthMutationRequestId = store.createSelector(
  (state) => state.githubAuth.mutationRequestId,
);

export const selectGitHubAuthCallbacksCancelled = store.createSelector(
  (state) => state.githubAuth.callbacksCancelled,
);

export const selectGitHubAuthIsDisconnecting = store.createSelector(
  (state) => state.githubAuth.isDisconnecting,
);

export const selectGitHubAuthIsAuthenticated = store.createSelector(
  (state) => state.githubAuth.isAuthenticated,
);

export const selectGitHubAuthRequiresDaemonAuth = store.createSelector(
  (state) => state.githubAuth.requiresDaemonAuth,
);

export const selectGitHubAuthUser = store.createSelector((state) => state.githubAuth.user);

export const selectGitHubAuthIsAuthenticating = store.createSelector(
  (state) => state.githubAuth.isAuthenticating,
);

export const selectGitHubAuthDeviceFlow = store.createSelector(
  (state) => state.githubAuth.deviceFlow,
);

export const selectGitHubAuthError = store.createSelector((state) => state.githubAuth.error);
