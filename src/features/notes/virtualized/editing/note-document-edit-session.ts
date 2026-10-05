import type { Transaction } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';
import { sameNoteScope, type NoteScope, type NoteSplice } from '$lib/client/note-pages';
import type { NoteSourceSelection } from '../note-window-view';
import type { NoteEditAuthority, NoteReplayEdit } from './note-edit-authority';
import { composeNoteEdits } from './note-edit-plan';

type Entry = {
  id: number;
  beforeLength: number;
  forward: NoteSplice[];
  inverse: NoteSplice[];
  forwardReplay: NoteReplayEdit[];
  inverseReplay: NoteReplayEdit[];
  before: NoteSourceSelection;
  after: NoteSourceSelection;
};
type Replay = { id: number; direction: 'undo' | 'redo'; edits: NoteReplayEdit[] };
function appendReplay(replay: Replay[], next: Replay) {
  const last = replay.at(-1);
  return last?.id === next.id && last.direction !== next.direction
    ? replay.slice(0, -1)
    : [...replay, next];
}
type Limits = {
  historyEntries: number;
  retainedBytes: number;
  splices: number;
  transactionSteps: number;
  windowBytes: number;
};
const defaults: Limits = {
  historyEntries: 256,
  retainedBytes: 262144,
  splices: 2048,
  transactionSteps: 32,
  windowBytes: 32768,
};
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const compact = (splices: NoteSplice[]) =>
  splices.filter((s) => s.start !== s.end || s.text.length > 0);
const lengthAfter = (length: number, splices: readonly NoteSplice[]) =>
  length + splices.reduce((n, s) => n + s.text.length - s.end + s.start, 0);
const compose = (length: number, batches: readonly { splices: readonly NoteSplice[] }[]) =>
  compact(composeNoteEdits(length, batches));

/** Plain serializable domain state for the Redux owner. No complete source,
 * editor state, callbacks, cache pages or asynchronous persistence are retained.
 * Native transactions create chronological entries. The relay passes appendTo
 * for editor-appended transactions so the accepted chain has one undo entry,
 * and publishes the final prepared state atomically. */
export interface NoteDocumentSession {
  scope: NoteScope;
  baseRevision: string;
  baseLength: number;
  length: number;
  generation: number;
  selection: NoteSourceSelection;
  history: Entry[];
  cursor: number;
  dirty: NoteSplice[];
  replay: Replay[];
  limits: Limits;
}

export function createNoteDocumentSession(
  scope: NoteScope,
  baseRevision: string,
  length: number,
): NoteDocumentSession {
  if (!baseRevision || !Number.isSafeInteger(length) || length < 0)
    throw new Error('Invalid document session identity');
  return {
    scope: { ...scope },
    baseRevision,
    baseLength: length,
    length,
    generation: 0,
    selection: { anchor: 0, head: 0, anchorAffinity: 1, headAffinity: 1 },
    history: [],
    cursor: 0,
    dirty: [],
    replay: [],
    limits: { ...defaults },
  };
}

/** All rejection happens here, before editor admission. This function is pure;
 * later filters rejecting the native transaction discard this candidate. The
 * owner commits only the actual applied root/appended chain, synchronously, and
 * passes its latest provisional authority to every subsequent transaction. Use
 * the root candidate's historyGroup as appendTo for editor-appended changes. */
