import { createNotesContentReadSaga } from '../../../../../../src/store/renderer/slices/workspace-notes/sagas/notes-content-read-saga-factory';
import { createLogger } from '$lib/utils/client-logger';
import { notesReadClient } from '@/features/notes/notes-read-client';
import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import { selectWorkspaceNotesState, selectNoteById } from '../workspace-notes-selectors';

/** Root-owned read lifetime; no mutation, presence, search, or comment watchers. */
export const notesContentReadSaga = createNotesContentReadSaga({
  notes: notesReadClient,
  selectPrincipalConnectionContext,
  selectWorkspaceNotesState,
  selectNoteById,
  logger: createLogger('NotesReadSaga'),
});
