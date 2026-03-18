import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import { getProviderConfig } from "$shared/config/provider-config";

// ============================================================================
// Types
// ============================================================================

export type AdditionalAgentsState = {
  enabledProviders: Record<string, boolean>;
};

// ============================================================================
// Constants
// ============================================================================

export const STORAGE_KEY = "additional-agents-settings";

// ============================================================================
// Initial State
// ============================================================================

export const initialState: AdditionalAgentsState = {
  enabledProviders: {},
};

// ============================================================================
// Reducer Actions (pure state updates)
// ============================================================================

export const setProviderEnabled = createAction<
  [payload: { providerId: string; enabled: boolean }]
>("additionalAgents/setProviderEnabled");

export const toggleProvider = createAction<[providerId: string]>(
  "additionalAgents/toggleProvider"
);

export const ensureEnabledIfUnset = createAction<[providerId: string]>(
  "additionalAgents/ensureEnabledIfUnset"
);

export const loadEnabledProvidersFromStorage = createAction<
  [providers: Record<string, boolean>]
>("additionalAgents/loadEnabledProvidersFromStorage");

// ============================================================================
// Reducer
// ============================================================================

export const additionalAgentsReducer = createReducer<AdditionalAgentsState>(
  initialState
)
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
  .with(
    loadEnabledProvidersFromStorage,
    (state, { payload: [providers] }) => ({
      ...state,
      enabledProviders: providers,
    })
  );

