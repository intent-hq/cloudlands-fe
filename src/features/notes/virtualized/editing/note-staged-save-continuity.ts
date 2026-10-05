import { sameNoteScope, type NoteStagedSaveOperation } from '$lib/client/note-pages';
import type { NotePageSession } from '$store/renderer/slices/note-pages/note-pages-types';
import type { NoteDocumentSession } from './note-document-edit-session';
import {
  captureNoteNativeHistoryWitness,
  currentNoteNativeHistoryWitness,
  type NoteNativeHistoryWitness,
} from './note-native-history-witness';

type Continuity = {
  captured: NoteDocumentSession;
  readonly witness: NoteNativeHistoryWitness;
  readonly owner: string;
  current(note: NotePageSession | undefined): boolean;
  refuse(): void;
  pin(): (() => void) | undefined;
};
const continuities = new WeakMap<NoteStagedSaveOperation, Continuity>();
const fields = [
  'id',
  'beforeLength',
  'forward',
  'inverse',
  'forwardReplay',
  'inverseReplay',
] as const;

/** Bounded immutable field snapshots, not aliases to mutable draft/checkpoint
 * objects. Ordinary data/non-Proxy domain only, like native witness capture. */
function journalSnapshot(value: unknown) {
  const references: Array<{ object: object; fields: Array<[string, unknown]> }> = [];
  const path = new Set<object>();
  let nodes = 0,
    units = 0;
  const scan = (v: unknown, depth = 0): void => {
    if (++nodes > 32768 || depth > 10) throw new Error('Continuation journal limit');
    if (typeof v === 'string') {
      units += v.length;
      if (units > 262144) throw new Error('Continuation journal strings');
      return;
    }
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isSafeInteger(v)))
      return;
    if (!v || typeof v !== 'object' || path.has(v)) throw new Error('Continuation journal data');
    const array = Array.isArray(v);
    if (Object.getPrototypeOf(v) !== (array ? Array.prototype : Object.prototype))
      throw new Error('Continuation journal prototype');
    if (array && v.length > 32768 - nodes) throw new Error('Continuation journal array');
    const fields: Array<[string, unknown]> = [];
    path.add(v);
    let count = 0;
    for (const key in v) {
      if (!Object.hasOwn(v, key) || (array && key !== String(count)))
        throw new Error('Continuation journal shape');
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (!d || !('value' in d)) throw new Error('Continuation journal accessor');
      count++;
      units += key.length;
      if (units > 262144) throw new Error('Continuation journal strings');
      fields.push([key, d.value]);
      scan(d.value, depth + 1);
    }
    if (array) {
      if (count !== v.length) throw new Error('Continuation journal sparse');
      fields.push(['length', v.length]);
    }
    references.push({ object: v, fields });
    path.delete(v);
  };
  scan(value);
  return () =>
    references.every(({ object, fields }) => {
      const array = Array.isArray(object);
      if (Object.getPrototypeOf(object) !== (array ? Array.prototype : Object.prototype))
        return false;
      let count = 0;
      for (const key in object)
        if (!Object.hasOwn(object, key) || ++count > fields.length) return false;
      return (
        count + (array ? 1 : 0) === fields.length &&
        fields.every(([key, value]) => {
          const d = Object.getOwnPropertyDescriptor(object, key);
          return (
            d && 'value' in d && d.value === value && d.enumerable === !(array && key === 'length')
          );
        })
      );
    });
}

/** Installed by the admitted save owner before commit IO. Retained references are
 * charged to a separate continuity reservation; endpoint witnesses alone do not prove
 * this observed path. The first unsupported transition is permanently latched.
 * Appending into ANY existing group and branching after undo are conservatively
 * unsupported here, even when the final source happens to match again. */
