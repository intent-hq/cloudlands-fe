import { store } from "../../store";
import { emptyWorkspaceTransientUiState } from './transient-ui-slice';

export const selectTransientUiWorkspaceState = store.createSelector((state, workspaceId: string) => {
  return state.transientUi.byWorkspaceId[workspaceId] ?? emptyWorkspaceTransientUiState;
});

export const selectSidebarActiveTab = store.createSelector((state, workspaceId: string) => {
  return selectTransientUiWorkspaceState.select(state, workspaceId).sidebarActiveTab;
});

export const selectViewedFiles = store.createSelector((state, workspaceId: string) => {
  return selectTransientUiWorkspaceState.select(state, workspaceId).viewedFiles;
});

export const selectIsRawNoteViewEnabled = store.createSelector(
  (state, workspaceId: string, noteId: string) => {
    return (
      selectTransientUiWorkspaceState.select(state, workspaceId).rawNoteViewByNoteId[noteId] ===
      true
    );
  },
);

export const selectChatDraft = store.createSelector((state, workspaceId: string, agentId: string) => {
  return selectTransientUiWorkspaceState.select(state, workspaceId).chatDrafts[agentId] ?? '';
});
