import { currentNoteNativeHistoryWitness } from '$features/notes/virtualized/editing/note-native-history-witness';
import type { NoteDocumentSession } from '$features/notes/virtualized/editing/note-document-edit-session';
import {
  sameNoteScope,
  type NoteSpliceOperation,
  type NoteStagedSaveOperation,
  type NoteSplice,
} from '$lib/client/note-pages';
import type { NoteDraft, NotePageSession, NoteDocumentSaveCapture } from './note-pages-types';

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const selection = (s: NoteDocumentSession['selection']): NoteDraft['selection'] => ({
  anchor: s.anchor,
  head: s.head,
  anchorAffinity: s.anchorAffinity < 0 ? 'before' : 'after',
  headAffinity: s.headAffinity < 0 ? 'before' : 'after',
});

/** Pure admission shared by native preparation and atomic Redux publication.
 * This journal has its own logical payload bound, separate from core history.
 * Reserve every remaining undo draft before allowing the next forward edit.
 * No source, native objects or complete document hydration is required. */
export function prepareNoteDocumentPublication(
  note: NotePageSession,
  before: NoteDocumentSession,
  after: NoteDocumentSession,
  splices: NoteSplice[],
  limit = { bytes: 262144, records: 512 },
): { draft: NoteDraft | null } | undefined {
  if (
    note.document !== before ||
    note.status !== 'ready' ||
    note.needsReconcile ||
    !note.state ||
    !sameNoteScope(note.state.scope, before.scope) ||
    !sameNoteScope(after.scope, before.scope) ||
    note.state.sourceRevision !== before.baseRevision ||
    after.baseRevision !== before.baseRevision ||
    after.baseLength !== before.baseLength ||
    !Number.isSafeInteger(after.generation) ||
    after.generation < before.generation ||
    (splices.length > 0 && after.generation === before.generation) ||
    !Number.isSafeInteger(after.cursor) ||
    after.cursor < 0 ||
    after.cursor > after.history.length ||
    after.length !==
      before.length + splices.reduce((n, s) => n + s.text.length - s.end + s.start, 0)
  )
    return undefined;
  const sequence = (note.history.at(-1)?.sequence ?? 0) + 1;
  if (!Number.isSafeInteger(sequence)) return undefined;
  const draft: NoteDraft | null = splices.length
    ? {
        scope: after.scope,
        sequence,
        baseRevision: after.baseRevision,
        splices,
        selection: selection(after.selection),
      }
    : null;
  const drafts = draft ? [...note.drafts, draft] : note.drafts;
  if (
    drafts.length + after.cursor + 1 > limit.records ||
    !Number.isSafeInteger(sequence + after.cursor)
  )
    return undefined;
  let held = bytes(drafts);
  let checkpoint = bytes(draft ?? note.history.at(-1) ?? null);
  for (let i = 0; i < after.cursor; i++) {
    const entry = after.history[i];
    if (!entry) return undefined;
    const undoBytes = bytes({
      scope: after.scope,
      sequence: Number.MAX_SAFE_INTEGER,
      baseRevision: after.baseRevision,
      splices: entry.inverse,
      selection: selection(entry.before),
    } satisfies NoteDraft);
    // Each future append adds one comma to the retained JSON array. The largest
    // possible undo checkpoint replaces, rather than accumulates with, this one.
    held += undoBytes + 1;
    checkpoint = Math.max(checkpoint, undoBytes);
    if (held + checkpoint > limit.bytes) return undefined;
  }
  return held + checkpoint <= limit.bytes ? { draft } : undefined;
}

/** Capture only an exact whole dirty document prefix. A save of an earlier prefix
 * is still legal, but it requires the general later-edit rebase, not this token. */
