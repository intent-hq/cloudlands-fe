import { store } from '../../store';
import { emptyWorkspaceTransientUiState, type NoteViewMode } from './transient-ui-slice';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { ComposerContextItem } from './transient-ui-types';

const selectTransientUiWorkspaceState = store.createSelector((state, workspaceId: string) => {
  return state.transientUi.byWorkspaceId[workspaceId] ?? emptyWorkspaceTransientUiState;
});

export const selectComposerContextItems = store.createSelector(
  (state, workspaceId: string, agentId: string): ComposerContextItem[] => {
    const items = selectTransientUiWorkspaceState.select(state, workspaceId)
      .composerContextByAgentId?.[agentId];
    return items ? getItems(items) : [];
  },
);

export const selectWorkspaceComposerContext = store.createSelector(
  (state, workspaceId: string) =>
    selectTransientUiWorkspaceState.select(state, workspaceId).composerContextByAgentId ?? {},
);

export const selectSidebarActiveTab = store.createSelector((state, workspaceId: string) => {
  return selectTransientUiWorkspaceState.select(state, workspaceId).sidebarActiveTab;
});

export const selectViewedFiles = store.createSelector((state, workspaceId: string) => {
  return selectTransientUiWorkspaceState.select(state, workspaceId).viewedFiles;
});

export const selectNoteViewMode = store.createSelector(
  (state, workspaceId: string, noteId: string) => {
    return (
      selectTransientUiWorkspaceState.select(state, workspaceId).noteViewModeByNoteId[noteId] ??
      ('editor' satisfies NoteViewMode)
    );
  },
);

export const selectIsRawNoteViewEnabled = store.createSelector(
  (state, workspaceId: string, noteId: string) =>
    selectNoteViewMode.select(state, workspaceId, noteId) === 'raw',
);

export const selectChatDraft = store.createSelector(
  (state, workspaceId: string, agentId: string) => {
    return selectTransientUiWorkspaceState.select(state, workspaceId).chatDrafts[agentId] ?? '';
  },
);
