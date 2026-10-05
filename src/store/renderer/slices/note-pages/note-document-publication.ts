import type { NoteDocumentSession } from '$features/notes/virtualized/editing/note-document-edit-session';
import { sameNoteScope, type NoteSplice } from '$lib/client/note-pages';
import type { NoteDraft, NotePageSession } from './note-pages-types';

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
