import { createSelector } from "../../utils/create-selector";

export const selectAutoCommitEnabled = createSelector((state) => {
  return state.workspaceSettings.autoCommitEnabled;
});

