import { sameNoteScope } from '$lib/client/note-pages';
import type { NoteDocumentSession } from './note-document-edit-session';
import { composeNoteEdits } from './note-edit-plan';

type ReadonlyTree<T> = T extends object ? { readonly [K in keyof T]: ReadonlyTree<T[K]> } : T;
type Entry = NoteDocumentSession['history'][number];
type SourceGroup = Pick<
  Entry,
  'id' | 'beforeLength' | 'forward' | 'inverse' | 'forwardReplay' | 'inverseReplay'
>;
export interface NoteNativeHistoryWitness {
  readonly scope: Readonly<NoteDocumentSession['scope']>;
  readonly baseRevision: string;
  readonly baseLength: number;
  readonly length: number;
  readonly generation: number;
  readonly cursor: number;
  readonly suffixStart: number;
  readonly nativeFence: number;
  readonly groups: readonly ReadonlyTree<SourceGroup>[];
}
type Reference = { object: object; fields: Array<readonly [string, unknown]> };
type Held = {
  references: Reference[];
  dirty: NoteDocumentSession['dirty'];
  replay: NoteDocumentSession['replay'];
  limits: NoteDocumentSession['limits'];
};
const held = new WeakMap<NoteNativeHistoryWitness, Held>();
const uint = (n: number) => Number.isSafeInteger(n) && n >= 0;
function fail(): never {
  throw new Error('Unsupported native history witness');
}
const groupFields = [
  'id',
  'beforeLength',
  'forward',
  'inverse',
  'forwardReplay',
  'inverseReplay',
] as const;
const documentFields = [
  'scope',
  'baseRevision',
  'baseLength',
  'length',
  'generation',
  'cursor',
  'history',
  'dirty',
  'replay',
  'limits',
] as const;
const arrayMethods = [Symbol.iterator, 'map', 'reduce', 'slice', 'filter', 'every'];
const plainArray = (value: object) =>
  Object.getPrototypeOf(value) === Array.prototype &&
  !arrayMethods.some((key) => Object.hasOwn(value, key));
/** Check fixed semantic keys, never enumerate an unbounded hidden-key set.
 * Unknown hidden metadata supplies no authority; fields consumed by the core
 * must be ordinary enumerable data properties before they are read. */
function dataFields(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
    fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail();
  }
}

function sourceFields(doc: NoteDocumentSession) {
  const splice = (s: unknown) => dataFields(s, ['start', 'end', 'text']);
  const replay = (edits: Entry['forwardReplay']) => {
    if (!Array.isArray(edits)) fail();
    for (const edit of edits) {
      dataFields(edit, ['splice', 'before', 'tokens']);
      splice(edit.splice);
      if (!Array.isArray(edit.tokens)) fail();
      for (const token of edit.tokens) dataFields(token, ['pm', 'start', 'end', 'text']);
    }
  };
  // AFTER the bounded scan of array slots/accessors/total values. These fixed
  // field checks cover semantically consumed properties for...in would omit.
  for (const group of doc.history) {
    dataFields(group, [...groupFields, 'before', 'after']);
    for (const selection of [group.before, group.after])
      dataFields(selection, ['anchor', 'head', 'anchorAffinity', 'headAffinity']);
    for (const batch of [group.forward, group.inverse]) {
      if (!Array.isArray(batch)) fail();
      for (const s of batch) splice(s);
    }
    replay(group.forwardReplay);
    replay(group.inverseReplay);
  }
  for (const s of doc.dirty) splice(s);
  for (const item of doc.replay) {
    dataFields(item, ['id', 'direction', 'edits']);
    replay(item.edits);
  }
}

/** Bounded traversal of plain domain data. No JSON serialization or text copies.
 * Bytes count JSON UTF8 payload, not heap usage. The owner must reserve DATA for
 * reference/field bookkeeping too (at most 32768 visited values, depth 12).
 * Accessors, cycles, sparse arrays and non-plain objects are unsupported. */
