import { sameNoteScope, type NoteSplice } from '$lib/client/note-pages';
import {
  assertNoteTextDocumentSession,
  type NoteDocumentSession,
  type NoteTextDocumentSession,
} from './note-document-edit-session';
import { composeNoteEdits } from './note-edit-plan';
import {
  currentNoteNativeHistoryWitness,
  type NoteNativeHistoryWitness,
} from './note-native-history-witness';

export interface NoteDocumentSaveContinuationInput {
  readonly captured: NoteDocumentSession;
  readonly capturedWitness: NoteNativeHistoryWitness;
  readonly current: NoteDocumentSession;
  readonly currentWitness: NoteNativeHistoryWitness;
  /** The owner supplies independently validated receipt facts, not a submitted
   * operation echo. This helper does not authenticate or traverse receipts. */
  readonly receipt: {
    readonly generation: number;
    readonly baseRevision: string;
    readonly sourceRevision: string;
    readonly sourceLength: number;
    readonly exactLocalResult: boolean;
    readonly hasSourceEffects: boolean;
  };
  readonly authoritativeRevision: string;
}
const uint = (n: number) => Number.isSafeInteger(n) && n >= 0;
function fail(): never {
  throw new Error('Unsupported saved document continuation');
}
const fields = [
  'id',
  'beforeLength',
  'forward',
  'inverse',
  'forwardReplay',
  'inverseReplay',
] as const;
const same = (a: readonly NoteSplice[], b: readonly NoteSplice[]) =>
  a.length === b.length &&
  a.every((s, i) => s.start === b[i].start && s.end === b[i].end && s.text === b[i].text);
const compact = (splices: NoteSplice[]) =>
  splices.filter((s) => s.start !== s.end || s.text.length > 0);

/** Count actual JSON payload without stringify/toJSON callbacks or allocating a
 * document-sized string. Includes current selection wrappers ignored by source
 * witnesses. This is a logical bound, not a heap or DATA reservation claim. */
function withinBudget(limit: number, values: readonly unknown[]) {
  let bytes = 0,
    nodes = 0;
  const path = new Set<object>();
  const add = (n: number) => {
    bytes += n;
    if (bytes > limit) fail();
  };
  const text = (s: string) => {
    if (s.length > limit - bytes) fail();
    add(2);
    for (const c of s) {
      const n = c.codePointAt(0) ?? fail();
      add(
        n < 32
          ? [8, 9, 10, 12, 13].includes(n)
            ? 2
            : 6
          : n === 34 || n === 92
            ? 2
            : n < 128
              ? 1
              : n < 2048
                ? 2
                : n >= 0xd800 && n <= 0xdfff
                  ? 6
                  : n < 65536
                    ? 3
                    : 4,
      );
    }
  };
  const visit = (v: unknown, depth = 0): void => {
    if (++nodes > 32768 || depth > 12) fail();
    if (typeof v === 'string') return text(v);
    if (typeof v === 'number') {
      if (!Number.isSafeInteger(v)) fail();
      return add(String(v).length);
    }
    if (v === null || typeof v === 'boolean') return add(String(v).length);
    if (typeof v !== 'object' || path.has(v)) fail();
    const array = Array.isArray(v);
    if (Object.getPrototypeOf(v) !== (array ? Array.prototype : Object.prototype)) fail();
    if (array && v.length > 32768 - nodes) fail();
    path.add(v);
    add(2);
    let count = 0;
    for (const key in v) {
      if (!Object.hasOwn(v, key) || (array && key !== String(count))) fail();
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (!d || !('value' in d)) fail();
      if (count++) add(1);
      if (!array) {
        text(key);
        add(1);
      }
      visit(d.value, depth + 1);
    }
    if (array && count !== v.length) fail();
    path.delete(v);
  };
  for (const value of values) visit(value);
}

function selection(owner: object, key: string, length: number) {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail();
  const value: unknown = descriptor.value;
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
    fail();
  for (const name of ['anchor', 'head', 'anchorAffinity', 'headAffinity']) {
    const field = Object.getOwnPropertyDescriptor(value, name);
    if (!field || !field.enumerable || !('value' in field)) fail();
    if (name === 'anchor' || name === 'head') {
      if (!uint(field.value) || field.value > length) fail();
    } else if (field.value !== 1 && field.value !== -1) fail();
  }
}

