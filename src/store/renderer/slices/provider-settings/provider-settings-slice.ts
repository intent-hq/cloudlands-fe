import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { resolveProviderEnabled } from '$shared/provider-catalog';
import { providerCatalogLoaded } from '../provider-catalog/provider-catalog-slice';

export type ProviderSettingsState = {
  enabledProviders: Record<string, boolean>;
  /**
   * Registry metadata snapshotted from `providerCatalogLoaded` (reducers only
   * see their own slice): the ids whose catalog rows say
   * `canBeDisabled: false`.
   */
  nonDisableableProviderIds: string[];
  /**
   * Local enablement intent not yet confirmed by the daemon: providerId →
   * enabled, recorded by `setProviderEnabled` / `toggleProvider` and merged
   * over every `loadEnabledProvidersFromStorage` hydration so a stale boot
   * snapshot racing a fresh click cannot clobber the entry (monorepo#1986).
   * An entry is cleared once a hydration carries the same value (the daemon
   * confirmed the write); a conflicting hydration keeps the newer local
   * intent until then. When the daemon REJECTS the enablement write, the
   * persistence saga dispatches `enablementPersistRejected` to retire the
   * entry, so a rejected click cannot mask later daemon-originated changes
   * for that provider for the rest of the session.
   */
  pendingEnablementOverrides: Record<string, boolean>;
};

export const initialState: ProviderSettingsState = {
  enabledProviders: {},
  nonDisableableProviderIds: [],
  pendingEnablementOverrides: {},
};

/** Optimistically applies one provider/model default pair; persistence is one atomic batch. */
export const setAtomicDefaultModel = createAction<[payload: { providerId: string; model: string }]>(
  'providerSettings/setAtomicDefaultModel',
);

function canBeDisabled(state: ProviderSettingsState, providerId: string): boolean {
  return !state.nonDisableableProviderIds.includes(providerId);
}

/**
 * User pick of the default provider (the provider leg of the default model
 * triple). The state lives in the model slice (`ModelState.defaultProviderId`
 * with a `pendingDefaultProviderId` hydration guard); the persistence saga
 * writes `model.defaultProvider` (PROTOCOL §5.12).
 */
export const setActiveProvider = createAction<[providerId: string]>(
  'providerSettings/setActiveProvider',
);

// NOTE: there is intentionally no "validate active provider against
// availability" action. Per decision D1(B) the active provider is never
// silently switched away because it's uninstalled/unavailable — the store
// keeps the user's selection and `selectIsActiveProviderAvailable` /
// `selectAvailableEnabledProviderIds` (provider-settings-selectors.ts) let
// the UI surface a failure state instead.

export const setProviderEnabled = createAction<[payload: { providerId: string; enabled: boolean }]>(
  'providerSettings/setProviderEnabled',
);

export const toggleProvider = createAction<[providerId: string]>('providerSettings/toggleProvider');

export const ensureEnabledIfUnset = createAction<[providerId: string]>(
  'providerSettings/ensureEnabledIfUnset',
);

export const loadEnabledProvidersFromStorage = createAction<[providers: Record<string, boolean>]>(
  'providerSettings/loadEnabledProvidersFromStorage',
);

/**
 * Dispatched by the persistence saga when the daemon rejects an enablement
 * write (structured error response — not a transient transport failure).
 * Retires the provider's pending override so the renderer re-converges to
 * daemon state on the next hydration; the local map is left as-is until then.
 */
export const enablementPersistRejected = createAction<[providerId: string]>(
  'providerSettings/enablementPersistRejected',
);

/**
 * Dispatched by the persistence sagas when the daemon rejects a
 * `model.defaultProvider` write. Handled in the model slice: retires the
 * matching pending default provider so later hydrations apply verbatim.
 */
export const activeProviderPersistRejected = createAction<[providerId: string]>(
  'providerSettings/activeProviderPersistRejected',
);

export const providerSettingsReducer = createReducer<ProviderSettingsState>(initialState);
providerSettingsReducer.with(providerCatalogLoaded, (state, { payload: [catalog] }) => ({
  ...state,
  nonDisableableProviderIds: catalog.providers
    .filter((provider) => provider.canBeDisabled === false)
    .map((provider) => provider.id),
  // The registry carries no default designation; the active provider is
  // user-derived (settings hydration / onboarding pick). Before those land
  // it stays '' — never silently adopted from the catalog.
}));
providerSettingsReducer.with(
  setProviderEnabled,
  (state, { payload: [{ providerId, enabled }] }) => {
    if (!canBeDisabled(state, providerId)) return state;
    return {
      ...state,
      enabledProviders: { ...state.enabledProviders, [providerId]: enabled },
      pendingEnablementOverrides: {
        ...state.pendingEnablementOverrides,
        [providerId]: enabled,
      },
    };
  },
);
providerSettingsReducer.with(toggleProvider, (state, { payload: [providerId] }) => {
  if (!canBeDisabled(state, providerId)) return state;
  const enabled = !resolveProviderEnabled(state.enabledProviders, providerId);
  return {
    ...state,
    enabledProviders: { ...state.enabledProviders, [providerId]: enabled },
    pendingEnablementOverrides: {
      ...state.pendingEnablementOverrides,
      [providerId]: enabled,
    },
  };
});
providerSettingsReducer.with(ensureEnabledIfUnset, (state, { payload: [providerId] }) => {
  if (state.enabledProviders[providerId] !== undefined) {
    return state;
  }
  return {
    ...state,
    enabledProviders: { ...state.enabledProviders, [providerId]: true },
  };
});
providerSettingsReducer.with(enablementPersistRejected, (state, { payload: [providerId] }) => {
  if (!(providerId in state.pendingEnablementOverrides)) return state;
  const pending = { ...state.pendingEnablementOverrides };
  delete pending[providerId];
  return { ...state, pendingEnablementOverrides: pending };
});
providerSettingsReducer.with(loadEnabledProvidersFromStorage, (state, { payload: [providers] }) => {
  // Hydration (boot snapshot or settings:changed) never clobbers newer
  // local intent: still-pending overrides win over the incoming map, and a
  // matching incoming value confirms (retires) the override.
  const pending: Record<string, boolean> = {};
  for (const [providerId, enabled] of Object.entries(state.pendingEnablementOverrides)) {
    if (providers[providerId] !== enabled) pending[providerId] = enabled;
  }
  return {
    ...state,
    enabledProviders: { ...providers, ...pending },
    pendingEnablementOverrides: pending,
  };
});
