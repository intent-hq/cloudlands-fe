import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { resolveProviderEnabled } from '$shared/provider-catalog';
import { providerCatalogLoaded } from '../provider-catalog/provider-catalog-slice';

export type ProviderSettingsState = {
  activeProviderId: string;
  /**
   * Newest local active-provider choice awaiting a matching daemon hydration.
   * Conflicting hydration values are older snapshots/echoes and cannot replace
   * the choice until it is confirmed or the persistence write is rejected.
   */
  pendingActiveProviderId: string | null;
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
  activeProviderId: '',
  pendingActiveProviderId: null,
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

export const setActiveProvider = createAction<[providerId: string]>(
  'providerSettings/setActiveProvider',
);

export const hydrateActiveProvider = createAction<[providerId: string]>(
  'providerSettings/hydrateActiveProvider',
);

/** Effective active provider after guarded daemon hydration reconciliation. */
export const activeProviderReconciled = createAction<[providerId: string]>(
  'providerSettings/activeProviderReconciled',
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
providerSettingsReducer.with(setActiveProvider, (state, { payload: [providerId] }) => ({
  ...state,
  activeProviderId: providerId,
  pendingActiveProviderId: providerId,
}));
providerSettingsReducer.with(setAtomicDefaultModel, (state, { payload: [{ providerId }] }) => ({
  ...state,
  activeProviderId: providerId,
  pendingActiveProviderId: providerId,
}));
providerSettingsReducer.with(hydrateActiveProvider, (state, { payload: [providerId] }) => {
  if (state.pendingActiveProviderId && providerId !== state.pendingActiveProviderId) return state;
  return {
    ...state,
    activeProviderId: providerId,
    pendingActiveProviderId: null,
  };
});
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
providerSettingsReducer.with(activeProviderPersistRejected, (state, { payload: [providerId] }) => {
  if (state.pendingActiveProviderId !== providerId) return state;
  return { ...state, pendingActiveProviderId: null };
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
