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

import {
  selectNoteCreateAuthority,
  selectNoteCreateContext,
  selectExplicitNoteCreator,
  selectExplicitNoteCreatorCurrent,
  selectExplicitNoteCreateOperations,
} from '../note-create-selectors';

export const notesWriteSaga = createNotesWriteSaga({
  notes: notesWriteClient,
  selectNoteById,
  creation: {
    notes: notesWriteClient,
    selectCreator: selectExplicitNoteCreator,
    selectOperations: selectExplicitNoteCreateOperations,
    isCurrent: (identity) =>
      selectExplicitNoteCreatorCurrent.select(store.state, identity) &&
      selectNoteCreateAuthority.select(store.state, identity.workspaceId) === identity.authority &&
      selectNoteCreateContext.select(store.state, identity.workspaceId) === identity.context,
    canPublish: (identity) =>
      selectNoteCreateAuthority.select(store.state, identity.workspaceId) === identity.authority &&
      selectNoteCreateContext.select(store.state, identity.workspaceId) === identity.context,
    dispatch: (action) => store.dispatch(action),
  },
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
