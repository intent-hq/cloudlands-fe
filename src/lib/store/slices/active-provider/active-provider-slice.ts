import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import { getDefaultProviderId } from "$shared/config/provider-config";

// ============================================================================
// Types & Constants
// ============================================================================

export type ActiveProviderState = {
  activeProviderId: string;
};

/** localStorage key for the active provider */
export const STORAGE_KEY = "workspaces-active-provider";
/** Legacy localStorage key for migration */
export const OLD_STORAGE_KEY = "additional-agents-settings";

export const initialState: ActiveProviderState = {
  activeProviderId: getDefaultProviderId(),
};

// ============================================================================
// Reducer Actions (pure state updates)
// ============================================================================

/** Set the active provider ID (reducer just sets the value) */
export const setActiveProvider = createAction<[providerId: string]>(
  "activeProvider/setActiveProvider"
);

/** Hydrate active provider from localStorage (used by init saga) */
export const hydrateActiveProvider = createAction<[providerId: string]>(
  "activeProvider/hydrateActiveProvider"
);

// ============================================================================
// Saga Trigger Actions (dispatched by consumers, handled by sagas)
// ============================================================================

/** Validate that the active provider is in the available list; falls back if not */
export const validateActiveProvider = createAction<[availableProviderIds: string[]]>(
  "activeProvider/validateActiveProvider"
);

// ============================================================================
// Reducer
// ============================================================================

export const activeProviderReducer = createReducer<ActiveProviderState>(initialState)
  .with(setActiveProvider, (state, { payload: [providerId] }) => ({
    ...state,
    activeProviderId: providerId,
  }))
  .with(hydrateActiveProvider, (state, { payload: [providerId] }) => ({
    ...state,
    activeProviderId: providerId,
  }));

