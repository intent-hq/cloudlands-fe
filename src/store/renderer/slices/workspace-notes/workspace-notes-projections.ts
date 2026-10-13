import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { Note } from '../../../../shared/types';
import { emptyWorkspaceNotesState } from './workspace-notes-slice';
import type { WorkspaceNotesState, WorkspaceNotesWorkspaceState } from './workspace-notes-types';

type WorkspaceNotesProjectionState = { workspaceNotes: WorkspaceNotesState };

export const getWorkspaceNotesState = (
  state: WorkspaceNotesProjectionState,
  workspaceId: string,
): WorkspaceNotesWorkspaceState =>
  state.workspaceNotes.byWorkspaceId[workspaceId] ?? emptyWorkspaceNotesState;

export const getNoteContentView = (
  state: WorkspaceNotesProjectionState,
  workspaceId: string,
  consumerId: string,
) =>
  getItem(
    state.workspaceNotes.byWorkspaceId[workspaceId]?.contentViews ??
      emptyWorkspaceNotesState.contentViews,
    consumerId,
  );

export const getNoteById = (
  state: WorkspaceNotesProjectionState,
  workspaceId: string | null | undefined,
  noteId: string | null | undefined,
): Note | undefined => {
  if (!workspaceId || !noteId) return undefined;
  const ws = state.workspaceNotes.byWorkspaceId[workspaceId];
  if (!ws) return undefined;
  return getItem(ws.notes, noteId as Note['id']);
};

export const getAllNotes = (
  state: WorkspaceNotesProjectionState,
  workspaceId?: string | null,
): Note[] => {
  if (!workspaceId) return [];
  const ws = state.workspaceNotes.byWorkspaceId[workspaceId];
  if (!ws) return [];
  return getItems(ws.notes);
};
