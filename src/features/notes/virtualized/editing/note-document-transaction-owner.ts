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
  admit: (
    before: NoteDocumentSession,
    after: NoteDocumentSession,
    splices: NoteSplice[],
  ) => boolean = () => true,
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
  // A selection-only Redux publication preserves all content/history identities.
  // Accept it for the next root, but never change a plan's captured origin during
  // native application: finalization still compares that exact object.
  const sameContent = (state: NoteDocumentSession | undefined) =>
    !!state &&
    state.scope === committed.scope &&
    state.baseRevision === committed.baseRevision &&
    state.baseLength === committed.baseLength &&
    state.length === committed.length &&
    state.generation === committed.generation &&
    state.history === committed.history &&
    state.cursor === committed.cursor &&
    state.dirty === committed.dirty &&
    state.replay === committed.replay &&
    state.limits === committed.limits;
  const current = () => sameContent(read());
  return {
    initial,
    current,
    prepare(transaction, before) {
      const prior = candidates.get(before);
      if (!prior || !current()) return undefined;
      const root = prior.state === committed;
      const origin = root ? read()! : prior.origin;
      const next = prepareNoteDocumentEdit(
        root ? origin : prior.state,
        transaction,
        prior.authority,
        root ? {} : { appendTo: prior.group },
      );
      const batches = [...(root ? [] : prior.batches), { splices: next.splices }];
      const splices = composeNoteEdits(origin.length, batches);
      if (!admit(origin, next.state, splices)) return undefined;
      const candidate = { doc: next.authority.doc, projection: next.authority };
      candidates.set(candidate, {
        origin,
        state: next.state,
        authority: next.authority,
        group: next.historyGroup,
        batches,
        splices,
      });
      return candidate;
    },
    finalize(after, selection) {
      const prepared = candidates.get(after);
      if (!prepared || prepared.origin !== read() || !current()) return undefined;
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
      if (!admit(prepared.origin, final.state, prepared.splices)) return undefined;
      // Selection/history metadata may change; native content and its map cannot.
      const candidate = { doc: after.doc, projection: after.projection };
      candidates.set(candidate, { ...prepared, state: final.state });
      return candidate;
    },
    commit({ after }) {
      const prepared = candidates.get(after);
      if (!prepared || prepared.origin !== read() || !current())
        throw new Error('Lost prepared note adoption');
      publish(prepared.origin, prepared.state, prepared.splices);
      if (read() !== prepared.state) throw new Error('Note document adoption was not acknowledged');
      committed = prepared.state;
    },
  };
}
