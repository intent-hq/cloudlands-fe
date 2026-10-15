import { store } from '@/store';
import { notesWriteClient } from '@/features/notes/notes-write-client';
import { createNotesWriteSaga } from '../../../../../../src/store/renderer/slices/workspace-notes/sagas/notes-write-saga-factory';
import { selectNoteById } from '../workspace-notes-selectors';
import {
  selectExplicitNoteEditor,
  selectExplicitNoteEditorCurrent,
  selectExplicitNoteSaveOperations,
  selectNoteEditAuthority,
  selectNoteEditContext,
  selectNoteWriteReady,
} from '../note-edit-selectors';

export const notesWriteSaga = createNotesWriteSaga({
  notes: notesWriteClient,
  selectNoteById,
  explicit: {
    selectEditor: selectExplicitNoteEditor,
    selectOperations: selectExplicitNoteSaveOperations,
    isCurrent: (identity) =>
      selectExplicitNoteEditorCurrent.select(store.state, identity) &&
      selectNoteWriteReady.select(store.state, identity.workspaceId, identity.noteId) &&
      selectNoteEditAuthority.select(store.state, identity.workspaceId, identity.noteId) ===
        identity.authority &&
      selectNoteEditContext.select(store.state, identity.workspaceId, identity.noteId) ===
        identity.context,
    canPublish: (identity) =>
      selectNoteEditAuthority.select(store.state, identity.workspaceId, identity.noteId) ===
      identity.authority,
    dispatch: (action) => store.dispatch(action),
  },
});