/** Pure preparation for a narrowly supported later-edit save adoption. Both
 * witnesses must already be admitted/pinned by the owner; no new witness or
 * untouched source text is assembled. The caller still proves receipt ownership,
 * draft-fence/journal consistency, irreversible lifetime and atomic CAS/adoption.
 * Only the unchanged captured prefix and its later forward suffix are supported.
 * Endpoint witnesses do not describe every intermediate user action. */
export function prepareNoteDocumentSaveContinuation(
  input: NoteDocumentSaveContinuationInput,
): NoteDocumentSession {
  const { captured: a, capturedWitness: aw, current: b, currentWitness: bw, receipt: r } = input;
  assertNoteTextDocumentSession(a);
  assertNoteTextDocumentSession(b);
  if (!currentNoteNativeHistoryWitness(a, aw) || !currentNoteNativeHistoryWitness(b, bw)) fail();
  const s = a.cursor,
    c = b.cursor;
  if (
    s !== a.history.length ||
    c < s ||
    b.history.length < a.history.length ||
    !sameNoteScope(a.scope, b.scope) ||
    a.baseRevision !== b.baseRevision ||
    a.baseLength !== b.baseLength ||
    a.limits !== b.limits ||
    aw.suffixStart !== bw.suffixStart ||
    b.generation < a.generation ||
    !uint(b.generation + 1) ||
    r.exactLocalResult !== true ||
    r.hasSourceEffects !== false ||
    r.generation !== a.generation ||
    r.baseRevision !== a.baseRevision ||
    r.sourceLength !== a.length ||
    typeof r.sourceRevision !== 'string' ||
    !r.sourceRevision ||
    r.sourceRevision.length > 1024 ||
    r.sourceRevision.includes('\0') ||
    r.sourceRevision === a.baseRevision ||
    r.sourceRevision !== input.authoritativeRevision
  )
    fail();
  for (let i = 0; i < s; i++)
    for (const key of fields) if (a.history[i][key] !== b.history[i][key]) fail();
  if (b.history.length > s && b.generation <= a.generation) fail();
  for (let i = s; i < b.history.length; i++)
    if (b.history[i].id <= a.generation || b.history[i].id > b.generation) fail();
  // Source witnesses preserve their captured nested data. Charge/check the actual
  // current wrappers too, before composition, so selection-only replacements
  // cannot introduce an unbounded/accessor-bearing history object.
  selection(b, 'selection', b.length);
  for (const group of b.history) {
    selection(group, 'before', group.beforeLength);
    let after = group.beforeLength;
    for (const splice of group.forward) after += splice.text.length - splice.end + splice.start;
    if (!uint(after)) fail();
    selection(group, 'after', after);
  }
  withinBudget(b.limits.retainedBytes, [b.history, b.dirty, b.replay]);
  withinBudget(512, [b.selection]);
  const batches: Array<{ splices: readonly NoteSplice[] }> = [];
  const replay: NoteTextDocumentSession['replay'] = [];
  let length = a.length;
  for (let i = s; i < c; i++) {
    const g = b.history[i];
    if (g.beforeLength !== length) fail();
    batches.push({ splices: g.forward });
    replay.push({ id: g.id, direction: 'redo', edits: g.forwardReplay });
    for (const splice of g.forward) length += splice.text.length - splice.end + splice.start;
    if (!uint(length)) fail();
  }
  if (length !== b.length) fail();
  const old = compact(composeNoteEdits(a.baseLength, [{ splices: a.dirty }, ...batches]));
  if (!same(old, b.dirty)) fail();
  // The witnesses validated original-base q→cursor replay aliases at capture;
  // current() above guarantees those exact arrays/primitives remain unchanged.
  // Requiring the same q excludes a silently changed saved-base replay origin.
  const dirty = compact(composeNoteEdits(a.length, batches));
  const count =
    b.history.reduce((n, g) => n + g.forward.length + g.inverse.length, 0) +
    dirty.length +
    replay.reduce((n, g) => n + g.edits.length, 0);
  if (count > b.limits.splices) fail();
  withinBudget(b.limits.retainedBytes, [b.history, dirty, replay]);
  return {
    ...b,
    baseRevision: r.sourceRevision,
    baseLength: a.length,
    dirty,
    replay,
    generation: b.generation + 1,
  };
}