export function prepareNoteDocumentEdit(
  state: NoteDocumentSession,
  tr: Transaction,
  authority: NoteEditAuthority,
  options: { appendTo?: number } = {},
) {
  if (
    state.generation !== authority.generation ||
    state.baseRevision !== authority.sourceRevision ||
    state.baseLength !== authority.baseLength ||
    !sameNoteScope(state.scope, authority.scope) ||
    !authority.doc.eq(tr.before)
  )
    throw new Error('Stale note edit authority');
  if (
    state.selection.anchor < authority.start ||
    state.selection.head < authority.start ||
    state.selection.anchor > authority.start + authority.source.length ||
    state.selection.head > authority.start + authority.source.length
  )
    throw new Error('Document selection extends beyond edit authority');
  if (
    tr.steps.length > state.limits.transactionSteps ||
    bytes(authority.source) > state.limits.windowBytes
  )
    throw new Error('Note edit budget exceeded');
  let next = authority;
  const forwardReplay: NoteReplayEdit[] = [],
    inverseReplay: NoteReplayEdit[] = [];
  const forward: { splices: NoteSplice[] }[] = [],
    inverse: { splices: NoteSplice[] }[] = [];
  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i];
    if (!(step instanceof ReplaceStep))
      throw new Error('Unsupported note formatting or structural edit');
    const translated = next.replace(step, tr.docs[i]);
    next = translated.authority;
    forward.push({ splices: [translated.splice] });
    inverse.unshift({ splices: [translated.inverse] });
    forwardReplay.push(translated.forwardReplay);
    inverseReplay.unshift(translated.inverseReplay);
    if (bytes(next.source) > state.limits.windowBytes)
      throw new Error('Note edit window budget exceeded');
  }
  if (!next.doc.eq(tr.doc)) throw new Error('Note edit document mapping diverged');
  const splices = compose(state.length, forward);
  const length = lengthAfter(state.length, splices);
  const selection: NoteSourceSelection = {
    anchor: next.sourceAt(tr.selection.anchor),
    head: next.sourceAt(tr.selection.head),
    anchorAffinity: 1,
    headAffinity: 1,
  };
  if (!splices.length)
    return {
      state: { ...state, selection },
      authority: next,
      splices,
      historyGroup: options.appendTo,
    };
  let entry: Entry = {
    id: state.generation + 1,
    beforeLength: state.length,
    forward: splices,
    inverse: compose(length, inverse),
    forwardReplay,
    inverseReplay,
    before: { ...state.selection },
    after: selection,
  };
  let kept = state.history.slice(0, state.cursor);
  let previousReplay = state.replay;
  if (options.appendTo !== undefined) {
    const previous = kept.at(-1),
      pending = state.replay.at(-1);
    if (
      !previous ||
      previous.id !== options.appendTo ||
      state.cursor !== state.history.length ||
      pending?.id !== previous.id ||
      pending.direction !== 'redo'
    )
      throw new Error('Stale appended note history group');
    entry = {
      ...entry,
      id: previous.id,
      beforeLength: previous.beforeLength,
      before: previous.before,
      forward: compose(previous.beforeLength, [
        { splices: previous.forward },
        { splices: entry.forward },
      ]),
      inverse: compose(length, [{ splices: entry.inverse }, { splices: previous.inverse }]),
      forwardReplay: [...previous.forwardReplay, ...entry.forwardReplay],
      inverseReplay: [...entry.inverseReplay, ...previous.inverseReplay],
    };
    kept = kept.slice(0, -1);
    previousReplay = state.replay.slice(0, -1);
  }
  const history = [...kept, entry];
  const dirty = compose(state.baseLength, [{ splices: state.dirty }, { splices }]);
  const replay = appendReplay(previousReplay, {
    id: entry.id,
    direction: 'redo',
    edits: entry.forwardReplay,
  });
  // Half of the hard payload/count budget is reserved for undo after a save.
  // A traversal can add at most all retained inverse/forward bytes to dirty.
  // Never truncate history or throw away unsaved overlays to admit new typing.
  if (
    history.length > state.limits.historyEntries ||
    bytes(history) + bytes(dirty) + bytes(replay) > state.limits.retainedBytes / 2 ||
    history.reduce((n, e) => n + e.forward.length + e.inverse.length, 0) +
      dirty.length +
      replay.reduce((n, r) => n + r.edits.length, 0) >
      state.limits.splices / 2
  )
    throw new Error('Note document history budget exceeded');
  const generation = state.generation + 1;
  return {
    state: {
      ...state,
      length,
      selection,
      history,
      cursor: history.length,
      dirty,
      replay,
      generation,
    },
    authority: next.atGeneration(generation),
    splices,
    historyGroup: entry.id,
  };
}

/** No view/source read is needed, even after eviction. The caller applies these
 * source splices through the same draft pipeline and remounts/rebuilds authority.
 * This is not a call to native per-window history. */
