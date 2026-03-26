import { createSelector } from "../../utils/create-selector";
import { emptyWorkspaceSettings } from "./workspace-settings-slice";

export const selectAutoCommitEnabled = createSelector((state, workspaceId: string) => {
  const wsState = state.workspaceSettings.byWorkspaceId[workspaceId] ?? emptyWorkspaceSettings;
  return wsState.autoCommitEnabled;
});

