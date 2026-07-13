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

export const selectLinearError = store.createSelector(
  (state) => state.linearAuth.error,
);

