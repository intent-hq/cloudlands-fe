/**
 * Sentry Auth Selectors
 */

import { createSelector } from "../../utils/create-selector";

export const selectSentryIsAuthenticated = createSelector(
  (state) => state.sentryAuth.isAuthenticated,
);

export const selectSentryOrganization = createSelector(
  (state) => state.sentryAuth.organization,
);

export const selectSentryIsConnecting = createSelector(
  (state) => state.sentryAuth.isConnecting,
);

export const selectSentryError = createSelector(
  (state) => state.sentryAuth.error,
);

export const selectSentryProjects = createSelector(
  (state) => state.sentryAuth.projects,
);

export const selectSentryIsLoadingProjects = createSelector(
  (state) => state.sentryAuth.isLoadingProjects,
);

export const selectSentryIssues = createSelector(
  (state) => state.sentryAuth.issues,
);

export const selectSentryIsLoadingIssues = createSelector(
  (state) => state.sentryAuth.isLoadingIssues,
);