export function moveNoteDocumentHistory(state: NoteDocumentSession, direction: 'undo' | 'redo') {
  const undo = direction === 'undo';
  const entry = state.history[undo ? state.cursor - 1 : state.cursor];
  if (!entry) return undefined;
  const splices = (undo ? entry.inverse : entry.forward).map((s) => ({ ...s }));
  const dirty = compose(state.baseLength, [{ splices: state.dirty }, { splices }]);
  return {
    splices,
    state: {
      ...state,
      dirty,
      replay: appendReplay(state.replay, {
        id: entry.id,
        direction,
        edits: undo ? entry.inverseReplay : entry.forwardReplay,
      }),
      length: lengthAfter(state.length, splices),
      generation: state.generation + 1,
      cursor: state.cursor + (undo ? -1 : 1),
      selection: { ...(undo ? entry.before : entry.after) },
    },
  };
}

/** The only mount path for a saved source projection. Apply all retained edits
 * in their chronological coordinates, including shifts from edits outside this
 * window. New generations can never just be stamped onto base coordinates. */
export function materializeNoteDocumentAuthority(
  state: NoteDocumentSession,
  base: NoteEditAuthority,
) {
  if (
    base.generation !== 0 ||
    base.sourceRevision !== state.baseRevision ||
    base.baseLength !== state.baseLength ||
    !sameNoteScope(base.scope, state.scope)
  )
    throw new Error('Stale note base authority');
  let authority = base;
  for (const item of state.replay)
    for (const edit of item.edits) authority = authority.replay(edit);
  if (bytes(authority.source) > state.limits.windowBytes)
    throw new Error('Note replay window budget exceeded');
  return authority.atGeneration(state.generation);
}

/** Replay only edits wholly contained in an admitted base-revision source
 * window. A crossing deletion needs a wider bounded window, never clipping or
 * a full-document fetch. Context/projection must be rebuilt before editing. */
export function overlayNoteDocumentSource(
  state: NoteDocumentSession,
  start: number,
  text: string,
  baseRevision: string,
) {
  const end = start + text.length;
  if (
    baseRevision !== state.baseRevision ||
    !Number.isSafeInteger(start) ||
    start < 0 ||
    end > state.baseLength ||
    bytes(text) > state.limits.windowBytes
  )
    throw new Error('Stale or invalid source overlay window');
  const local: NoteSplice[] = [];
  let shift = 0;
  for (const s of state.dirty) {
    if (s.end <= start && s.start < start) {
      shift += s.text.length - s.end + s.start;
      continue;
    }
    if (s.start > end || (s.start === end && end !== state.baseLength)) continue;
    if (s.start < start || s.end > end)
      throw new Error('Dirty overlay requires complete edit coverage');
    local.push(s);
  }
  let result = text;
  for (const s of local.slice().reverse())
    result = result.slice(0, s.start - start) + s.text + result.slice(s.end - start);
  if (bytes(result) > state.limits.windowBytes)
    throw new Error('Note overlay window budget exceeded');
  return { start: start + shift, text: result, generation: state.generation };
}

/** This narrow reconciliation is legal only after the save owner proves the
 * authoritative result is exactly this captured local generation, with no extra
 * canonical effects. A submitted-splice echo or unknown ACK is not that proof.
 * Later typing, remote changes and canonical rewrites require the owner's full
 * mapping reconciliation and leave this state untouched when rejected here. */
export function reconcileNoteDocumentSave(
  state: NoteDocumentSession,
  receipt: {
    generation: number;
    baseRevision: string;
    sourceRevision: string;
    sourceLength: number;
    exactLocalResult: boolean;
  },
) {
  if (
    !receipt.exactLocalResult ||
    receipt.generation !== state.generation ||
    receipt.baseRevision !== state.baseRevision ||
    !receipt.sourceRevision ||
    receipt.sourceLength !== state.length
  )
    throw new Error('Missing exact save reconciliation authority');
  return {
    ...state,
    baseRevision: receipt.sourceRevision,
    baseLength: receipt.sourceLength,
    dirty: [],
    replay: [],
    generation: state.generation + 1,
  };
}
