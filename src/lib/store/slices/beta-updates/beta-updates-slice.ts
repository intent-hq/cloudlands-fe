import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";

// ============================================================================
// Types
// ============================================================================

export type BetaUpdatesState = {
  enabled: boolean;
};

// ============================================================================
// Initial State
// ============================================================================

export const initialState: BetaUpdatesState = {
  enabled: false,
};

// ============================================================================
// Actions
// ============================================================================

export const setBetaUpdatesEnabled = createAction<[value: boolean]>(
  "betaUpdates/setBetaUpdatesEnabled"
);

export const toggleBetaUpdates = createAction(
  "betaUpdates/toggleBetaUpdates"
);

export const loadBetaUpdatesSettings = createAction<[enabled: boolean]>(
  "betaUpdates/loadBetaUpdatesSettings"
);

// ============================================================================
// Reducer
// ============================================================================

export const betaUpdatesReducer = createReducer<BetaUpdatesState>(initialState)
  .with(setBetaUpdatesEnabled, (state, { payload: [value] }) => ({
    ...state,
    enabled: value,
  }))
  .with(toggleBetaUpdates, (state) => ({
    ...state,
    enabled: !state.enabled,
  }))
  .with(loadBetaUpdatesSettings, (state, { payload: [enabled] }) => ({
    ...state,
    enabled,
  }));

