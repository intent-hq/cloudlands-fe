import { store } from '../../store';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';

export const selectLinearIsAuthenticated = store.createSelector(
  (state) => state.linearAuth.isAuthenticated,
);

export const selectLinearRequiresDaemonAuth = store.createSelector(
  (state) => state.linearAuth.requiresDaemonAuth,
);

export const selectLinearIsAuthenticating = store.createSelector(
  (state) => state.linearAuth.isAuthenticating,
);

export const selectLinearError = store.createSelector((state) => state.linearAuth.error);

export const selectLinearIssueFilter = store.createSelector(
  (state) => state.linearAuth.issueFilter,
);

export const selectLinearIssues = store.createSelector((state) =>
  getItems(state.linearAuth.issues),
);

export const selectLinearIssuesLoading = store.createSelector(
  (state) => state.linearAuth.isLoadingIssues,
);
