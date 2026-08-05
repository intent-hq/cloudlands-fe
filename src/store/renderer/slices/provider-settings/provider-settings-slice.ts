import { createAction } from "$lib/store-shim/utils/store/create-action";
import { createReducer } from "$lib/store-shim/utils/store/create-reducer";
import { resolveProviderEnabled } from "$shared/provider-catalog";
import { providerCatalogLoaded } from "../provider-catalog/provider-catalog-slice";

export type ProviderSettingsState = {
  activeProviderId: string;
  enabledProviders: Record<string, boolean>;
  /**
   * Registry metadata snapshotted from `providerCatalogLoaded` (reducers only
   * see their own slice): the default provider id ('' before hydration) and
   * the ids whose catalog rows say `canBeDisabled: false`.
   */
  defaultProviderId: string;
  nonDisableableProviderIds: string[];
};

export const ACTIVE_PROVIDER_STORAGE_KEY = "workspaces-active-provider";
export const ENABLED_PROVIDERS_STORAGE_KEY = "additional-agents-settings";
export const OLD_STORAGE_KEY = ENABLED_PROVIDERS_STORAGE_KEY;

export const initialState: ProviderSettingsState = {
  activeProviderId: "",
  enabledProviders: {},
  defaultProviderId: "",
  nonDisableableProviderIds: [],
};

function canBeDisabled(state: ProviderSettingsState, providerId: string): boolean {
  return !state.nonDisableableProviderIds.includes(providerId);
}

export const setActiveProvider = createAction<[providerId: string]>(
  "providerSettings/setActiveProvider"
);

export const hydrateActiveProvider = createAction<[providerId: string]>(
  "providerSettings/hydrateActiveProvider"
);

// NOTE: there is intentionally no "validate active provider against
// availability" action. Per decision D1(B) the active provider is never
// silently switched away because it's uninstalled/unavailable — the store
// keeps the user's selection and `selectIsActiveProviderAvailable` /
// `selectAvailableEnabledProviderIds` (provider-settings-selectors.ts) let
// the UI surface a failure state instead.

export const setProviderEnabled = createAction<
  [payload: { providerId: string; enabled: boolean }]
>("providerSettings/setProviderEnabled");

export const toggleProvider = createAction<[providerId: string]>(
  "providerSettings/toggleProvider"
);

export const ensureEnabledIfUnset = createAction<[providerId: string]>(
  "providerSettings/ensureEnabledIfUnset"
);

export const loadEnabledProvidersFromStorage = createAction<
  [providers: Record<string, boolean>]
>("providerSettings/loadEnabledProvidersFromStorage");

export const providerSettingsReducer = createReducer<ProviderSettingsState>(initialState)
  .with(providerCatalogLoaded, (state, { payload: [catalog] }) => ({
    ...state,
    defaultProviderId: catalog.defaultProviderId,
    nonDisableableProviderIds: catalog.providers
      .filter((provider) => provider.canBeDisabled === false)
      .map((provider) => provider.id),
    // Before hydration the active provider is unknown ('' initial state);
    // adopt the registry default unless settings hydration already set one.
    activeProviderId: state.activeProviderId || catalog.defaultProviderId,
  }))
  .with(setActiveProvider, (state, { payload: [providerId] }) => ({
    ...state,
    activeProviderId: providerId,
  }))
  .with(hydrateActiveProvider, (state, { payload: [providerId] }) => ({
    ...state,
    activeProviderId: providerId,
  }))
  .with(
    setProviderEnabled,
    (state, { payload: [{ providerId, enabled }] }) => {
      if (!canBeDisabled(state, providerId)) return state;
      return {
        ...state,
        enabledProviders: { ...state.enabledProviders, [providerId]: enabled },
      };
    }
  )
  .with(toggleProvider, (state, { payload: [providerId] }) => {
    if (!canBeDisabled(state, providerId)) return state;
    return {
      ...state,
      enabledProviders: {
        ...state.enabledProviders,
        [providerId]: !resolveProviderEnabled(state.enabledProviders, providerId, {
          defaultProviderId: state.defaultProviderId,
        }),
      },
    };
  })
  .with(ensureEnabledIfUnset, (state, { payload: [providerId] }) => {
    if (state.enabledProviders[providerId] !== undefined) {
      return state;
    }
    return {
      ...state,
      enabledProviders: { ...state.enabledProviders, [providerId]: true },
    };
  })
  .with(loadEnabledProvidersFromStorage, (state, { payload: [providers] }) => ({
    ...state,
    enabledProviders: providers,
  }));