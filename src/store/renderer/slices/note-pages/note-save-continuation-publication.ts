import type { NoteNativeHistoryWitness } from '$features/notes/virtualized/editing/note-native-history-witness';
import { currentNoteNativeHistoryWitness } from '$features/notes/virtualized/editing/note-native-history-witness';
import { noteStagedSaveContinuity } from '$features/notes/virtualized/editing/note-staged-save-continuity';
import { prepareNoteDocumentSaveContinuation } from '$features/notes/virtualized/editing/note-document-save-continuation';
import { composeNoteEdits } from '$features/notes/virtualized/editing/note-edit-plan';
import { sameNoteScope } from '$lib/client/note-pages';
import type { NoteDocumentSession } from '$features/notes/virtualized/editing/note-document-edit-session';
import type { NoteDraft, NotePageSession } from './note-pages-types';

type Capture = NonNullable<NotePageSession['committedDocumentSave']>;
export interface NoteSaveContinuation {
  before: NoteDocumentSession;
  witness: NoteNativeHistoryWitness;
  owner: string;
  drafts: NoteDraft[];
  history: NoteDraft[];
}

/** Receipt identity and observed owner path, before allocating a current witness.
 * No proof of source equivalence is granted here. */
export function currentNoteSaveContinuation(note: NotePageSession | undefined, capture: Capture) {
  const operation = capture.operation;
  if (!note || !('headerDigest' in operation)) return undefined;
  const continuity = noteStagedSaveContinuity(operation, note);
  if (!continuity) return undefined;
  const doc = note.document,
    receipt = capture.receipt,
    saved = continuity.captured;
  if (
    !doc ||
    note.committedDocumentSave !== capture ||
    note.status !== 'ready' ||
    !note.needsReconcile ||
    note.pending ||
    !note.state ||
    note.state.deleted ||
    note.state.sourceRevision !== receipt.afterRevision ||
    !note.receipts.includes(receipt) ||
    !sameNoteScope(note.state.scope, operation.scope) ||
    !sameNoteScope(receipt.scope, operation.scope) ||
    receipt.beforeRevision !== operation.baseRevision ||
    receipt.operationId !== operation.operationId ||
    receipt.payloadDigest !== operation.payloadDigest ||
    receipt.headerDigest !== operation.headerDigest ||
    !receipt.viewId ||
    receipt.sourceLength !== saved.length ||
    saved.generation !== capture.document.generation ||
    saved.cursor !== capture.document.cursor ||
    saved.baseLength !== capture.document.baseLength ||
    saved.length !== capture.document.length ||
    note.drafts.length > 512 ||
    note.history.length !== 1
  )
    return undefined;
  return continuity;
}

/** Called at the reducer CAS after complete receipt proof. Recompose actual later
 * transaction drafts, never acknowledge a fictitious sequence or flatten native
 * history. The helper preserves redo groups and current directional selection. */
export function prepareNoteSaveContinuationPublication(
  note: NotePageSession,
  capture: Capture,
  retained: NoteSaveContinuation,
) {
  const continuity = currentNoteSaveContinuation(note, capture);
  const operation = capture.operation;
  const doc = note.document;
  if (
    !continuity ||
    !doc ||
    !('headerDigest' in operation) ||
    note.drafts !== retained.drafts ||
    note.history !== retained.history ||
    !currentNoteNativeHistoryWitness(doc, retained.witness)
  )
    return undefined;
  let sequence = capture.document.throughSequence;
  let records = 0,
    units = 0;
  for (const draft of note.drafts) {
    if (
      !Number.isSafeInteger(draft.sequence) ||
      draft.sequence <= sequence ||
      draft.baseRevision !== operation.baseRevision ||
      !sameNoteScope(draft.scope, operation.scope)
    )
      return undefined;
    sequence = draft.sequence;
    records += draft.splices.length;
    for (const splice of draft.splices) units += splice.text.length;
    if (records > 2048 || units > 262144) return undefined;
  }
  if (
    note.history[0].sequence !== sequence ||
    note.history[0].baseRevision !== operation.baseRevision ||
    !sameNoteScope(note.history[0].scope, operation.scope)
  )
    return undefined;
  const document = prepareNoteDocumentSaveContinuation({
    captured: continuity.captured,
    capturedWitness: operation.nativeWitness,
    current: doc,
    currentWitness: retained.witness,
    authoritativeRevision: note.state!.sourceRevision,
    receipt: {
      baseRevision: capture.receipt.beforeRevision,
      sourceRevision: capture.receipt.afterRevision,
      sourceLength: capture.receipt.sourceLength,
      exactLocalResult: true,
      generation: continuity.captured.generation,
      hasSourceEffects: false,
    },
  });
  const composed = composeNoteEdits(continuity.captured.length, note.drafts).filter(
    (s) => s.start !== s.end || s.text.length,
  );
  if (
    composed.length !== document.dirty.length ||
    composed.some((s, i) => {
      const expected = document.dirty[i];
      return s.start !== expected.start || s.end !== expected.end || s.text !== expected.text;
    })
  )
    return undefined;
  return {
    document,
    drafts: note.drafts.map((draft) => ({ ...draft, baseRevision: document.baseRevision })),
    history: [
      {
        ...note.history[0],
        baseRevision: document.baseRevision,
        splices: note.drafts.at(-1)?.splices ?? [],
        selection: {
          anchor: document.selection.anchor,
          head: document.selection.head,
          anchorAffinity:
            document.selection.anchorAffinity < 0 ? ('before' as const) : ('after' as const),
          headAffinity:
            document.selection.headAffinity < 0 ? ('before' as const) : ('after' as const),
        },
      },
    ],
  };
}
