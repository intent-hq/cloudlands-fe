import { createSelector } from "../../utils/create-selector";
import { emptyWorkspaceTransientUiState } from "./transient-ui-slice";

export const selectTransientUiWorkspaceState = createSelector((state, workspaceId: string) => {
  return state.transientUi.byWorkspaceId[workspaceId] ?? emptyWorkspaceTransientUiState;
});

export const selectAcceptChangesState = createSelector((state, workspaceId: string) => {
  return selectTransientUiWorkspaceState.select(state, workspaceId).acceptChanges;
});

export const selectSidebarChangesState = createSelector((state, workspaceId: string) => {
  return selectTransientUiWorkspaceState.select(state, workspaceId).sidebarChanges;
});

export const selectSidebarActiveTab = createSelector((state, workspaceId: string) => {
  return selectTransientUiWorkspaceState.select(state, workspaceId).sidebarActiveTab;
});

export const selectViewedFiles = createSelector((state, workspaceId: string) => {
  return selectTransientUiWorkspaceState.select(state, workspaceId).viewedFiles;
});

export const selectChatDraft = createSelector((state, workspaceId: string, agentId: string) => {
  return selectTransientUiWorkspaceState.select(state, workspaceId).chatDrafts[agentId] ?? "";
});