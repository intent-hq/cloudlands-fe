import { store } from "../../store";

export const selectLinearIsAuthenticated = store.createSelector(
  (state) => state.linearAuth.isAuthenticated,
);

export const selectLinearRequiresAugmentAuth = store.createSelector(
  (state) => state.linearAuth.requiresAugmentAuth,
);

export const selectLinearIsAuthenticating = store.createSelector(
  (state) => state.linearAuth.isAuthenticating,
);

export const selectLinearOauthUrl = store.createSelector(
  (state) => state.linearAuth.oauthUrl,
);

export const selectLinearError = store.createSelector(
  (state) => state.linearAuth.error,
);

export const selectLinearIssues = store.createSelector(
  (state) => state.linearAuth.issues,
);

export const selectLinearIsLoadingIssues = store.createSelector(
  (state) => state.linearAuth.isLoadingIssues,
);

