import { createSelector } from "../../utils/create-selector";

export const selectBetaUpdatesEnabled = createSelector((state) => {
  return state.betaUpdates.enabled;
});

