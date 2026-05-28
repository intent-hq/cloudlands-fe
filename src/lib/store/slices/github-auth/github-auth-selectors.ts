import { createSelector } from "../../utils/create-selector";

export const selectGitHubAuthIsAuthenticated = createSelector(
  (state) => state.githubAuth.isAuthenticated,
);

export const selectGitHubAuthRequiresAugmentAuth = createSelector(
  (state) => state.githubAuth.requiresAugmentAuth,
);

export const selectGitHubAuthUser = createSelector(
  (state) => state.githubAuth.user,
);

export const selectGitHubAuthIsAuthenticating = createSelector(
  (state) => state.githubAuth.isAuthenticating,
);

export const selectGitHubAuthOauthUrl = createSelector(
  (state) => state.githubAuth.oauthUrl,
);

export const selectGitHubAuthNeedsScopeUpdate = createSelector(
  (state) => state.githubAuth.needsScopeUpdate,
);

export const selectGitHubAuthError = createSelector(
  (state) => state.githubAuth.error,
);

export const selectGitHubAuthState = createSelector(
  (state) => state.githubAuth,
);

