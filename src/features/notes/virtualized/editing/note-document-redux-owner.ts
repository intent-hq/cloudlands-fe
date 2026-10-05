import type { NotePageSession } from '$store/renderer/slices/note-pages/note-pages-types';
import {
  pageDocumentPublished,
  pageDocumentSelectionChanged,
} from '$store/renderer/slices/note-pages/note-pages-slice';
import { prepareNoteDocumentPublication } from '$store/renderer/slices/note-pages/note-document-publication';
import type { NoteDocumentSession } from './note-document-edit-session';
import type { NoteEditAuthority } from './note-edit-authority';
import { createNoteDocumentTransactionOwner } from './note-document-transaction-owner';

/** Bind only an already-resolved canonical window to its current Redux owner.
 * No page traversal, save, source hydration or native work runs in the reducer. */
export function createReduxNoteDocumentOwner(
  base: NoteEditAuthority,
  read: () => NotePageSession | undefined,
  dispatch: (
    action:
      ReturnType<typeof pageDocumentPublished> | ReturnType<typeof pageDocumentSelectionChanged>,
  ) => void,
) {
  const captured = read();
  if (!captured?.document) throw new Error('Missing Redux note document');
  const generation = captured.generation;
  const { workspaceId, noteId } = captured.document.scope;
  const current = () => {
    const note = read();
    return note?.generation === generation &&
      note.status === 'ready' &&
      !note.needsReconcile &&
      note.state?.sourceRevision === note.document?.baseRevision
      ? note
      : undefined;
  };
  const owner = createNoteDocumentTransactionOwner(
    base,
    () => current()?.document,
    (before, after, splices) =>
      dispatch(pageDocumentPublished(workspaceId, noteId, generation, before, after, splices)),
    (before, after, splices) => {
      const note = current();
      return !!note && !!prepareNoteDocumentPublication(note, before, after, splices);
    },
  );
  return {
    ...owner,
    select(selection: NoteDocumentSession['selection']) {
      const before = current()?.document;
      if (!before || !owner.current()) return;
      dispatch(pageDocumentSelectionChanged(workspaceId, noteId, generation, before, selection));
    },
  };
}
