import { store } from "../../store";

export const selectLinearIsAuthenticated = store.createSelector(
  (state) => state.linearAuth.isAuthenticated,
);

export const selectLinearRequiresDaemonAuth = store.createSelector(
  (state) => state.linearAuth.requiresDaemonAuth,
);

export const selectLinearIsAuthenticating = store.createSelector(
  (state) => state.linearAuth.isAuthenticating,
);

export const selectLinearError = store.createSelector(
  (state) => state.linearAuth.error,
);

