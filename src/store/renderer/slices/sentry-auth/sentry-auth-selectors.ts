import { store } from "../../store";
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

export const selectSentryError = store.createSelector(
  (state) => state.sentryAuth.error,
);

export const selectSentryProjects = store.createSelector(
  (state) => state.sentryAuth.projects,
);

export const selectSentryIsLoadingProjects = store.createSelector(
  (state) => state.sentryAuth.isLoadingProjects,
);

export const selectSentryIssues = store.createSelector(
  (state) => state.sentryAuth.issues,
);

export const selectSentryIsLoadingIssues = store.createSelector(
  (state) => state.sentryAuth.isLoadingIssues,
);

