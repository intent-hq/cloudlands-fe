import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";

export type UserPreferencesState = {
  betaUpdatesEnabled: boolean;
  spellcheckEnabled: boolean;
  zoomFactor: number;
};

export const initialState: UserPreferencesState = {
  betaUpdatesEnabled: false,
  spellcheckEnabled: false,
  zoomFactor: 1.0,
};

export const setBetaUpdatesEnabled = createAction<[value: boolean]>(
  "userPreferences/setBetaUpdatesEnabled"
);

export const toggleBetaUpdates = createAction(
  "userPreferences/toggleBetaUpdates"
);

export const loadBetaUpdatesSettings = createAction<[enabled: boolean]>(
  "userPreferences/loadBetaUpdatesSettings"
);

export const setSpellcheckEnabled = createAction<[enabled: boolean]>(
  "userPreferences/setSpellcheckEnabled"
);

export const toggleSpellcheck = createAction(
  "userPreferences/toggleSpellcheck"
);

export const setZoomFactor = createAction<[factor: number]>(
  "userPreferences/setZoomFactor"
);

export const userPreferencesReducer = createReducer<UserPreferencesState>(initialState)
  .with(setBetaUpdatesEnabled, (state, { payload: [value] }) => ({
    ...state,
    betaUpdatesEnabled: value,
  }))
  .with(toggleBetaUpdates, (state) => ({
    ...state,
    betaUpdatesEnabled: !state.betaUpdatesEnabled,
  }))
  .with(loadBetaUpdatesSettings, (state, { payload: [enabled] }) => ({
    ...state,
    betaUpdatesEnabled: enabled,
  }))
  .with(setSpellcheckEnabled, (state, { payload: [enabled] }) => ({
    ...state,
    spellcheckEnabled: enabled,
  }))
  .with(toggleSpellcheck, (state) => ({
    ...state,
    spellcheckEnabled: !state.spellcheckEnabled,
  }))
  .with(setZoomFactor, (state, { payload: [factor] }) => {
    if (!Number.isFinite(factor) || factor <= 0) return state;
    if (factor === state.zoomFactor) return state;
    return { ...state, zoomFactor: factor };
  });