export function captureNoteDocumentSave(
  note: NotePageSession,
  operation: NoteSpliceOperation | NoteStagedSaveOperation,
  throughSequence: number,
):
  | { operation: NoteSpliceOperation | NoteStagedSaveOperation; document: NoteDocumentSaveCapture }
  | undefined {
  const doc = note.document;
  const staged = 'headerDigest' in operation;
  if (staged && (!doc || !currentNoteNativeHistoryWitness(doc, operation.nativeWitness)))
    return undefined;
  if (
    staged &&
    (!doc ||
      operation.documentGeneration !== doc.generation ||
      operation.documentCursor !== doc.cursor ||
      operation.baseLength !== doc.baseLength ||
      operation.viewLength !== doc.length ||
      operation.splices !== doc.dirty ||
      !/^[0-9a-f]{64}$/.test(operation.headerDigest))
  )
    return undefined;
  if (
    !doc ||
    ![doc.generation, doc.baseLength, doc.length, doc.cursor, throughSequence].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) ||
    doc.cursor > doc.history.length ||
    !sameNoteScope(doc.scope, operation.scope) ||
    doc.baseRevision !== operation.baseRevision ||
    note.drafts.length === 0 ||
    note.drafts.at(-1)?.sequence !== throughSequence ||
    operation.splices.length === 0 ||
    operation.splices.length > (staged ? 512 : 32) ||
    operation.splices.length !== doc.dirty.length ||
    !/^[0-9a-f]{64}$/.test(operation.payloadDigest) ||
    operation.splices.some(
      (s, i) =>
        s.start !== doc.dirty[i].start ||
        s.end !== doc.dirty[i].end ||
        s.text !== doc.dirty[i].text,
    )
  )
    return undefined;
  let textBytes = 0;
  for (const s of operation.splices) {
    textBytes += new TextEncoder().encode(s.text).length;
    if (textBytes > (staged ? 262144 : 16_384)) return undefined;
  }
  const captured = staged
    ? operation
    : Object.freeze({
        ...operation,
        scope: Object.freeze({ ...operation.scope }),
        splices: operation.splices.map((s) =>
          Object.freeze({ start: s.start, end: s.end, text: s.text }),
        ),
      });
  Object.freeze(captured.splices);
  return {
    operation: captured,
    document: {
      generation: doc.generation,
      baseLength: doc.baseLength,
      length: doc.length,
      cursor: doc.cursor,
      throughSequence,
    },
  };
}

/** Re-evaluated throughout receipt IO and at the atomic reducer boundary. Content
 * identity is separate from selection: navigation may update selection/history.after. */
export function currentNoteDocumentSave(
  note: NotePageSession | undefined,
  capture: NonNullable<NotePageSession['committedDocumentSave']>,
): boolean {
  const doc = note?.document;
  const { operation, document: saved, receipt } = capture;
  return !!(
    note &&
    doc &&
    note.committedDocumentSave === capture &&
    note.status === 'ready' &&
    note.needsReconcile &&
    !note.pending &&
    !note.drafts.length &&
    Object.keys(note.panels).length &&
    note.state &&
    !note.state.deleted &&
    note.receipts.includes(receipt) &&
    sameNoteScope(note.state.scope, operation.scope) &&
    sameNoteScope(doc.scope, operation.scope) &&
    sameNoteScope(receipt.scope, operation.scope) &&
    note.state.sourceRevision === receipt.afterRevision &&
    receipt.beforeRevision === operation.baseRevision &&
    doc.baseRevision === operation.baseRevision &&
    receipt.operationId === operation.operationId &&
    receipt.payloadDigest === operation.payloadDigest &&
    (!('headerDigest' in operation) ||
      currentNoteNativeHistoryWitness(doc, operation.nativeWitness)) &&
    doc.generation === saved.generation &&
    Number.isSafeInteger(doc.generation + 1) &&
    doc.baseLength === saved.baseLength &&
    doc.length === saved.length &&
    doc.length === receipt.sourceLength &&
    doc.cursor === saved.cursor &&
    note.history.length === 1 &&
    note.history[0].sequence === saved.throughSequence &&
    note.history[0].baseRevision === operation.baseRevision &&
    sameNoteScope(note.history[0].scope, operation.scope) &&
    doc.dirty.length === operation.splices.length &&
    doc.dirty.every(
      (s, i) =>
        s.start === operation.splices[i].start &&
        s.end === operation.splices[i].end &&
        s.text === operation.splices[i].text,
    )
  );
}
