import { store } from '../../store';

export const selectGitLabAuthHost = store.createSelector((state) => state.gitlabAuth.host);

export const selectGitLabAuthIsConfigured = store.createSelector(
  (state) => state.gitlabAuth.isConfigured,
);

export const selectGitLabAuthIsAuthenticating = store.createSelector(
  (state) => state.gitlabAuth.isAuthenticating,
);

export const selectGitLabAuthDeviceFlow = store.createSelector(
  (state) => state.gitlabAuth.deviceFlow,
);

export const selectGitLabAuthDeviceGrantSupported = store.createSelector(
  (state) => state.gitlabAuth.deviceGrantSupported,
);

export const selectGitLabAuthUser = store.createSelector((state) => state.gitlabAuth.user);

export const selectGitLabAuthError = store.createSelector((state) => state.gitlabAuth.error);

export const selectGitLabAuthMethod = store.createSelector((state) => state.gitlabAuth.method);
