import { store } from '../../store';
/**
 * Sentry Auth Selectors
 */

export const selectSentryIsAuthenticated = store.createSelector(
  (state) => state.sentryAuth.isAuthenticated,
);

export const selectSentryOrganization = store.createSelector(
  (state) => state.sentryAuth.organization,
);

export const selectSentryIsConnecting = store.createSelector(
  (state) => state.sentryAuth.isConnecting,
);

export const selectSentryError = store.createSelector((state) => state.sentryAuth.error);
