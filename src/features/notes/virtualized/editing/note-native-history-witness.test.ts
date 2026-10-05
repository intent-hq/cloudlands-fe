import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { createNoteEditAuthority } from './note-edit-authority';
import { NoteCanonicalProjection } from '../note-canonical-projection';
import type { NoteWindow } from '../note-window-reader';
import {
  createNoteDocumentSession,
  prepareNoteDocumentEdit,
  moveNoteDocumentHistory,
  reconcileNoteDocumentSave,
  type NoteDocumentSession,
} from './note-document-edit-session';
import {
  captureNoteNativeHistoryWitness,
  currentNoteNativeHistoryWitness,
} from './note-native-history-witness';

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
    sourceRevision: 'r1',
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
  const session = createNoteDocumentSession(scope, 'r1', sourceLength);
  session.selection = { anchor: start, head: start, anchorAffinity: 1, headAffinity: 1 };
  return { session, authority, w, projection, owner };
}

function edited() {
  const f = fixture();
  const first = prepareNoteDocumentEdit(
    f.session,
    EditorState.create({ doc: f.authority.doc }).tr.insertText('X', 2, 3),
    f.authority,
  );
  const second = prepareNoteDocumentEdit(
    first.state,
    EditorState.create({ doc: first.authority.doc }).tr.insertText('Y', 3),
    first.authority,
  );
  return { f, first, second };
}

