import { createSelector } from "../../utils/create-selector";

export const selectBetaUpdatesEnabled = createSelector((state) => {
  return state.userPreferences.betaUpdatesEnabled;
});

export const selectSpellcheckEnabled = createSelector((state) => {
  return state.userPreferences.spellcheckEnabled;
});

export const selectZoomFactor = createSelector((state) => {
  return state.userPreferences.zoomFactor;
});

export const selectCounterScale = createSelector((state) => {
  return 1 / state.userPreferences.zoomFactor;
});