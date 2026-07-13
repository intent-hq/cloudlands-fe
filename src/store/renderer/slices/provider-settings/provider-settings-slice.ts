import { createAction } from "@augmentcode/ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "@augmentcode/ag-redux-toolkit/utils/store/create-reducer";
import {
  getDefaultProviderId,
  getProviderConfig,
} from "$shared/config/provider-config";

export type ProviderSettingsState = {
  activeProviderId: string;
  enabledProviders: Record<string, boolean>;
};

export const ACTIVE_PROVIDER_STORAGE_KEY = "workspaces-active-provider";
export const ENABLED_PROVIDERS_STORAGE_KEY = "additional-agents-settings";
export const OLD_STORAGE_KEY = ENABLED_PROVIDERS_STORAGE_KEY;

export const initialState: ProviderSettingsState = {
  activeProviderId: getDefaultProviderId(),
  enabledProviders: {},
};

export const setActiveProvider = createAction<[providerId: string]>(
  "providerSettings/setActiveProvider"
);

export const hydrateActiveProvider = createAction<[providerId: string]>(
  "providerSettings/hydrateActiveProvider"
);

export const validateActiveProvider = createAction<[availableProviderIds: string[]]>(
  "providerSettings/validateActiveProvider"
);

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
      if (getProviderConfig(providerId).canBeDisabled === false) return state;
      return {
        ...state,
        enabledProviders: { ...state.enabledProviders, [providerId]: enabled },
      };
    }
  )
  .with(toggleProvider, (state, { payload: [providerId] }) => {
    if (getProviderConfig(providerId).canBeDisabled === false) return state;
    return {
      ...state,
      enabledProviders: {
        ...state.enabledProviders,
        [providerId]: !(state.enabledProviders[providerId] ?? false),
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