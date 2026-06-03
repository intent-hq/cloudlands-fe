import { store } from "../../store";
import { emptyWorkspaceSettings } from "./workspace-settings-slice";

export const selectAutoCommitEnabled = store.createSelector((state, workspaceId: string) => {
  const wsState = state.workspaceSettings.byWorkspaceId[workspaceId] ?? emptyWorkspaceSettings;
  return wsState.autoCommitEnabled;
});