function scanner(byteLimit: number) {
  let bytes = 0,
    values = 0;
  const path = new Set<object>();
  const add = (n: number) => {
    bytes += n;
    if (bytes > byteLimit) fail();
  };
  const string = (s: string) => {
    // Every UTF16 unit costs at least one JSON UTF8 byte; refuse before traversal.
    if (s.length > byteLimit - bytes) fail();
    add(2);
    for (const c of s) {
      const cp = c.codePointAt(0) ?? fail();
      add(
        cp < 32
          ? [8, 9, 10, 12, 13].includes(cp)
            ? 2
            : 6
          : cp === 34 || cp === 92
            ? 2
            : cp < 128
              ? 1
              : cp < 2048
                ? 2
                : cp >= 0xd800 && cp <= 0xdfff
                  ? 6
                  : cp < 65536
                    ? 3
                    : 4,
      );
    }
  };
  const visit = (value: unknown, refs?: Reference[], depth = 0): void => {
    if (++values > 32768 || depth > 12) fail();
    if (typeof value === 'string') return string(value);
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) fail();
      return add(String(value).length);
    }
    if (value === null || typeof value === 'boolean') return add(String(value).length);
    if (typeof value !== 'object' || path.has(value)) fail();
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype) fail();
    if (array && !plainArray(value)) fail();
    if (array && value.length > 32768 - values) fail();
    path.add(value);
    const snapshot: Reference = { object: value, fields: [] };
    let count = 0;
    add(2);
    for (const key in value) {
      if (!Object.hasOwn(value, key)) fail();
      if (array && key !== String(count)) fail();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) fail();
      if (count++) add(1);
      if (!array) {
        string(key);
        add(1);
      }
      if (refs) snapshot.fields.push([key, descriptor.value]);
      visit(descriptor.value, refs, depth + 1);
    }
    if (array && count !== value.length) fail();
    if (refs) {
      if (array) snapshot.fields.push(['length', value.length]);
      refs.push(snapshot);
    }
    path.delete(value);
  };
  return visit;
}

const sourceGroup = (g: Entry): SourceGroup => ({
  id: g.id,
  beforeLength: g.beforeLength,
  forward: g.forward,
  inverse: g.inverse,
  forwardReplay: g.forwardReplay,
  inverseReplay: g.inverseReplay,
});
const sameSplices = (a: NoteDocumentSession['dirty'], b: NoteDocumentSession['dirty']) =>
  a.length === b.length &&
  a.every((s, i) => s.start === b[i].start && s.end === b[i].end && s.text === b[i].text);

/** Capture only trusted owner-produced session state, AFTER resource admission.
 * This witnesses continuity of existing native provenance, not its creation.
 * It neither authorizes a receipt nor reconstructs PM authority from source.
 * The caller owns lifetime/release; retain this only while the DATA owner is live. */
export function captureNoteNativeHistoryWitness(
  doc: NoteDocumentSession,
): NoteNativeHistoryWitness {
  dataFields(doc, documentFields);
  dataFields(doc.scope, ['backendId', 'workspaceId', 'noteId', 'noteInstanceId']);
  dataFields(doc.limits, [
    'retainedBytes',
    'historyEntries',
    'splices',
    'transactionSteps',
    'windowBytes',
  ]);
  if (
    !Array.isArray(doc.history) ||
    !plainArray(doc.history) ||
    !Array.isArray(doc.dirty) ||
    !Array.isArray(doc.replay) ||
    ![doc.baseLength, doc.length, doc.generation, doc.cursor].every(uint) ||
    !uint(doc.limits.retainedBytes) ||
    doc.limits.retainedBytes > 262144 ||
    !uint(doc.limits.historyEntries) ||
    doc.limits.historyEntries > 256 ||
    !uint(doc.limits.splices) ||
    doc.limits.splices > 2048 ||
    !doc.baseRevision ||
    doc.history.length > doc.limits.historyEntries ||
    doc.cursor > doc.history.length ||
    !doc.replay.length ||
    doc.replay.length > doc.cursor ||
    !doc.dirty.length
  )
    fail();
  // Admit the ENTIRE retained history, including old saved groups and redo, before
  // composition/snapshot allocations. Selection is charged but never witnessed.
  scanner(doc.limits.retainedBytes)([doc.scope, doc.history, doc.dirty, doc.replay, doc.limits]);
  sourceFields(doc);
  if (
    doc.history.reduce((n, g) => n + g.forward.length + g.inverse.length, 0) +
      doc.dirty.length +
      doc.replay.reduce((n, r) => n + r.edits.length, 0) >
    doc.limits.splices
  )
    fail();
  const suffixStart = doc.cursor - doc.replay.length;
  let length = doc.baseLength,
    previous = -1;
  for (const g of doc.history) {
    if (!uint(g.id) || g.id <= previous || !uint(g.beforeLength)) fail();
    previous = g.id;
  }
  for (let i = 0; i < doc.replay.length; i++) {
    const replay = doc.replay[i],
      group = doc.history[suffixStart + i];
    if (
      replay.direction !== 'redo' ||
      replay.id !== group.id ||
      replay.edits !== group.forwardReplay ||
      group.beforeLength !== length ||
      !group.forward.length
    )
      fail();
    length += group.forward.reduce((n, s) => n + s.text.length - s.end + s.start, 0);
    if (!uint(length)) fail();
  }
  const composed = composeNoteEdits(
    doc.baseLength,
    doc.history.slice(suffixStart, doc.cursor).map((g) => ({ splices: g.forward })),
  ).filter((s) => s.start !== s.end || s.text.length > 0);
  if (length !== doc.length || !sameSplices(composed, doc.dirty)) fail();
  const groups = doc.history.map((g) => Object.freeze(sourceGroup(g)));
  const references: Reference[] = [];
  scanner(doc.limits.retainedBytes)([groups, doc.dirty, doc.replay, doc.limits], references);
  const witness: NoteNativeHistoryWitness = Object.freeze({
    scope: Object.freeze({ ...doc.scope }),
    baseRevision: doc.baseRevision,
    baseLength: doc.baseLength,
    length: doc.length,
    generation: doc.generation,
    cursor: doc.cursor,
    suffixStart,
    nativeFence: doc.history[doc.cursor - 1].id,
    groups: Object.freeze(groups),
  });
  held.set(witness, { references, dirty: doc.dirty, replay: doc.replay, limits: doc.limits });
  return witness;
}

