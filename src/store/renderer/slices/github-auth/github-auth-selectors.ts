import { store } from "../../store";

export const selectGitHubAuthIsAuthenticated = store.createSelector(
  (state) => state.githubAuth.isAuthenticated,
);

export const selectGitHubAuthRequiresAugmentAuth = store.createSelector(
  (state) => state.githubAuth.requiresAugmentAuth,
);

export const selectGitHubAuthUser = store.createSelector(
  (state) => state.githubAuth.user,
);

export const selectGitHubAuthIsAuthenticating = store.createSelector(
  (state) => state.githubAuth.isAuthenticating,
);

export const selectGitHubAuthOauthUrl = store.createSelector(
  (state) => state.githubAuth.oauthUrl,
);

export const selectGitHubAuthError = store.createSelector(
  (state) => state.githubAuth.error,
);

