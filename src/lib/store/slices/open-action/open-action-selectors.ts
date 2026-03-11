import { createSelector } from "../../utils/create-selector";

export const selectOpenAction = createSelector((state) => {
  return state.openAction.action;
});