export function retainNoteStagedSaveContinuity(
  operation: NoteStagedSaveOperation,
  captured: NoteDocumentSession,
  initial: NotePageSession,
  through: number,
  panel: string,
  owned: () => boolean,
  owner: string,
) {
  let pinned = false;
  let previous = captured;
  let witness = operation.nativeWitness;
  let journal = journalSnapshot([initial.drafts, initial.history]);
  let revision = captured.baseRevision;
  let drafts = initial.drafts;
  let history = initial.history;
  let committed = false;
  let lost = captured.cursor !== captured.history.length;
  const current = (note: NotePageSession | undefined): boolean => {
    if (!note) lost = true;
    if (lost || !note) return false;
    const doc = note.document;
    const receipt = note.committedDocumentSave;
    const nowCommitted = receipt?.operation === operation;
    lost ||=
      !owned() ||
      !journal() ||
      !currentNoteNativeHistoryWitness(previous, witness) ||
      !doc ||
      note.status !== 'ready' ||
      !note.state ||
      note.state.deleted ||
      !(panel in note.panels) ||
      !sameNoteScope(note.state.scope, captured.scope) ||
      (note.pending?.operation !== operation && !nowCommitted) ||
      (committed && !nowCommitted) ||
      !currentNoteNativeHistoryWitness(captured, operation.nativeWitness);
    if (lost || !doc) return false;
    const sourceRevision = note.state!.sourceRevision;
    lost ||= nowCommitted
      ? sourceRevision !== revision &&
        (revision !== captured.baseRevision || sourceRevision !== receipt.receipt.afterRevision)
      : sourceRevision !== captured.baseRevision;
    if (lost) return false;
    revision = sourceRevision;
    lost ||=
      !sameNoteScope(doc.scope, captured.scope) ||
      doc.baseRevision !== captured.baseRevision ||
      doc.baseLength !== captured.baseLength ||
      doc.limits !== captured.limits ||
      doc.cursor < captured.cursor ||
      doc.cursor > doc.history.length ||
      doc.history.length > captured.limits.historyEntries ||
      doc.history.length < previous.history.length ||
      !Number.isSafeInteger(doc.generation) ||
      doc.generation < previous.generation ||
      previous.history.some((g, i) => fields.some((key) => doc.history[i]?.[key] !== g[key])) ||
      (doc.history.length > previous.history.length && previous.cursor !== previous.history.length);
    const expected =
      !committed && nowCommitted ? drafts.filter((d) => d.sequence > through) : drafts;
    lost ||=
      note.drafts.length > 512 ||
      note.drafts.length < expected.length ||
      expected.some((draft, i) => note.drafts[i] !== draft) ||
      (nowCommitted && note.drafts.length !== expected.length);
    const checkpoint = note.drafts.at(-1) ?? initial.history[0];
    lost ||= note.history.length !== 1 || note.history[0] !== checkpoint;
    if (lost) return false;
    try {
      if (!currentNoteNativeHistoryWitness(doc, witness)) {
        if (pinned) throw new Error('Continuation witness pinned');
        witness = captureNoteNativeHistoryWitness(doc);
      }
      if (note.drafts !== drafts || note.history !== history)
        journal = journalSnapshot([note.drafts, note.history]);
    } catch {
      lost = true;
      return false;
    }
    previous = doc;
    drafts = note.drafts;
    history = note.history;
    committed = nowCommitted;
    return true;
  };
  const continuity = {
    captured,
    get witness() {
      return witness;
    },
    owner,
    pin: () => {
      if (lost || pinned) return undefined;
      pinned = true;
      return () => {
        pinned = false;
      };
    },
    current,
    refuse: () => {
      lost = true;
    },
  };
  continuities.set(operation, continuity);
  current(initial);
  return () => continuities.delete(operation);
}

/** Only real save-owner registrations qualify for continuation. A restored or
 * hand-authored operation cannot manufacture observation of its pending path. */
export function noteStagedSaveContinuity(
  operation: NoteStagedSaveOperation,
  note: NotePageSession | undefined,
) {
  const continuity = continuities.get(operation);
  return continuity?.current(note) ? continuity : undefined;
}
