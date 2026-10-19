/**
 * Per-profile sign-in state for model pickers (§5.54 UI status mapping): a
 * saved profile is `configured`; `ready` / `error` come from
 * `host.providerAuthStatus { providerId: providerRef }`. Keyed by profile id.
 */
import { store } from '../../store';
import type { ProviderProfileStatus } from './provider-settings-types';

const NO_STATUS: Record<string, ProviderProfileStatus> = {};

export const selectProfileSignInStatuses = store.createSelector(
  (state): Record<string, ProviderProfileStatus> =>
    state.providerSettings?.profiles?.status ?? NO_STATUS,
);