/** Selection navigation may replace history wrappers/after selections. Every
 * source-bearing primitive and original nested reference must remain unchanged.
 * Bounded snapshots also reject in-place edits; generation alone is insufficient.
 * This is a point-in-time check. The owner must latch any loss permanently and
 * retain its DATA reservation through receipt/adoption and physical settlement. */
export function currentNoteNativeHistoryWitness(
  doc: NoteDocumentSession,
  witness: NoteNativeHistoryWitness,
): boolean {
  const original = held.get(witness);
  if (!original) return false;
  try {
    dataFields(doc, documentFields);
    dataFields(doc.scope, ['backendId', 'workspaceId', 'noteId', 'noteInstanceId']);
  } catch {
    return false;
  }
  if (
    !Array.isArray(doc.history) ||
    !plainArray(doc.history) ||
    !sameNoteScope(witness.scope, doc.scope) ||
    witness.baseRevision !== doc.baseRevision ||
    witness.baseLength !== doc.baseLength ||
    witness.length !== doc.length ||
    witness.generation !== doc.generation ||
    witness.cursor !== doc.cursor ||
    witness.groups.length !== doc.history.length ||
    original.dirty !== doc.dirty ||
    original.replay !== doc.replay ||
    original.limits !== doc.limits
  )
    return false;
  for (let i = 0; i < witness.groups.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(doc.history, String(i));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return false;
    const g: Entry = descriptor.value,
      expected = witness.groups[i];
    try {
      dataFields(g, groupFields);
    } catch {
      return false;
    }
    if (
      g.id !== expected.id ||
      g.beforeLength !== expected.beforeLength ||
      g.forward !== expected.forward ||
      g.inverse !== expected.inverse ||
      g.forwardReplay !== expected.forwardReplay ||
      g.inverseReplay !== expected.inverseReplay
    )
      return false;
  }
  for (const snapshot of original.references) {
    const array = Array.isArray(snapshot.object);
    if (
      array
        ? !plainArray(snapshot.object)
        : Object.getPrototypeOf(snapshot.object) !== Object.prototype
    )
      return false;
    let count = 0;
    for (const key in snapshot.object) {
      if (!Object.hasOwn(snapshot.object, key) || ++count > snapshot.fields.length) return false;
    }
    if (count + (array ? 1 : 0) !== snapshot.fields.length) return false;
    for (const [key, expected] of snapshot.fields) {
      const d = Object.getOwnPropertyDescriptor(snapshot.object, key);
      if (
        !d ||
        !('value' in d) ||
        d.value !== expected ||
        d.enumerable !== !(array && key === 'length')
      )
        return false;
    }
  }
  return true;
}
