import { store } from '@/store';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import { selectWorkspaceNotesState } from '@/store/workspace-notes/workspace-notes-selectors';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { ContentType } from '$shared/types';
import { SPEC_NOTE_ID } from '$shared/constants/notes';
import { prepareNoteContext } from '$lib/components/chat/chat-note-context';
import type { ContextItem } from '$lib/components/chat/input/context-item';

/** Metadata comes from the admitted notes owner; selecting context never reads note bodies. */
export const selectAvailableContextNotes = store.createSelector((state, workspaceId: string) => {
  const notes = selectWorkspaceNotesState.select(state, workspaceId);
  if (
    !selectAdmittedWorkspaceReadContext.select(state, workspaceId) ||
    !notes.initialized ||
    notes.loading ||
    notes.error
  )
    return [];
  return getItems(notes.notes).filter(
    (note) =>
      note.workspaceId === workspaceId &&
      note.id !== SPEC_NOTE_ID &&
      !note.isDefault &&
      !note.metadata?.task &&
      !note.isArchived &&
      note.contentType === ContentType.Markdown,
  );
});

export const selectNoteContextValid = store.createSelector(
  (state, workspaceId: string, items: readonly ContextItem[]) => {
    const context = prepareNoteContext(workspaceId, items);
    if (!context.ok) return false;
    if (!context.noteIds.length) return true;
    const notes = selectAvailableContextNotes.select(state, workspaceId);
    return context.noteIds.every((id) => notes.some((note) => note.id === id));
  },
);