describe('native history witness', () => {
  it('refuses root, group and array accessors without evaluating them', () => {
    for (const location of ['root', 'group', 'iterator']) {
      const doc = edited().second.state;
      let reads = 0;
      const target =
        location === 'root' ? doc : location === 'group' ? doc.history[0] : doc.history;
      const key =
        location === 'root' ? 'generation' : location === 'group' ? 'forward' : Symbol.iterator;
      Object.defineProperty(target, key, {
        enumerable: false,
        get() {
          reads++;
          throw new Error('getter invoked');
        },
      });
      expect(() => captureNoteNativeHistoryWitness(doc)).toThrow(
        'Unsupported native history witness',
      );
      expect(reads).toBe(0);
    }
  });

  it('refuses accessor replacement after capture without invoking getters', () => {
    for (const location of ['root', 'group', 'token', 'history iterator', 'token iterator']) {
      const doc = edited().second.state;
      const witness = captureNoteNativeHistoryWitness(doc);
      let reads = 0;
      const array =
        location === 'history iterator'
          ? doc.history
          : location === 'token iterator'
            ? doc.history[0].inverseReplay[0].tokens
            : undefined;
      const target =
        array ??
        (location === 'root'
          ? doc
          : location === 'group'
            ? doc.history[0]
            : doc.history[0].inverseReplay[0].tokens[0]);
      const key = array
        ? Symbol.iterator
        : location === 'root'
          ? 'generation'
          : location === 'group'
            ? 'forward'
            : 'text';
      Object.defineProperty(target, key, {
        enumerable: false,
        get() {
          reads++;
          throw new Error('getter invoked');
        },
      });
      expect(currentNoteNativeHistoryWitness(doc, witness)).toBe(false);
      expect(reads).toBe(0);
    }
  });

  it.each(['before', 'text'])('rejects hidden native %s data before capture', (field) => {
    const doc = edited().second.state;
    const replay = doc.history[0].inverseReplay[0];
    const target = field === 'before' ? replay : replay.tokens[0];
    const value = field === 'before' ? replay.before : replay.tokens[0].text;
    Object.defineProperty(target, field, { value, enumerable: false, writable: true });
    expect(() => {
      const witness = captureNoteNativeHistoryWitness(doc);
      Object.defineProperty(target, field, { value: 'changed', enumerable: false, writable: true });
      // Before the fix this path silently accepted changed native source data.
      expect(currentNoteNativeHistoryWitness(doc, witness)).toBe(false);
    }).toThrow('Unsupported native history witness');
  });

  it.each(['before', 'text'])(
    'rejects hidden native %s accessors without invoking getters',
    (field) => {
      const doc = edited().second.state;
      const replay = doc.history[0].inverseReplay[0];
      const target = field === 'before' ? replay : replay.tokens[0];
      let reads = 0;
      Object.defineProperty(target, field, {
        enumerable: false,
        get() {
          reads++;
          return 'changed';
        },
      });
      expect(() => captureNoteNativeHistoryWitness(doc)).toThrow(
        'Unsupported native history witness',
      );
      expect(reads).toBe(0);
    },
  );

  it('captures original source references for actual native groups without freezing the session', () => {
    const { second } = edited();
    const doc = second.state;
    const before = JSON.stringify(doc);
    const w = captureNoteNativeHistoryWitness(doc);
    expect(w.suffixStart).toBe(0);
    expect(w.nativeFence).toBe(second.historyGroup);
    expect(w.groups).toHaveLength(2);
    expect(w.groups[0].inverseReplay).toBe(doc.history[0].inverseReplay);
    expect(w.groups[1].forward).toBe(doc.history[1].forward);
    expect(currentNoteNativeHistoryWitness(doc, w)).toBe(true);
    expect(Object.isFrozen(w)).toBe(true);
    expect(Object.isFrozen(w.groups)).toBe(true);
    expect(Object.isFrozen(doc.history[0])).toBe(false);
    expect(JSON.stringify(doc)).toBe(before);
    expect(currentNoteNativeHistoryWitness(doc, { ...w })).toBe(false);
  });

  it('allows real grouped selection finalization and unrelated directional selection navigation', () => {
    const { first } = edited();
    const w = captureNoteNativeHistoryWitness(first.state);
    const state = EditorState.create({ doc: first.authority.doc });
    const final = prepareNoteDocumentEdit(
      first.state,
      state.tr.setSelection(TextSelection.create(state.doc, 4, 2)),
      first.authority,
      { appendTo: first.historyGroup },
    );
    expect(final.state.history).not.toBe(first.state.history);
    expect(final.state.history[0].after).not.toEqual(first.state.history[0].after);
    expect(currentNoteNativeHistoryWitness(final.state, w)).toBe(true);
    const navigated = { ...final.state, selection: { ...final.state.selection, head: 100 } };
    expect(currentNoteNativeHistoryWitness(navigated, w)).toBe(true);
  });

  it('rejects later edits and undo/redo even when source bytes return to the capture', () => {
    const { first, second } = edited();
    const w = captureNoteNativeHistoryWitness(first.state);
    expect(currentNoteNativeHistoryWitness(second.state, w)).toBe(false);
    const undo = moveNoteDocumentHistory(first.state, 'undo')!.state;
    const redo = moveNoteDocumentHistory(undo, 'redo')!.state;
    expect(redo.dirty).toEqual(first.state.dirty);
    expect(currentNoteNativeHistoryWitness(undo, w)).toBe(false);
    expect(currentNoteNativeHistoryWitness(redo, w)).toBe(false);
  });

  it('keeps previously saved groups and pending redo outside the dirty suffix', () => {
    const { first, second } = edited();
    const atFirst = moveNoteDocumentHistory(second.state, 'undo')!.state;
    const saved = reconcileNoteDocumentSave(atFirst, {
      generation: atFirst.generation,
      baseRevision: atFirst.baseRevision,
      sourceRevision: 'saved',
      sourceLength: first.state.length,
      exactLocalResult: true,
    });
    expect(() => captureNoteNativeHistoryWitness(saved)).toThrow();
    const redone = moveNoteDocumentHistory(saved, 'redo')!.state;
    const w = captureNoteNativeHistoryWitness(redone);
    expect(w.suffixStart).toBe(1);
    expect(w.groups).toHaveLength(2);
    expect(currentNoteNativeHistoryWitness(redone, w)).toBe(true);
    redone.history[0].inverseReplay[0].tokens[0].text = 'tampered old saved group';
    expect(currentNoteNativeHistoryWitness(redone, w)).toBe(false);

    const fresh = edited();
    const withRedo = moveNoteDocumentHistory(fresh.second.state, 'undo')!.state;
    const redoWitness = captureNoteNativeHistoryWitness(withRedo);
    expect(redoWitness.cursor).toBe(1);
    expect(redoWitness.groups).toHaveLength(2);
    withRedo.history[1].forward[0].text = 'tampered pending redo';
    expect(currentNoteNativeHistoryWitness(withRedo, redoWitness)).toBe(false);
  });

  const mutations: Array<[string, (d: NoteDocumentSession) => void]> = [
    ['group id', (d) => d.history[0].id++],
    ['beforeLength', (d) => d.history[0].beforeLength++],
    [
      'forward reference',
      (d) => {
        d.history[0].forward = [...d.history[0].forward];
      },
    ],
    [
      'inverse reference',
      (d) => {
        d.history[0].inverse = [...d.history[0].inverse];
      },
    ],
    [
      'replay token replacement',
      (d) => {
        d.history[0].inverseReplay[0].tokens[0] = { ...d.history[0].inverseReplay[0].tokens[0] };
      },
    ],
    [
      'token in-place text',
      (d) => {
        d.history[0].forwardReplay[0].tokens[0].text = 'changed';
      },
    ],
    [
      'token in-place coordinate',
      (d) => {
        d.history[0].inverseReplay[0].tokens[0].start++;
      },
    ],
    [
      'inverse text',
      (d) => {
        d.history[0].inverse[0].text += 'Z';
      },
    ],
    [
      'replay before source',
      (d) => {
        d.history[0].forwardReplay[0].before += 'Z';
      },
    ],
    [
      'dirty in place',
      (d) => {
        d.dirty[0].text += 'Z';
      },
    ],
    [
      'replay id',
      (d) => {
        d.replay[0].id++;
      },
    ],
    [
      'same-content replay copy',
      (d) => {
        d.replay = [...d.replay];
      },
    ],
    [
      'reordered history',
      (d) => {
        d.history.reverse();
      },
    ],
    [
      'removed history',
      (d) => {
        d.history.pop();
      },
    ],
    [
      'new base',
      (d) => {
        d.baseRevision = 'different';
      },
    ],
    [
      'new scope',
      (d) => {
        d.scope = { ...d.scope, noteInstanceId: 'different' };
      },
    ],
    [
      'limits in place',
      (d) => {
        d.limits.splices--;
      },
    ],
  ];
  it.each(mutations)('rejects %s without relying on a generation change', (_, mutate) => {
    const { second } = edited();
    const doc = second.state;
    const w = captureNoteNativeHistoryWitness(doc);
    const generation = doc.generation;
    mutate(doc);
    expect(doc.generation).toBe(generation);
    expect(currentNoteNativeHistoryWitness(doc, w)).toBe(false);
  });

  it('refuses missing alias provenance, undo traversal and incorrect composition at capture', () => {
    const a = edited().second.state;
    a.replay[0].edits = [...a.replay[0].edits];
    expect(() => captureNoteNativeHistoryWitness(a)).toThrow();
    const b = edited().second.state;
    b.dirty = [{ ...b.dirty[0], text: 'same length different source' }];
    expect(() => captureNoteNativeHistoryWitness(b)).toThrow();
    const c = edited().second.state;
    c.replay[0].direction = 'undo';
    expect(() => captureNoteNativeHistoryWitness(c)).toThrow();
  });

  it('refuses inflated limits, actual retained bytes, counts and hostile domain shapes before capture', () => {
    for (const edit of [
      (d: NoteDocumentSession) => {
        d.limits.retainedBytes = 262145;
      },
      (d: NoteDocumentSession) => {
        d.limits.historyEntries = 257;
      },
      (d: NoteDocumentSession) => {
        d.limits.splices = 2049;
      },
      (d: NoteDocumentSession) => {
        d.limits.splices = 1;
      },
      (d: NoteDocumentSession) => {
        d.limits.retainedBytes = 100;
      },
      (d: NoteDocumentSession) => {
        d.history[0].inverseReplay[0].before = '😀'.repeat(70000);
      },
      (d: NoteDocumentSession) => {
        d.history = Array(257).fill(d.history[0]);
      },
      (d: NoteDocumentSession) => {
        d.history[0].inverseReplay[0].tokens = Array(33000).fill(
          d.history[0].inverseReplay[0].tokens[0],
        );
      },
      (d: NoteDocumentSession) => {
        delete d.history[0].inverseReplay[0].tokens[0];
      },
      (d: NoteDocumentSession) => {
        Object.defineProperty(d.history[0].inverseReplay[0], 'before', {
          enumerable: true,
          get: () => {
            throw new Error('getter evaluated');
          },
        });
      },
    ]) {
      const doc = edited().second.state;
      edit(doc);
      expect(() => captureNoteNativeHistoryWitness(doc)).toThrow(
        'Unsupported native history witness',
      );
    }
  });
});
