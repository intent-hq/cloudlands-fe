import { expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { createNoteEditAuthority, type NoteEditAuthority } from './note-edit-authority';
import { NoteCanonicalProjection } from '../note-canonical-projection';
import type { NoteWindow } from '../note-window-reader';
import {
  createNoteDocumentSession,
  prepareNoteDocumentEdit,
  moveNoteDocumentHistory,
  reconcileNoteDocumentSave,
  materializeNoteDocumentAuthority,
  type NoteDocumentSession,
} from './note-document-edit-session';
import { captureNoteNativeHistoryWitness } from './note-native-history-witness';
import {
  prepareNoteDocumentSaveContinuation,
  type NoteDocumentSaveContinuationInput,
} from './note-document-save-continuation';
// Controlled canonical fixture; tests exercise actual core native edit/history APIs.
const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*' },
    text: {},
  },
  marks: { bold: {} },
});
const scope = { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' };
function fixture(
  raw = 'abc',
  start = 100,
  sourceLength = 1000,
  rendered = raw,
  mapping = 'identity',
  revision = 'r1',
) {
  const owner = {
    kind: 'boundary',
    id: 'owner',
    construct: 'paragraph',
    entryPath: 'markdown',
    sourceRange: { start, end: start + raw.length },
  } as const;
  const w = {
    scope,
    sourceRevision: revision,
    snapshotId: 'snap1',
    sourceLength,
    range: owner.sourceRange,
    text: raw,
    documentEnd: false,
    details: { owner: { openingSource: '', closingSource: '' } },
    mapBindings: [],
    native: {
      references: { parent: ['root'], leafParent: ['paragraph'], ownerRef: ['owner'] },
      attributes: { empty: {} },
      texts: { text: rendered },
    },
    context: [
      owner,
      {
        kind: 'nativeNode',
        id: 'root',
        nodeType: 'doc',
        nodeClass: 'container',
        parentRef: null,
        childIndex: 0,
        attributesRef: 'empty',
        sourceRange: owner.sourceRange,
      },
      {
        kind: 'nativeNode',
        id: 'paragraph',
        nodeType: 'paragraph',
        nodeClass: 'container',
        parentRef: 'parent',
        childIndex: 0,
        attributesRef: 'empty',
        sourceRange: owner.sourceRange,
      },
      {
        kind: 'nativeNode',
        id: 'leaf',
        nodeType: 'text',
        nodeClass: 'text',
        parentRef: 'leafParent',
        childIndex: 0,
        sourceRange: owner.sourceRange,
      },
      {
        kind: 'sourceMap',
        id: 'map',
        ownerRef: 'ownerRef',
        textNodeId: 'leaf',
        sourceRange: owner.sourceRange,
        renderedRange: { start: 0, end: rendered.length },
        mapping,
        textRef: 'text',
      },
    ],
  } as unknown as NoteWindow;
  const projection = new NoteCanonicalProjection(w);
  const doc = schema.nodeFromJSON(projection.content);
  const authority = createNoteEditAuthority(w, projection, [owner], doc);
  const session = createNoteDocumentSession(scope, revision, sourceLength);
  session.selection = { anchor: start, head: start, anchorAffinity: 1, headAffinity: 1 };
  return { session, authority, w, projection, owner };
}

function edit(
  state: NoteDocumentSession,
  authority: NoteEditAuthority,
  text: string,
  from: number,
  to = from,
  appendTo?: number,
) {
  return prepareNoteDocumentEdit(
    state,
    EditorState.create({ doc: authority.doc }).tr.insertText(text, from, to),
    authority,
    { appendTo },
  );
}
function chain() {
  const f = fixture();
  const saved = edit(f.session, f.authority, 'X', 2, 3);
  const later = edit(saved.state, saved.authority, 'Y', 3);
  const last = edit(later.state, later.authority, 'Z', 4);
  return { f, saved, later, last };
}
function input(captured: NoteDocumentSession, current: NoteDocumentSession, revision = 'r2') {
  return {
    captured,
    current,
    capturedWitness: captureNoteNativeHistoryWitness(captured),
    currentWitness: captureNoteNativeHistoryWitness(current),
    receipt: {
      generation: captured.generation,
      baseRevision: captured.baseRevision,
      sourceRevision: revision,
      sourceLength: captured.length,
      exactLocalResult: true as boolean,
      hasSourceEffects: false as boolean,
    },
    authoritativeRevision: revision,
  } satisfies NoteDocumentSaveContinuationInput;
}
function savedAuthority(source: string, length: number, revision = 'r2') {
  return fixture(source, 100, length, source, 'identity', revision).authority;
}

it('rebases later native groups onto the exact saved source and preserves full undo/redo', () => {
  const f = chain(),
    args = input(f.saved.state, f.last.state);
  const current = {
    ...args.current,
    selection: { anchor: 104, head: 101, anchorAffinity: -1 as const, headAffinity: 1 as const },
  };
  args.current = current;
  const result = prepareNoteDocumentSaveContinuation(args);
  expect(result.history).toBe(current.history);
  expect(result.selection).toBe(current.selection);
  expect(result.cursor).toBe(current.cursor);
  expect(result.generation).toBe(current.generation + 1);
  expect(result.baseLength).toBe(f.saved.state.length);
  expect(result.replay.map((r) => r.id)).toEqual(current.history.slice(1).map((g) => g.id));
  expect(result.replay[0].edits).toBe(current.history[1].forwardReplay);
  const base = savedAuthority(f.saved.authority.source, f.saved.state.length);
  expect(materializeNoteDocumentAuthority(result, base).source).toBe('aXYZc');
  const undoLast = moveNoteDocumentHistory(result, 'undo')!.state;
  expect(materializeNoteDocumentAuthority(undoLast, base).source).toBe('aXYc');
  const undoLater = moveNoteDocumentHistory(undoLast, 'undo')!.state;
  expect(materializeNoteDocumentAuthority(undoLater, base).source).toBe('aXc');
  const undoSaved = moveNoteDocumentHistory(undoLater, 'undo')!.state;
  expect(materializeNoteDocumentAuthority(undoSaved, base).source).toBe('abc');
  let redo = undoSaved;
  for (let i = 0; i < 3; i++) redo = moveNoteDocumentHistory(redo, 'redo')!.state;
  expect(materializeNoteDocumentAuthority(redo, base).source).toBe('aXYZc');
  expect(args.current.dirty).toBe(current.dirty);
});

it('retains undone later groups as redo history and accepts empty later delta', () => {
  const f = chain();
  const oneUndo = moveNoteDocumentHistory(f.last.state, 'undo')!.state;
  const partial = prepareNoteDocumentSaveContinuation(input(f.saved.state, oneUndo));
  expect(partial.history).toBe(oneUndo.history);
  const base = savedAuthority('aXc', f.saved.state.length);
  expect(materializeNoteDocumentAuthority(partial, base).source).toBe('aXYc');
  expect(
    materializeNoteDocumentAuthority(moveNoteDocumentHistory(partial, 'redo')!.state, base).source,
  ).toBe('aXYZc');
  const twoUndo = moveNoteDocumentHistory(oneUndo, 'undo')!.state;
  const empty = prepareNoteDocumentSaveContinuation(input(f.saved.state, twoUndo));
  expect(empty.dirty).toEqual([]);
  expect(empty.replay).toEqual([]);
  expect(empty.history).toBe(twoUndo.history);
  expect(empty.cursor).toBe(1);
  expect(
    materializeNoteDocumentAuthority(moveNoteDocumentHistory(empty, 'redo')!.state, base).source,
  ).toBe('aXYc');
});

it('respects an old saved-base suffix instead of replaying all history from zero', () => {
  const f = chain();
  const previous = reconcileNoteDocumentSave(f.saved.state, {
    generation: f.saved.state.generation,
    baseRevision: 'r1',
    sourceRevision: 'r2',
    sourceLength: f.saved.state.length,
    exactLocalResult: true as boolean,
  });
  const previousBase = savedAuthority('aXc', previous.length);
  const saved = edit(previous, materializeNoteDocumentAuthority(previous, previousBase), 'Y', 3);
  const later = edit(saved.state, saved.authority, '😀', 4);
  const args = input(saved.state, later.state, 'r3');
  expect(args.capturedWitness.suffixStart).toBe(1);
  const result = prepareNoteDocumentSaveContinuation(args);
  const base = savedAuthority('aXYc', saved.state.length, 'r3');
  expect(materializeNoteDocumentAuthority(result, base).source).toBe('aXY😀c');
  expect(result.replay).toHaveLength(1);
  expect(
    materializeNoteDocumentAuthority(moveNoteDocumentHistory(result, 'undo')!.state, base).source,
  ).toBe('aXYc');
});

it('keeps grouped later replay steps and directional selection-only wrappers', () => {
  const f = chain();
  const grouped = edit(f.later.state, f.later.authority, 'Z', 4, 4, f.later.historyGroup);
  const state = {
    ...grouped.state,
    selection: { anchor: 104, head: 101, anchorAffinity: -1 as const, headAffinity: 1 as const },
  };
  state.history = state.history.map((g, i) =>
    i === 0 ? { ...g, after: { ...g.after, anchorAffinity: -1 as const } } : g,
  );
  const result = prepareNoteDocumentSaveContinuation(input(f.saved.state, state));
  expect(result.replay).toHaveLength(1);
  expect(result.replay[0].edits).toBe(state.history[1].forwardReplay);
  const base = savedAuthority('aXc', f.saved.state.length);
  expect(materializeNoteDocumentAuthority(result, base).source).toBe('aXYZc');
  expect(
    materializeNoteDocumentAuthority(moveNoteDocumentHistory(result, 'undo')!.state, base).source,
  ).toBe('aXc');
  expect(result.selection).toBe(state.selection);
  expect(result.history).toBe(state.history);
});

it('rejects appending to or replacing a captured group even with the same source result', () => {
  const f = chain();
  const appended = edit(f.saved.state, f.saved.authority, 'Y', 3, 3, f.saved.historyGroup);
  expect(() => prepareNoteDocumentSaveContinuation(input(f.saved.state, appended.state))).toThrow();
  const replaced = {
    ...f.later.state,
    history: f.later.state.history.map((g, i) =>
      i === 0 ? { ...g, forward: g.forward.map((s) => ({ ...s })) } : g,
    ),
  };
  expect(() => prepareNoteDocumentSaveContinuation(input(f.saved.state, replaced))).toThrow();
});

it('rejects undo before the save cursor and a captured redo suffix', () => {
  const f = chain();
  const undo = moveNoteDocumentHistory(f.later.state, 'undo')!.state;
  expect(() => prepareNoteDocumentSaveContinuation(input(f.later.state, undo))).toThrow();
  expect(() => prepareNoteDocumentSaveContinuation(input(undo, f.last.state))).toThrow();
});

it.each([
  'effects',
  'not-exact',
  'generation',
  'base',
  'length',
  'newer-revision',
  'same-revision',
] as const)('rejects receipt %s mismatch', (kind) => {
  const f = chain(),
    args = input(f.saved.state, f.later.state),
    r = { ...args.receipt };
  if (kind === 'effects') r.hasSourceEffects = true;
  if (kind === 'not-exact') r.exactLocalResult = false;
  if (kind === 'generation') r.generation++;
  if (kind === 'base') r.baseRevision = 'foreign';
  if (kind === 'length') r.sourceLength++;
  if (kind === 'newer-revision') args.authoritativeRevision = 'r3';
  if (kind === 'same-revision') {
    r.sourceRevision = 'r1';
    args.authoritativeRevision = 'r1';
  }
  expect(() => prepareNoteDocumentSaveContinuation({ ...args, receipt: r })).toThrow();
});

it('rejects original/current witness corruption or copied witnesses', () => {
  for (const which of ['captured', 'current', 'copy'] as const) {
    const f = chain(),
      args = input(f.saved.state, f.later.state);
    if (which === 'copy') args.currentWitness = { ...args.currentWitness };
    else args[which].history[0].inverseReplay[0].before = 'corrupt';
    expect(() => prepareNoteDocumentSaveContinuation(args)).toThrow();
  }
});

it('rejects changed limits, scope, base and unsafe generation', () => {
  for (const which of ['limits', 'scope', 'base', 'generation'] as const) {
    const f = chain();
    const current = { ...f.later.state };
    if (which === 'limits') current.limits = { ...current.limits };
    if (which === 'scope') current.scope = { ...current.scope, noteInstanceId: 'other' };
    if (which === 'base') current.baseRevision = 'other';
    if (which === 'generation') current.generation = Number.MAX_SAFE_INTEGER;
    expect(() => prepareNoteDocumentSaveContinuation(input(f.saved.state, current))).toThrow();
  }
});

it('bounds changed selection wrappers and never executes their accessors', () => {
  const f = chain(),
    args = input(f.saved.state, f.later.state);
  let reads = 0;
  const current = { ...args.current };
  Object.defineProperty(current, 'selection', {
    enumerable: true,
    get() {
      reads++;
      throw new Error('getter');
    },
  });
  expect(() => prepareNoteDocumentSaveContinuation({ ...args, current })).toThrow('Unsupported');
  expect(reads).toBe(0);
  const oversized = {
    ...args.current,
    selection: { ...args.current.selection, extra: 'x'.repeat(1024) },
  };
  expect(() => prepareNoteDocumentSaveContinuation({ ...args, current: oversized })).toThrow(
    'Unsupported',
  );
});
