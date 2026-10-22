import { store } from '../../store';

export const selectSentryAuthOperation = store.createSelector(
  (state) => state.sentryAuth.operation,
);
export const selectSentryAuthConsumerOperation = store.createSelector(
  (state, consumerId: string) =>
    state.sentryAuth.operation?.consumerId === consumerId ? state.sentryAuth.operation : null,
);
export const selectSentryIsDisconnecting = store.createSelector(
  (state) =>
    state.sentryAuth.operation?.kind === 'logout' &&
    state.sentryAuth.operation.status === 'pending',
);
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
