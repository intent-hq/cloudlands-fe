import { createSelector } from "../../utils/create-selector";

export const selectSpellcheckEnabled = createSelector((state) => {
  return state.noteSpellcheckSettings.enabled;
});

