import { EditorState, Selection } from '@tiptap/pm/state';
import type { NoteSplice } from '$lib/client/note-pages';
import type { NoteTransactionOwner } from '../note-transaction-relay';
import type { NoteEditAuthority } from './note-edit-authority';
import { composeNoteEdits } from './note-edit-plan';
import {
  materializeNoteDocumentAuthority,
  prepareNoteDocumentEdit,
  type NoteDocumentSession,
} from './note-document-edit-session';

type Candidate = NoteTransactionOwner['initial'];
interface Prepared {
  origin: NoteDocumentSession;
  state: NoteDocumentSession;
  authority: NoteEditAuthority;
  group?: number;
  batches: { splices: NoteSplice[] }[];
  splices: NoteSplice[];
}

/** Runtime bridge only. The caller reads the current Redux document session and
 * atomically publishes the accepted session and its chronological draft batch.
 * No native object, callback, or provisional candidate belongs in Redux. */
export function createNoteDocumentTransactionOwner(
  base: NoteEditAuthority,
  read: () => NoteDocumentSession | undefined,
  publish: (before: NoteDocumentSession, after: NoteDocumentSession, splices: NoteSplice[]) => void,
): NoteTransactionOwner {
  const original = read();
  if (!original) throw new Error('Missing note document session');
  const authority = materializeNoteDocumentAuthority(original, base);
  let committed = original;
  const initial = { doc: authority.doc, projection: authority };
  const candidates = new WeakMap<Candidate, Prepared>();
  candidates.set(initial, {
    origin: original,
    state: original,
    authority,
    batches: [],
    splices: [],
  });
  const current = () => read() === committed;
  return {
    initial,
    current,
    prepare(transaction, before) {
      const prior = candidates.get(before);
      if (!prior || !current()) return undefined;
      const root = prior.state === committed;
      const origin = root ? committed : prior.origin;
      const next = prepareNoteDocumentEdit(
        prior.state,
        transaction,
        prior.authority,
        root ? {} : { appendTo: prior.group },
      );
      const batches = [...(root ? [] : prior.batches), { splices: next.splices }];
      const candidate = { doc: next.authority.doc, projection: next.authority };
      candidates.set(candidate, {
        origin,
        state: next.state,
        authority: next.authority,
        group: next.historyGroup,
        batches,
        splices: composeNoteEdits(origin.length, batches),
      });
      return candidate;
    },
    finalize(after, selection) {
      const prepared = candidates.get(after);
      if (!prepared || prepared.origin !== committed || !current()) return undefined;
      // Native application and pure step preparation can produce equivalent,
      // distinct PM documents. Resolve the final selection against this exact doc.
      const transaction = EditorState.create({ doc: after.doc }).tr.setSelection(
        Selection.fromJSON(after.doc, selection.toJSON()),
      );
      const final = prepareNoteDocumentEdit(
        prepared.state,
        transaction,
        prepared.authority,
        prepared.group === undefined ? {} : { appendTo: prepared.group },
      );
      // Selection/history metadata may change; native content and its map cannot.
      const candidate = { doc: after.doc, projection: after.projection };
      candidates.set(candidate, { ...prepared, state: final.state });
      return candidate;
    },
    commit({ after }) {
      const prepared = candidates.get(after);
      if (!prepared || prepared.origin !== committed || !current())
        throw new Error('Lost prepared note adoption');
      publish(prepared.origin, prepared.state, prepared.splices);
      if (read() !== prepared.state) throw new Error('Note document adoption was not acknowledged');
      committed = prepared.state;
    },
  };
}
