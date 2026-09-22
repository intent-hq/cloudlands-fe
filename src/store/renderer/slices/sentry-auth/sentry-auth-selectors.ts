import { store } from '../../store';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
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

export const selectSentryIssues = store.createSelector((state) =>
  getItems(state.sentryAuth.issues),
);
export const selectSentryIssuesLoading = store.createSelector(
  (state) => state.sentryAuth.isLoadingIssues,
);
export const selectSentryIssuesLoaded = store.createSelector(
  (state) => state.sentryAuth.issuesLoaded,
);
