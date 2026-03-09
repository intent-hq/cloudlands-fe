import { createSelector } from "../../utils/create-selector";

export const selectUpdatesLocked = createSelector((state) => {
  return state.storeUtility.updatesLocked;
});

