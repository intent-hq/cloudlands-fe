import { expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { NoteCanonicalProjection } from '$features/notes/virtualized/note-canonical-projection';
import type { NoteWindow } from '$features/notes/virtualized/note-window-reader';
import { createNoteEditAuthority } from '$features/notes/virtualized/editing/note-edit-authority';
import {
  createNoteDocumentSession,
  moveNoteDocumentHistory,
} from '$features/notes/virtualized/editing/note-document-edit-session';
import { createReduxNoteDocumentOwner } from '$features/notes/virtualized/editing/note-document-redux-owner';
import { createNoteTransactionRelay } from '$features/notes/virtualized/note-transaction-relay';
import { composeNoteEdits } from '$features/notes/virtualized/editing/note-edit-plan';
import { prepareNoteDocumentPublication } from './note-document-publication';
import {
  notePagesReducer,
  pagePanelOpened,
  pagePanelClosed,
  pageStateReceived,
  pageWindowRequested,
  pageWindowSettled,
  pageDocumentPublished,
  pageDraftChanged,
  pageDraftsUnchanged,
  pageSaveStarted,
  pageSaveSettled,
  pageMappingAccepted,
} from './note-pages-slice';
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

function mounted() {
  const f = fixture();
  let state = notePagesReducer(undefined, pagePanelOpened('w', 'n', 'panel'));
  state = notePagesReducer(
    state,
    pageStateReceived('w', 'n', 0, {
      kind: 'notePageState',
      scope,
      stateGeneration: '1',
      sourceRevision: 'r1',
      attributionGeneration: '1',
      attributionState: 'ready',
      commentRevision: '1',
      deleted: false,
      invalidation: 'all',
    }),
  );
  state = notePagesReducer(state, pageWindowRequested('w', 'n', 'panel', 100));
  const read = () => state.byWorkspaceId.w.notes.n;
  state = notePagesReducer(
    state,
    pageWindowSettled(
      'w',
      'n',
      'panel',
      read().generation,
      read().windows.panel.request,
      f.w,
      null,
    ),
  );
  const dispatch = (action: Parameters<typeof notePagesReducer>[1]) => {
    state = notePagesReducer(state, action);
  };
  const owner = createReduxNoteDocumentOwner(f.authority, read, dispatch);
  const relay = createNoteTransactionRelay(() => owner);
  let editor = EditorState.create({ doc: owner.initial.doc, plugins: [relay.plugin] });
  const edit = (text: string) => {
    const result = editor.applyTransaction(editor.tr.insertText(text, 2));
    if (result.transactions.length) {
      editor = result.state;
      relay.adopt(result.transactions, editor);
    }
    return result;
  };
  return {
    ...f,
    read,
    dispatch,
    owner,
    relay,
    edit,
    get editor() {
      return editor;
    },
  };
}
it('publishes native acceptance and its save draft atomically, retaining undo across eviction', () => {
  const f = mounted();
  const before = f.read().document!;
  const result = f.editor.applyTransaction(f.editor.tr.insertText('X', 2));
  expect(result.transactions).toHaveLength(1);
  expect(f.read().document).toBe(before);
  expect(f.read().drafts).toEqual([]);
  f.relay.adopt(result.transactions, result.state);
  const after = f.read().document!;
  expect(after).not.toBe(before);
  expect(after.history).toHaveLength(1);
  expect(f.read().drafts[0].splices).toEqual([{ start: 101, end: 101, text: 'X' }]);
  expect(JSON.parse(JSON.stringify(after))).toEqual(after);
  f.dispatch(pagePanelClosed('w', 'n', 'panel'));
  expect(f.read().document).toBe(after);
  const undone = moveNoteDocumentHistory(after, 'undo')!;
  expect(
    prepareNoteDocumentPublication(f.read(), after, undone.state, undone.splices),
  ).toBeDefined();
  f.dispatch(
    pageDocumentPublished('w', 'n', f.read().generation, after, undone.state, undone.splices),
  );
  expect(f.read().document).toBe(undone.state);
  expect(composeNoteEdits(before.baseLength, f.read().drafts)).toEqual([]);
  expect(f.read().history).toHaveLength(1);
  expect(f.read().drafts.map((d) => d.sequence)).toEqual([1, 2]);
});
it('rejects stale session and page-generation publication without partial drafts', () => {
  const f = mounted();
  const before = f.read().document!;
  expect(f.edit('X').transactions).toHaveLength(1);
  const accepted = f.read();
  const undone = moveNoteDocumentHistory(accepted.document!, 'undo')!;
  f.dispatch(
    pageDocumentPublished('w', 'n', accepted.generation, before, undone.state, undone.splices),
  );
  expect(f.read()).toBe(accepted);
  f.dispatch(
    pageDocumentPublished(
      'w',
      'n',
      accepted.generation + 1,
      accepted.document!,
      undone.state,
      undone.splices,
    ),
  );
  expect(f.read()).toBe(accepted);
});
it('revokes native editing when an external legacy draft bypasses the document owner', () => {
  const f = mounted();
  // Legacy input is retained, but it revokes document editing rather than letting
  // this unrelated journal write bypass the exact document-state publication.
  const before = f.read().document!;
  f.dispatch(
    pageDraftChanged('w', 'n', {
      scope,
      sequence: 1,
      baseRevision: 'r1',
      splices: [{ start: 0, end: 0, text: 'outside' }],
      selection: { anchor: 0, head: 0, anchorAffinity: 'after', headAffinity: 'after' },
    }),
  );
  expect(f.read().needsReconcile).toBe(true);
  expect(f.edit('X').transactions).toHaveLength(0);
  expect(f.editor.doc.textContent).toBe('abc');
  expect(f.read().document).toBe(before);
  expect(f.read().drafts).toHaveLength(1);
});
it('reserves the largest future undo checkpoint and commas before admitting an edit', () => {
  const f = mounted();
  const before = f.read().document!;
  f.edit('X');
  const after = f.read().document!;
  const original = { ...f.read(), document: before, drafts: [], history: [] };
  const forward = f.read().drafts[0].splices;
  const charge = (n: number) =>
    prepareNoteDocumentPublication(original, before, after, forward, { bytes: n, records: 512 });
  let budget = 1;
  while (!charge(budget)) budget++;
  expect(charge(budget - 1)).toBeUndefined();
  const undo = moveNoteDocumentHistory(after, 'undo')!;
  expect(
    prepareNoteDocumentPublication(f.read(), after, undo.state, undo.splices, {
      bytes: budget,
      records: 512,
    }),
  ).toBeDefined();
  expect(
    prepareNoteDocumentPublication(original, before, after, forward, { bytes: budget, records: 2 }),
  ).toBeUndefined();
});
it('uses ordinary selection as the next undo origin without rewriting previous history', () => {
  const f = mounted();
  f.edit('X');
  const accepted = f.read().document!;
  const priorAfter = accepted.history[0].after;
  const moved = { anchor: 103, head: 101, anchorAffinity: -1 as const, headAffinity: 1 as const };
  f.owner.select(moved);
  expect(f.read().document!.history).toBe(accepted.history);
  expect(f.read().document!.history[0].after).toBe(priorAfter);
  expect(f.read().drafts).toHaveLength(1);
  expect(f.owner.current()).toBe(true);
  expect(f.edit('Y').transactions).toHaveLength(1);
  expect(f.read().document!.history[1].before).toEqual(moved);
  expect(moveNoteDocumentHistory(f.read().document!, 'undo')!.state.selection).toEqual(moved);
});
it('refuses a prepared chain if selection publication replaces its exact origin before adoption', () => {
  const f = mounted();
  const before = f.read().document!;
  const result = f.editor.applyTransaction(f.editor.tr.insertText('X', 2));
  expect(result.transactions).toHaveLength(1);
  f.owner.select({ anchor: 102, head: 102, anchorAffinity: 1, headAffinity: 1 });
  expect(f.relay.adopt(result.transactions, result.state)).toBeUndefined();
  expect(f.read().document!.history).toBe(before.history);
  expect(f.read().drafts).toEqual([]);
});
it('ignores stale view selections and retains document history when source revision changes', () => {
  const f = mounted();
  f.edit('X');
  const saved = f.read().document!;
  f.dispatch(
    pageStateReceived('w', 'n', f.read().generation, {
      ...f.read().state!,
      stateGeneration: '2',
      sourceRevision: 'r2',
    }),
  );
  expect(f.owner.current()).toBe(false);
  f.owner.select({ anchor: 0, head: 0, anchorAffinity: 1, headAffinity: 1 });
  expect(f.read().document).toBe(saved);
  expect(f.edit('Y').transactions).toHaveLength(0);
  expect(f.read().drafts).toHaveLength(1);
});
it.each(['revision', 'incarnation'] as const)(
  'reinitializes only a pristine session after authoritative %s replacement',
  (kind) => {
    const f = mounted();
    const before = f.read().document!;
    const state = {
      ...f.read().state!,
      stateGeneration: '2',
      ...(kind === 'revision'
        ? { sourceRevision: 'r2' }
        : { scope: { ...scope, noteInstanceId: 'new-instance' } }),
    };
    f.dispatch(pageStateReceived('w', 'n', f.read().generation, state));
    expect(f.read().document).toBeUndefined();
    expect(f.owner.current()).toBe(false);
    f.dispatch(pageWindowRequested('w', 'n', 'panel', 100));
    f.dispatch(
      pageWindowSettled(
        'w',
        'n',
        'panel',
        f.read().generation,
        f.read().windows.panel.request,
        { ...f.w, scope: state.scope, sourceRevision: state.sourceRevision },
        null,
      ),
    );
    expect(f.read().document).not.toBe(before);
    expect(f.read().document?.scope).toEqual(state.scope);
    expect(f.read().document?.baseRevision).toBe(state.sourceRevision);
    expect(f.read().document?.history).toEqual([]);
  },
);
it('preserves clean document identity for comment-only state updates', () => {
  const f = mounted();
  const before = f.read().document!;
  f.dispatch(
    pageStateReceived('w', 'n', f.read().generation, {
      ...f.read().state!,
      stateGeneration: '2',
      commentRevision: '2',
    }),
  );
  expect(f.read().document).toBe(before);
});
it.each(['revision', 'incarnation'] as const)(
  'retains undo and redo after %s changes even when net-noop drafts were cleared',
  (kind) => {
    const f = mounted();
    f.edit('X');
    const edited = f.read().document!;
    const undone = moveNoteDocumentHistory(edited, 'undo')!;
    f.dispatch(
      pageDocumentPublished('w', 'n', f.read().generation, edited, undone.state, undone.splices),
    );
    f.dispatch(pageDraftsUnchanged('w', 'n', f.read().generation, 'r1', 2));
    expect(f.read().drafts).toEqual([]);
    const before = f.read().document!;
    const state = {
      ...f.read().state!,
      stateGeneration: '2',
      ...(kind === 'revision'
        ? { sourceRevision: 'r2' }
        : { scope: { ...scope, noteInstanceId: 'new-instance' } }),
    };
    f.dispatch(pageStateReceived('w', 'n', f.read().generation, state));
    expect(f.read().document).toBe(before);
    expect(f.read().needsReconcile).toBe(true);
    expect(moveNoteDocumentHistory(before, 'redo')?.state.dirty).toEqual([
      { start: 101, end: 101, text: 'X' },
    ]);
    expect(f.owner.current()).toBe(false);
  },
);

it.each([false, true])(
  'keeps document reconciliation gated after draft-only mapping (later edit: %s)',
  (later) => {
    const f = mounted();
    f.edit('X');
    const captured = f.read().document!;
    const operation = {
      scope,
      baseRevision: 'r1',
      operationId: 'save-exact',
      payloadDigest: 'captured-digest',
      expiresAt: '2099-01-01T00:00:00.000Z',
      splices: f.read().drafts[0].splices,
    };
    f.dispatch(pageSaveStarted('w', 'n', operation, 1));
    expect(f.read().pending?.operation).toEqual(operation);
    if (later) f.edit('Y');
    const document = f.read().document!;
    const receipt = {
      kind: 'noteCommitReceipt' as const,
      outcome: 'committed' as const,
      scope,
      operationId: operation.operationId,
      payloadDigest: operation.payloadDigest,
      beforeRevision: 'r1',
      afterRevision: 'r2',
      sourceLength: captured.length,
      mappingRef: 'mapping',
      effectsRef: 'effects',
      inverseRef: 'inverse',
      receiptExpiresAt: '2099-01-08T00:00:00.000Z',
      invalidation: 'all' as const,
    };
    f.dispatch(pageSaveSettled('w', 'n', receipt));
    f.dispatch(
      pageStateReceived('w', 'n', f.read().generation, {
        ...f.read().state!,
        sourceRevision: 'r2',
        stateGeneration: '2',
      }),
    );
    const before = f.read();
    expect(before.needsReconcile).toBe(true);
    expect(before.document).toBe(document);
    expect(before.document!.baseRevision).toBe('r1');
    expect(before.drafts).toHaveLength(later ? 1 : 0);
    f.dispatch(
      pageMappingAccepted(
        'w',
        'n',
        operation.operationId,
        before.drafts.map((d) => ({ ...d, baseRevision: 'r2' })),
      ),
    );
    expect(f.read()).toBe(before);
    expect(f.read().needsReconcile).toBe(true);
    expect(f.read().document).toBe(document);
    expect(f.read().document!.history).toBe(document.history);
    expect(f.read().drafts).toBe(before.drafts);
    expect(f.read().receipts).toEqual([receipt]);
    expect(f.owner.current()).toBe(false);
  },
);
