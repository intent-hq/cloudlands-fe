import type { NotePageSession } from '$store/renderer/slices/note-pages/note-pages-types';
import {
  pageDocumentPublished,
  pageDocumentSelectionChanged,
} from '$store/renderer/slices/note-pages/note-pages-slice';
import { prepareNoteDocumentPublication } from '$store/renderer/slices/note-pages/note-document-publication';
import type { NoteTransactionOwner } from '../note-transaction-relay';
import { noteDocumentCoordinates } from './note-document-coordinates';
import {
  materializeNoteDocumentAuthority,
  moveNoteDocumentHistory,
} from './note-document-edit-session';
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
): NoteTransactionOwner & { select(selection: NoteDocumentSession['selection']): void } {
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
    history(direction) {
      const note = current(),
        before = note?.document;
      if (!note || !before || !owner.current()) return undefined;
      const prepared = moveNoteDocumentHistory(before, direction);
      if (
        !prepared ||
        !prepareNoteDocumentPublication(note, before, prepared.state, prepared.splices)
      )
        return undefined;
      let published = false;
      const authority = materializeNoteDocumentAuthority(prepared.state, base);
      const eligible = () => {
        const latest = current();
        return (
          !published &&
          latest?.document === before &&
          owner.current() &&
          !!prepareNoteDocumentPublication(latest, before, prepared.state, prepared.splices)
        );
      };
      return {
        initial: {
          doc: authority.doc,
          projection: authority,
          coordinates: noteDocumentCoordinates(prepared.state, authority),
        },
        adopted: () => published && current()?.document === prepared.state,
        selection: { ...prepared.state.selection },
        current: eligible,
        commit() {
          if (!eligible()) throw new Error('Stale note history adoption');
          dispatch(
            pageDocumentPublished(
              workspaceId,
              noteId,
              generation,
              before,
              prepared.state,
              prepared.splices,
            ),
          );
          published = true;
          if (read()?.document !== prepared.state)
            throw new Error('Note history adoption was not acknowledged');
        },
      };
    },
    select(selection: NoteDocumentSession['selection']) {
      const before = current()?.document;
      if (!before || !owner.current()) return;
      dispatch(pageDocumentSelectionChanged(workspaceId, noteId, generation, before, selection));
    },
  };
}
