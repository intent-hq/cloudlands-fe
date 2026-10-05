import { store } from '../../store';
import { normalizeGitLabInstanceUrl } from '$lib/utils/gitlab-host';
import { selectPrincipalSnapshot } from '../principal/principal-selectors';

export const selectGitLabInstanceSetupSupported = store.createSelector(
  (state) => selectPrincipalSnapshot.select(state)?.capabilities.gitlabCheckout === true,
);

export const selectGitLabAuthHost = store.createSelector((state) => state.gitlabAuth.host);
export const selectGitLabAuthTarget = store.createSelector(
  (state) => state.gitlabAuth.instanceBaseUrl ?? state.gitlabAuth.host,
);
export const selectGitLabAuthInstanceBaseUrl = store.createSelector(
  (state) =>
    normalizeGitLabInstanceUrl(state.gitlabAuth.instanceBaseUrl ?? state.gitlabAuth.host) ?? '',
);
export const selectGitLabAuthIsCancelling = store.createSelector(
  (state) => state.gitlabAuth.isCancelling,
);
export const selectGitLabAuthCancelOutcome = store.createSelector(
  (state) => state.gitlabAuth.cancelOutcome,
);

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

export const selectGitLabStatusReady = store.createSelector(
  (state) => state.gitlabAuth.statusReady === true,
);
