import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { IdentityProvider, IdentityState, PrincipalIdentity } from './identity-types';

/** Dotted path of the daemon setting the slice mirrors (§5.12 `settings.*`). */
export const IDENTITY_PROVIDER_SETTING_PATH = 'identity.provider';

export const initialState: IdentityState = {
  provider: null,
  loadStatus: 'idle',
  saving: false,
  error: null,
};

// ============================================================================
// Actions
// ============================================================================

/** Trigger: read `identity.provider` via `settings.get` and hydrate. */
export const initializeIdentity = createAction('identity/initialize');

/** Saga: the setting was read; `null` when unset. */
export const identityLoaded = createAction<[provider: IdentityProvider | null]>('identity/loaded');

/** Saga: the read failed (an older daemon without the setting reads as unset). */
export const identityLoadFailed = createAction('identity/loadFailed');

/** Trigger: write `identity.provider` via `settings.update` (re-keys the primary). */
export const setIdentityProviderRequested = createAction<[provider: IdentityProvider]>(
  'identity/setProviderRequested',
);

/** Saga: the write was applied. */
export const identityProviderSaved =
  createAction<[provider: IdentityProvider]>('identity/providerSaved');

/** Saga: the write failed; `error` is the user-facing message. */
export const identityProviderSaveFailed = createAction<[error: string]>(
  'identity/providerSaveFailed',
);

/**
 * `principal:identity-changed { principalId, identity | null }` arrived from
 * the daemon: the primary was re-keyed (or unlinked), so the mirrored
 * provider follows the new triple.
 */
export const identityChanged =
  createAction<[identity: PrincipalIdentity | null]>('identity/changed');

// ============================================================================
// Reducer
// ============================================================================

export const identityReducer = createReducer<IdentityState>(initialState);

identityReducer.with(initializeIdentity, (state) => ({
  ...state,
  loadStatus: 'loading',
  error: null,
}));
identityReducer.with(identityLoaded, (state, { payload: [provider] }) => ({
  ...state,
  provider,
  loadStatus: 'loaded',
}));
identityReducer.with(identityLoadFailed, (state) => ({ ...state, loadStatus: 'error' }));
identityReducer.with(setIdentityProviderRequested, (state) => ({
  ...state,
  saving: true,
  error: null,
}));
identityReducer.with(identityProviderSaved, (state, { payload: [provider] }) => ({
  ...state,
  provider,
  saving: false,
  loadStatus: 'loaded',
}));
identityReducer.with(identityProviderSaveFailed, (state, { payload: [error] }) => ({
  ...state,
  saving: false,
  error,
}));
identityReducer.with(identityChanged, (state, { payload: [identity] }) => ({
  ...state,
  provider: identity?.provider ?? null,
}));
