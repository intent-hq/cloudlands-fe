import { createSelector } from "../../utils/create-selector";

export const selectLinearIsAuthenticated = createSelector(
  (state) => state.linearAuth.isAuthenticated,
);

export const selectLinearRequiresAugmentAuth = createSelector(
  (state) => state.linearAuth.requiresAugmentAuth,
);

export const selectLinearIsAuthenticating = createSelector(
  (state) => state.linearAuth.isAuthenticating,
);

export const selectLinearOauthUrl = createSelector(
  (state) => state.linearAuth.oauthUrl,
);

export const selectLinearError = createSelector(
  (state) => state.linearAuth.error,
);

export const selectLinearIssues = createSelector(
  (state) => state.linearAuth.issues,
);

export const selectLinearIsLoadingIssues = createSelector(
  (state) => state.linearAuth.isLoadingIssues,
);

