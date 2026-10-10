import { readNoteStagedReceiptResult } from './note-staged-receipt-result';
import { noteStagedSaveContinuity } from './note-staged-save-continuity';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { runSaga, stdChannel } from 'redux-saga';
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
import { backendRequest } from '$lib/client/live/backend-transport';
import { LiveNotePagesClient } from '$lib/client/live/live-note-pages-client';
import { appClient } from '$lib/client';
import { notePagesSaga } from '$store/renderer/slices/note-pages/sagas/note-pages-saga';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
import { createNoteEditAuthority } from './note-edit-authority';
import { NoteCanonicalProjection } from '../note-canonical-projection';
import type { NoteWindow } from '../note-window-reader';
import type { NotePageSession } from '$store/renderer/slices/note-pages/note-pages-types';
import {
  createNoteDocumentSession,
  prepareNoteDocumentEdit,
  reconcileNoteDocumentSave,
  moveNoteDocumentHistory,
  materializeNoteDocumentAuthority,
} from './note-document-edit-session';
import { stageNoteDocumentSave, retryStagedDocumentSave } from './note-staged-save';
const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*' },
    text: {},
  },
  marks: { bold: {} },
});
const scope = { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' };
function nativeFixture(
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

const rpc = vi.mocked(backendRequest);
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
          .join(',')}}`
      : JSON.stringify(v);
const hash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const originalClient = appClient.notes.pages;
const tasks: ReturnType<typeof runSaga>[] = [];
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  tasks.forEach((t) => t.cancel());
  tasks.length = 0;
  appClient.notes.pages = originalClient;
  vi.restoreAllMocks();
});
function setup(text = 'X', single = false) {
  const native = nativeFixture('abc', 0, 3);
  let state = a.notePagesReducer(undefined, a.pagePanelOpened('w', 'n', 'panel'));
  const initial = state.byWorkspaceId.w.notes.n;
  state = {
    ...state,
    byWorkspaceId: {
      w: {
        notes: {
          n: {
            ...initial,
            status: 'ready',
            document: native.session,
            state: {
              kind: 'notePageState',
              scope,
              sourceRevision: 'r1',
              stateGeneration: '1',
              attributionGeneration: '1',
              commentRevision: '1',
              attributionState: 'ready',
              deleted: false,
              invalidation: 'all',
            },
          },
        },
      },
    },
  };
  const listeners = new Set<() => void>(),
    channel = stdChannel();
  const read = () => state.byWorkspaceId.w.notes.n;
  const dispatch = (action: Parameters<typeof a.notePagesReducer>[1]) => {
    state = a.notePagesReducer(state, action);
    for (const fn of [...listeners]) fn();
    channel.put(action);
  };
  const port = {
    read: () => state,
    dispatch,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  dispatch(
    a.pageResourceLimitsConfigured({
      payloadBytes: 20_000_000,
      stringUnits: 20_000_000,
      objectNodes: 1_000_000,
      physicalReads: 2,
      assemblies: 2,
      domNodes: 0,
    }),
  );
  let authority = native.authority;
  const edit = (value: string, appendTo?: number, end = 2) => {
    const before = read().document!;
    const result = prepareNoteDocumentEdit(
      before,
      EditorState.create({ doc: authority.doc })
        .tr.setSelection(TextSelection.create(authority.doc, 2))
        .insertText(value, 2, end),
      authority,
      appendTo === undefined ? {} : { appendTo },
    );
    dispatch(
      a.pageDocumentPublished('w', 'n', read().generation, before, result.state, result.splices),
    );
    expect(read().document).toBe(result.state);
    authority = result.authority;
    return result;
  };
  const first = edit(text);
  if (!single) {
    edit('Y', first.historyGroup);
    edit('Z');
  }
  const options = { editorSessionId: 'editor', selectionGeneration: 17, panelId: 'panel' };
  const client = new LiveNotePagesClient();
  vi.spyOn(client, 'capabilities').mockResolvedValue(null);
  let identity: Record<string, unknown>, payloadDigest: unknown;
  const streams = ['text', 'dirty', 'selection', 'mutation', 'live'].map((stream) => ({
    stream,
    nextSequence: 0,
    lastDigest: null as string | null,
  }));
  const dirty: Array<Record<string, unknown>> = [],
    uploaded = new Map<string, string>();
  const stage = (phase: string) => ({
    kind: 'noteStageState',
    scope,
    operationId: identity.operationId,
    headerDigest: identity.headerDigest,
    baseRevision: (identity.header as { baseRevision: string }).baseRevision,
    expiresAt: identity.expiresAt,
    phase,
    streams: streams.map((s) => ({ ...s })),
    ...(phase === 'sealed' ? { payloadDigest, viewLength: read().document!.length } : {}),
  });
  const receipt = () => ({
    kind: 'noteCommitReceipt',
    outcome: 'committed',
    scope,
    operationId: identity.operationId,
    headerDigest: identity.headerDigest,
    payloadDigest,
    viewId: 'sealed-view',
    beforeRevision: (identity.header as { baseRevision: string }).baseRevision,
    afterRevision: 'r-final',
    sourceLength: read().document!.length,
    mappingRef: 'mapping',
    effectsRef: 'effects',
    inverseRef: 'inverse',
    receiptExpiresAt: '2099-01-01T00:00:00Z',
    invalidation: 'all',
  });
  const transport = async (method: string, raw: unknown): Promise<unknown> => {
    const p = raw as Record<string, unknown>;
    if (method !== 'note.operationStatus')
      expect(state.resourceLedger.used.physicalReads).toBeGreaterThan(0);
    if (method === 'note.operation.begin') {
      const { headerDigest, ...rest } = p;
      expect(headerDigest).toBe(hash({ method, ...rest }));
      identity = p;
      expect(p.header).toEqual({
        baseRevision: read().document!.baseRevision,
        editorSessionId: 'editor',
        localEditSequence: read().document!.history[read().document!.cursor - 1].id,
        liveGeneration: read().document!.generation,
        selectionGeneration: 17,
        action: 'mutate',
        output: 'source',
        selection: 'all',
      });
      return stage('staging');
    }
    expect(p.headerDigest).toBe(identity.headerDigest);
    if (method === 'note.operation.append') {
      const { stream, sequence, previousDigest, records, chunkDigest } = p;
      expect(chunkDigest).toBe(hash({ stream, sequence, previousDigest, records }));
      const s = streams.find((s) => s.stream === stream)!;
      expect(sequence).toBe(s.nextSequence);
      expect(previousDigest).toBe(s.lastDigest);
      for (const r of records as Array<Record<string, unknown>>) {
        if (stream === 'text') {
          const old = uploaded.get(r.id as string) ?? '';
          expect(r.offset).toBe(old.length);
          uploaded.set(r.id as string, old + r.text);
        } else {
          const ref = r.replacement as { textId: string };
          const text = uploaded.get(ref.textId)!;
          expect(r.replacement).toEqual({
            textId: ref.textId,
            length: text.length,
            utf8Bytes: Buffer.byteLength(text),
            sha256: createHash('sha256').update(text).digest('hex'),
          });
          dirty.push(r);
        }
      }
      s.nextSequence++;
      s.lastDigest = chunkDigest as string;
      return {
        kind: 'noteStageAck',
        scope,
        operationId: p.operationId,
        stream,
        sequence,
        chunkDigest,
        nextSequence: s.nextSequence,
      };
    }
    if (method === 'note.operation.seal') {
      expect(p.payloadDigest).toBe(hash({ headerDigest: p.headerDigest, manifest: p.manifest }));
      payloadDigest = p.payloadDigest;
      expect((p.manifest as { records: number }[]).slice(2).every((m) => m.records === 0)).toBe(
        true,
      );
      return stage('sealed');
    }
    if (method === 'note.operation.cancel') return stage('cancelled');
    expect(['note.operation.commit', 'note.operationStatus']).toContain(method);
    expect(p).toEqual({
      ...scope,
      operationId: identity.operationId,
      headerDigest: identity.headerDigest,
      payloadDigest,
    });
    return receipt();
  };
  rpc.mockImplementation(transport);
  const run = () => stageNoteDocumentSave(port, client, 'w', 'n', options);
  const startSaga = () => {
    appClient.notes.pages = client;
    const task = runSaga(
      {
        channel,
        dispatch,
        getState: () => ({ notePages: state }),
        context: {
          reduxStore: {
            getState: () => ({ notePages: state }),
            dispatch,
            subscribe: port.subscribe,
          },
        },
      },
      notePagesSaga,
    );
    tasks.push(task);
    return task;
  };
  const clean = () => {
    if (read()?.pending || read()?.committedDocumentSave) {
      expect(state.resourceLedger.used.payloadBytes).toBeGreaterThan(0);
      dispatch(a.pageSessionDiscarded('w', 'n'));
    }
    expect(state.resourceLedger.used.payloadBytes).toBe(0);
    expect(state.resourceLedger.used.physicalReads).toBe(0);
    expect(listeners.size).toBe(0);
  };
  return {
    read,
    port,
    dispatch,
    run,
    startSaga,
    options,
    client,
    dirty,
    uploaded,
    transport,
    receipt,
    stage,
    edit,
    clean,
    rebase() {
      const old = read(),
        before = old.document!;
      const saved = reconcileNoteDocumentSave(before, {
        generation: before.generation,
        baseRevision: before.baseRevision,
        sourceRevision: 'r2',
        sourceLength: before.length,
        exactLocalResult: true,
      });
      const fresh = nativeFixture(authority.source, 0, before.length);
      fresh.w.sourceRevision = 'r2';
      const projection = new NoteCanonicalProjection(fresh.w);
      authority = createNoteEditAuthority(
        fresh.w,
        projection,
        [fresh.owner],
        schema.nodeFromJSON(projection.content),
      ).atGeneration(saved.generation);
      state = {
        ...state,
        byWorkspaceId: {
          w: {
            notes: {
              n: {
                ...old,
                document: saved,
                drafts: [],
                history: old.history.map((d) => ({ ...d, baseRevision: 'r2' })),
                state: { ...old.state!, sourceRevision: 'r2' },
              },
            },
          },
        },
      };
    },
    replace(n: NotePageSession) {
      state = { ...state, byWorkspaceId: { w: { notes: { n } } } };
      for (const f of [...listeners]) f();
    },
  };
}
it('uses actual native root/appended groups through explicit save saga, preserving history and reconciliation gate', async () => {
  const f = setup(),
    before = f.read().document!;
  expect(before.history.map((g) => g.id)).toEqual([1, 3]);
  expect(f.read().drafts.map((d) => d.sequence)).toEqual([1, 2, 3]);
  f.startSaga();
  f.dispatch(a.pageSaveDraftsRequested('w', 'n', f.options));
  await vi.waitFor(() => expect(f.read().receipts).toHaveLength(1));
  await vi.waitFor(() => expect(f.port.read().resourceLedger.used.physicalReads).toBe(0));
  expect(f.dirty.map((g) => [g.localSequence, g.ordinal])).toEqual([
    [1, 0],
    [3, 0],
  ]);
  expect(f.read().document).toBe(before);
  expect(f.read().document?.history).toBe(before.history);
  expect(f.read().needsReconcile).toBe(true);
  expect(f.read().drafts).toEqual([]);
  expect(f.read().committedDocumentSave?.receipt).toBe(f.read().receipts[0]);
  expect(rpc.mock.calls.filter(([m]) => m === 'note.operation.commit')).toHaveLength(1);
});
it('preserves forty existing native groups without flattening them into one save gesture', async () => {
  const f = setup();
  for (let i = 0; i < 38; i++) f.edit('q');
  const groups = f.read().document!.history;
  expect(groups).toHaveLength(40);
  await f.run();
  expect(f.dirty.map((d) => d.localSequence)).toEqual(groups.map((g) => g.id));
  expect(f.dirty.every((d) => d.ordinal === 0)).toBe(true);
  expect(rpc.mock.calls.filter(([m]) => m === 'note.applySplices')).toEqual([]);
  f.clean();
});
it.each(['undo', 'replay', 'composition'] as const)(
  'refuses unsupported %s provenance before RPC',
  async (kind) => {
    const f = setup(),
      n = f.read(),
      doc = n.document!;
    const bad =
      kind === 'undo'
        ? {
            ...doc,
            replay: [{ ...doc.replay[0], direction: 'undo' as const }, ...doc.replay.slice(1)],
          }
        : kind === 'replay'
          ? { ...doc, replay: doc.replay.map((r) => ({ ...r, edits: [...r.edits] })) }
          : { ...doc, dirty: [{ start: 0, end: 0, text: 'same-length-but-wrong' }] };
    f.replace({ ...n, document: bad });
    await expect(f.run()).rejects.toThrow(/Unsupported|does not compose/);
    expect(rpc).not.toHaveBeenCalled();
    expect(f.read().drafts).toBe(n.drafts);
    f.clean();
  },
);
it('retains exact sealed operation after lost commit acknowledgement and status-recovers without reupload or recommit', async () => {
  const f = setup();
  rpc.mockImplementation(async (m, p) => {
    if (m === 'note.operation.commit') throw new Error('ACK lost');
    return f.transport(m, p);
  });
  await f.run();
  const pending = f.read().pending!;
  expect(pending.status).toBe('unknown');
  expect(pending.operation).toHaveProperty('headerDigest');
  expect(f.read().drafts).toHaveLength(3);
  expect(f.port.read().resourceLedger.used.physicalReads).toBe(0);
  expect(f.port.read().resourceLedger.used.payloadBytes).toBeGreaterThan(0);
  f.startSaga();
  f.dispatch(a.pageSaveRetryRequested('w', 'n'));
  await vi.waitFor(() => expect(f.read().receipts).toHaveLength(1));
  expect(rpc.mock.calls.filter(([m]) => m === 'note.operation.commit')).toHaveLength(1);
  expect(rpc.mock.calls.filter(([m]) => m === 'note.operation.begin')).toHaveLength(1);
  expect(f.read().needsReconcile).toBe(true);
});
it('holds physical IO through owner loss and cancel settlement before releasing DATA', async () => {
  const f = setup(),
    held = deferred(),
    entered = deferred(),
    cleanup = deferred(),
    cancelling = deferred();
  rpc.mockImplementation(async (m, p) => {
    const result = await f.transport(m, p);
    if (m === 'note.operation.append') {
      entered.resolve();
      await held.promise;
    }
    if (m === 'note.operation.cancel') {
      cancelling.resolve();
      await cleanup.promise;
    }
    return result;
  });
  const run = f.run(),
    observed = expect(run).rejects.toThrow(/superseded/);
  await entered.promise;
  f.dispatch(a.pagePanelClosed('w', 'n', 'panel'));
  f.dispatch(a.pagePanelOpened('w', 'n', 'panel'));
  expect(f.port.read().resourceLedger.used.physicalReads).toBe(1);
  held.resolve();
  await cancelling.promise;
  expect(f.port.read().resourceLedger.used.physicalReads).toBe(1);
  cleanup.resolve();
  await observed;
  expect(rpc.mock.calls.filter(([m]) => m === 'note.operation.commit')).toEqual([]);
  f.clean();
});
it('denied or queued DATA admission performs zero RPC and retains draft/history state', async () => {
  const f = setup(),
    before = f.read();
  f.dispatch(
    a.pageResourceLimitsConfigured({ ...f.port.read().resourceLedger.limit, payloadBytes: 0 }),
  );
  await expect(f.run()).rejects.toThrow(/unadmitted/);
  expect(rpc).not.toHaveBeenCalled();
  expect(f.read().document).toBe(before.document);
  f.clean();
});
it('keeps staged receipt header identity in the actual reducer pending match', async () => {
  const f = setup();
  rpc.mockImplementation(async (m, p) =>
    m === 'note.operation.commit'
      ? { ...((await f.transport(m, p)) as object), headerDigest: '0'.repeat(64) }
      : f.transport(m, p),
  );
  await f.run();
  expect(f.read().pending?.status).toBe('unknown');
  expect(f.read().receipts).toEqual([]);
  expect(f.read().drafts).toHaveLength(3);
  f.clean();
});
it('status-first sealed recovery retries the exact admitted commit without repeating upload', async () => {
  const f = setup();
  let calls = 0;
  rpc.mockImplementation(async (m, p) => {
    if (m === 'note.operation.commit' && ++calls === 1)
      throw new Error('Request lost before admission');
    if (m === 'note.operationStatus') return f.stage('sealed');
    return f.transport(m, p);
  });
  await f.run();
  const op = f.read().pending!.operation;
  await retryStagedDocumentSave(f.port, f.client, 'w', 'n');
  expect(f.read().receipts).toHaveLength(1);
  expect(f.read().needsReconcile).toBe(true);
  const commits = rpc.mock.calls.filter(([m]) => m === 'note.operation.commit');
  expect(commits).toHaveLength(2);
  expect(commits[1]).toEqual(commits[0]);
  expect(rpc.mock.calls.filter(([m]) => m === 'note.operation.begin')).toHaveLength(1);
  expect(f.read().receipts[0].operationId).toBe(op.operationId);
  f.clean();
});
it.each(['cancelled', 'expired'] as const)(
  'handles definitive %s stage status without fabricated save outcome',
  async (phase) => {
    const f = setup();
    rpc.mockImplementation(async (m, p) => {
      if (m === 'note.operation.commit') throw new Error('ACK lost');
      if (m === 'note.operationStatus') return f.stage(phase);
      return f.transport(m, p);
    });
    await f.run();
    const before = f.read();
    await retryStagedDocumentSave(f.port, f.client, 'w', 'n');
    expect(f.read().pending).toBeNull();
    expect(f.read().error).toBe(`Staged save ${phase}`);
    expect(f.read().drafts).toBe(before.drafts);
    expect(f.read().document).toBe(before.document);
    expect(f.read().receipts).toEqual([]);
    f.clean();
  },
);
it('serializes concurrent status recovery while retaining DATA until its held RPC settles', async () => {
  const f = setup(),
    entered = deferred(),
    held = deferred();
  rpc.mockImplementation(async (m, p) => {
    if (m === 'note.operation.commit') throw new Error('ACK lost');
    if (m === 'note.operationStatus') {
      entered.resolve();
      await held.promise;
      return f.stage('expired');
    }
    return f.transport(m, p);
  });
  await f.run();
  const retry = retryStagedDocumentSave(f.port, f.client, 'w', 'n');
  await entered.promise;
  await retryStagedDocumentSave(f.port, f.client, 'w', 'n');
  expect(rpc.mock.calls.filter(([m]) => m === 'note.operationStatus')).toHaveLength(1);
  expect(f.port.read().resourceLedger.used.physicalReads).toBe(1);
  held.resolve();
  await retry;
  f.clean();
});
it('does not recommit a sealed capture after later editing', async () => {
  const f = setup();
  rpc.mockImplementation(async (m, p) => {
    if (m === 'note.operation.commit') throw new Error('ACK lost');
    if (m === 'note.operationStatus') {
      const status = f.stage('sealed');
      return {
        ...status,
        viewLength: (f.read().pending!.operation as { viewLength: number }).viewLength,
      };
    }
    return f.transport(m, p);
  });
  await f.run();
  f.edit('later');
  const doc = f.read().document;
  await retryStagedDocumentSave(f.port, f.client, 'w', 'n');
  expect(f.read().pending?.status).toBe('unknown');
  expect(f.read().document).toBe(doc);
  expect(rpc.mock.calls.filter(([m]) => m === 'note.operation.commit')).toHaveLength(1);
  f.clean();
});
it('rejects mismatched status manifest without retrying a commit', async () => {
  const f = setup();
  rpc.mockImplementation(async (m, p) => {
    if (m === 'note.operation.commit') throw new Error('ACK lost');
    if (m === 'note.operationStatus') return { ...f.stage('sealed'), streams: [] };
    return f.transport(m, p);
  });
  await f.run();
  await retryStagedDocumentSave(f.port, f.client, 'w', 'n');
  expect(f.read().pending?.status).toBe('unknown');
  expect(rpc.mock.calls.filter(([m]) => m === 'note.operation.commit')).toHaveLength(1);
  f.clean();
});
it('keeps original native IDs distinct from a higher Redux draft sequence fence', async () => {
  const f = setup(),
    n = f.read(),
    drafts = n.drafts.map((d) => ({ ...d, sequence: d.sequence + 100 }));
  f.replace({ ...n, drafts, history: [drafts.at(-1)!] });
  rpc.mockImplementation(async (m, p) => {
    if (m === 'note.operation.commit') throw new Error('ACK lost');
    return f.transport(m, p);
  });
  await f.run();
  expect(f.dirty.map((d) => d.localSequence)).toEqual([1, 3]);
  expect(f.read().pending?.throughSequence).toBe(103);
  f.clean();
});
it('allows selection-only navigation during upload and preserves current directional selection', async () => {
  const f = setup();
  let selected = false;
  rpc.mockImplementation(async (m, p) => {
    const result = await f.transport(m, p);
    if (m === 'note.operation.append' && !selected) {
      selected = true;
      const d = f.read().document!;
      f.dispatch(
        a.pageDocumentSelectionChanged('w', 'n', f.read().generation, d, {
          anchor: 2,
          head: 1,
          anchorAffinity: -1,
          headAffinity: 1,
        }),
      );
    }
    return result;
  });
  await f.run();
  expect(f.read().document!.selection).toEqual({
    anchor: 2,
    head: 1,
    anchorAffinity: -1,
    headAffinity: 1,
  });
  f.clean();
});
it('uploads only the actual forward replay suffix after a saved base while retaining old undo groups', async () => {
  const f = setup();
  f.rebase();
  const old = f.read().document!.history;
  const next = f.edit('C');
  expect(f.read().document!.history).toHaveLength(old.length + 1);
  await f.run();
  expect(f.dirty.map((d) => d.localSequence)).toEqual([next.historyGroup]);
  expect(f.read().document!.history.slice(0, old.length)).toEqual(old);
  f.clean();
});
it('uploads an owned empty text record for a native deletion without inventing a missing-reference shorthand', async () => {
  const f = setup();
  const deletion = f.edit('', undefined, 3);
  await f.run();
  const ref = f.dirty.find((d) => d.localSequence === deletion.historyGroup)!.replacement as {
    textId: string;
    length: number;
    sha256: string;
  };
  expect(ref.length).toBe(0);
  expect(f.uploaded.has(ref.textId)).toBe(true);
  expect(f.uploaded.get(ref.textId)).toBe('');
  expect(ref.sha256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  f.clean();
});

function receiptFixture(
  f: ReturnType<typeof setup>,
  mutate?: (kind: string, page: Record<string, unknown>) => void,
) {
  f.dispatch(
    a.pageResourceLimitsConfigured({
      payloadBytes: 20_000_000,
      stringUnits: 20_000_000,
      objectNodes: 1_000_000,
      physicalReads: 2,
      assemblies: 2,
      domNodes: 0,
    }),
  );
  const doc = f.read().document!;
  const nativeGroups = doc.history.slice(doc.cursor - doc.replay.length, doc.cursor).reverse();
  const texts = new Map<string, string>();
  const inverse = nativeGroups.flatMap((g, i) =>
    g.inverse.map((s, ordinal) => {
      const textId = `removed:${i}:${ordinal}`;
      texts.set(textId, s.text);
      return {
        historyGroup: i === 0 ? '00' : `opaque:${i}`, // opaque; not local numeric IDs
        inputState: i === 0 ? 'r-final' : `intermediate:${i}`,
        outputState: i === nativeGroups.length - 1 ? doc.baseRevision : `intermediate:${i + 1}`,
        ordinal,
        start: s.start,
        end: s.end,
        replacement: {
          textId,
          length: s.text.length,
          utf8Bytes: Buffer.byteLength(s.text),
          sha256: createHash('sha256').update(s.text).digest('hex'),
        },
        provenanceRef: `retained:${i}:${ordinal}`,
      };
    }),
  );
  const details = new Map<string, unknown[]>();
  const encode = (
    ref: string,
    value: unknown,
    parentId: string | null = null,
    key?: string,
  ): unknown => {
    const id = `${ref}:node`;
    const entry = { id, parentId, ...(key === undefined ? {} : { key }) };
    if (typeof value === 'object' && value !== null) {
      const childrenRef = `${ref}:children`;
      details.set(
        childrenRef,
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([k, v]) => encode(`${ref}:${k}`, v, id, k)),
      );
      return { ...entry, type: 'object', childrenRef };
    }
    return { ...entry, type: typeof value, value };
  };
  for (let i = 0; i < nativeGroups.length; i++) {
    const g = nativeGroups[i];
    for (let j = 0; j < g.inverse.length; j++) {
      const item = inverse.find((r) => r.provenanceRef === `retained:${i}:${j}`)!;
      details.set(item.provenanceRef, [
        encode(item.provenanceRef, {
          kind: 'sourceProvenance',
          inputState: item.inputState,
          outputState: item.outputState,
          baseRange: { start: g.forward[j].start, end: g.forward[j].end },
          finalRange: { start: item.start, end: item.end },
          replacement: item.replacement,
        }),
      ]);
    }
  }
  const readPage = async (raw: unknown) => {
    const p = raw as Record<string, unknown>,
      r = f.receipt();
    expect(p.headerDigest).toBe(r.headerDigest);
    expect(p).not.toHaveProperty('payloadDigest');
    expect(p.operationId).toBe(r.operationId);
    expect(f.port.read().resourceLedger.used.physicalReads).toBeGreaterThan(0);
    const page: Record<string, unknown> = {
      kind: 'noteOperationPage',
      scope,
      operationId: r.operationId,
      payloadDigest: r.payloadDigest,
      headerDigest: r.headerDigest,
      viewId: r.viewId,
      outputKind: p.kind,
      sourceLength:
        p.kind === 'mapping' || p.kind === 'effects' || p.kind === 'detail'
          ? doc.baseLength
          : doc.length,
      expiresAt: r.receiptExpiresAt,
      nextCursor: null,
    };
    if (p.kind === 'mapping') {
      expect(p.ref).toBe(r.mappingRef);
      page.items = doc.dirty.map((s) => ({
        start: s.start,
        end: s.end,
        insertedLength: s.text.length,
      }));
    } else if (p.kind === 'effects') {
      expect(p.ref).toBe(r.effectsRef);
      page.convertedCount = 0;
      page.items = [
        {
          kind: 'annotationInvalidation',
          sourceRevision: 'r-final',
          attributionGeneration: '2',
          commentRevision: '2',
        },
      ];
    } else if (p.kind === 'inverse') {
      expect(p.ref).toBe(r.inverseRef);
      const i = p.cursor === undefined ? 0 : Number(String(p.cursor).slice(5));
      page.items = inverse.slice(i, i + 1);
      page.nextCursor = i + 1 < inverse.length ? `next:${i + 1}` : null;
    } else if (p.kind === 'detail') {
      expect(details.has(String(p.ref))).toBe(true);
      page.items = details.get(String(p.ref));
    } else {
      expect(p.kind).toBe('inverseText');
      expect(p.ref).toBe(r.inverseRef);
      expect(p.maxItems).toBe(1);
      expect(p.maxSourceBytes).toBe(4096);
      const text = texts.get(String(p.textId))!;
      const offset = p.cursor === undefined ? Number(p.offset) : Number(String(p.cursor).slice(5));
      if (p.cursor !== undefined) expect(p).not.toHaveProperty('offset');
      const fragment = [...text.slice(offset)][0] ?? '';
      page.items = [{ textId: p.textId, offset, text: fragment }];
      page.nextCursor =
        offset + fragment.length < text.length ? `text:${offset + fragment.length}` : null;
    }
    mutate?.(String(p.kind), page);
    return page;
  };
  rpc.mockImplementation((m, p) => (m === 'note.operation.read' ? readPage(p) : f.transport(m, p)));
  return { doc, inverse, readPage, details, encode };
}
function publishSavedState(f: ReturnType<typeof setup>) {
  const n = f.read();
  f.dispatch(
    a.pageStateReceived('w', 'n', n.generation, {
      ...n.state!,
      sourceRevision: 'r-final',
      stateGeneration: '2',
    }),
  );
}
it('adopts exact staged native groups through real saga and rematerializes saved-base undo/redo without changing history identities', async () => {
  const f = setup();
  const { doc } = receiptFixture(f);
  await f.run();
  f.startSaga();
  publishSavedState(f);
  await vi.waitFor(() => expect(f.read().needsReconcile).toBe(false));
  const saved = f.read().document!;
  expect(saved.baseRevision).toBe('r-final');
  expect(saved.history).toBe(doc.history);
  expect(saved.cursor).toBe(doc.cursor);
  expect(saved.dirty).toEqual([]);
  expect(saved.replay).toEqual([]);
  expect(f.read().drafts).toEqual([]);
  expect(f.read().receipts).toEqual([]);
  const text =
    'abc'.slice(0, doc.dirty[0].start) + doc.dirty[0].text + 'abc'.slice(doc.dirty[0].end);
  const fresh = nativeFixture(text, 0, text.length);
  fresh.w.sourceRevision = 'r-final';
  const base = createNoteEditAuthority(
    fresh.w,
    fresh.projection,
    [fresh.owner],
    fresh.authority.doc,
  );
  const undo = moveNoteDocumentHistory(saved, 'undo')!.state;
  const native = materializeNoteDocumentAuthority(undo, base);
  expect(native.doc.textContent).toBe('aYXbc');
  const redo = moveNoteDocumentHistory(undo, 'redo')!.state;
  expect(materializeNoteDocumentAuthority(redo, base).source).toBe(text);
  const later = prepareNoteDocumentEdit(
    redo,
    EditorState.create({ doc: materializeNoteDocumentAuthority(redo, base).doc }).tr.insertText(
      'Q',
      2,
    ),
    materializeNoteDocumentAuthority(redo, base),
  );
  expect(
    materializeNoteDocumentAuthority(moveNoteDocumentHistory(later.state, 'undo')!.state, base)
      .source,
  ).toBe(text);
  await vi.waitFor(() => expect(f.port.read().resourceLedger.used.physicalReads).toBe(0));
});
it.each([
  'sourceEffect',
  'converted',
  'missingGroup',
  'groupIdentity',
  'ordinal',
  'stateChain',
  'digest',
  'text',
  'expiry',
  'provenance',
])('retains staged receipt, document and reconciliation gate on %s', async (failure) => {
  const f = setup('🙂');
  const { doc } = receiptFixture(f, (kind, p) => {
    if (failure === 'sourceEffect' && kind === 'effects') p.items = [{ kind: 'sourceEffect' }];
    if (failure === 'converted' && kind === 'effects') {
      p.convertedCount = 1;
      p.items = [];
    }
    if (failure === 'missingGroup' && kind === 'inverse') p.nextCursor = null;
    if (kind === 'inverse') {
      const item = (p.items as Array<Record<string, unknown>>)[0];
      if (failure === 'groupIdentity') item.historyGroup = 'duplicate';
      if (failure === 'ordinal') item.ordinal = 1;
      if (failure === 'stateChain') item.inputState = 'foreign';
      if (failure === 'digest')
        (item.replacement as Record<string, unknown>).sha256 = 'a'.repeat(64);
    }
    if (failure === 'text' && kind === 'inverseText')
      (p.items as Array<Record<string, unknown>>)[0].text = 'wrong';
    if (failure === 'expiry') p.expiresAt = '2098-01-01T00:00:00Z';
    if (failure === 'provenance' && kind === 'detail')
      (p.items as Array<Record<string, unknown>>)[0].parentId = 'foreign';
  });
  await f.run();
  f.startSaga();
  publishSavedState(f);
  await vi.waitFor(() =>
    expect(rpc.mock.calls.some(([m]) => m === 'note.operation.read')).toBe(true),
  );
  await vi.waitFor(() => expect(f.port.read().resourceLedger.used.physicalReads).toBe(0));
  expect(f.read().needsReconcile).toBe(true);
  expect(f.read().document).toBe(doc);
  expect(f.read().document!.history).toBe(doc.history);
  expect(f.read().receipts).toHaveLength(1);
});
it('holds physical DATA through inverse text cancellation and permanently refuses panel loss plus revival', async () => {
  const f = setup();
  receiptFixture(f);
  const transport = rpc.getMockImplementation()!,
    held = deferred();
  let entered = false;
  rpc.mockImplementation(async (m, raw) => {
    if (m === 'note.operation.read' && (raw as { kind: string }).kind === 'inverseText') {
      entered = true;
      await held.promise;
    }
    return transport(m, raw);
  });
  await f.run();
  f.startSaga();
  publishSavedState(f);
  await vi.waitFor(() => expect(entered).toBe(true));
  const before = f.read();
  f.replace({ ...before, panels: {} });
  f.replace(before);
  expect(f.port.read().resourceLedger.used.physicalReads).toBe(1);
  held.resolve();
  await vi.waitFor(() => expect(f.port.read().resourceLedger.used.physicalReads).toBe(0));
  expect(f.read().needsReconcile).toBe(true);
  expect(f.read().document).toBe(before.document);
});
it('preserves older saved groups and permits undo across the adopted suffix and prior saved base', async () => {
  const f = setup();
  f.rebase();
  f.edit('C');
  const { doc } = receiptFixture(f);
  await f.run();
  expect(f.port.read().resourceLedger.used.payloadBytes).toBeGreaterThan(0);
  f.startSaga();
  publishSavedState(f);
  await vi.waitFor(() => expect(f.read().needsReconcile).toBe(false));
  const saved = f.read().document!;
  expect(saved.history).toBe(doc.history);
  const text = 'aCZYXbc',
    fresh = nativeFixture(text, 0, text.length);
  fresh.w.sourceRevision = 'r-final';
  const base = createNoteEditAuthority(
    fresh.w,
    fresh.projection,
    [fresh.owner],
    fresh.authority.doc,
  );
  const undo = moveNoteDocumentHistory(saved, 'undo')!.state;
  expect(materializeNoteDocumentAuthority(undo, base).source).toBe('aZYXbc');
  const older = moveNoteDocumentHistory(undo, 'undo')!.state;
  expect(materializeNoteDocumentAuthority(older, base).source).toBe('aYXbc');
  expect(
    materializeNoteDocumentAuthority(
      moveNoteDocumentHistory(moveNoteDocumentHistory(older, 'redo')!.state, 'redo')!.state,
      base,
    ).source,
  ).toBe(text);
  await vi.waitFor(() => expect(f.port.read().resourceLedger.used.payloadBytes).toBe(0));
});
it.each(['selection', 'nativeToken'] as const)(
  'checks retained native history during held receipt IO: %s',
  async (change) => {
    const f = setup();
    receiptFixture(f);
    const transport = rpc.getMockImplementation()!,
      held = deferred();
    let entered = false;
    rpc.mockImplementation(async (m, raw) => {
      if (m === 'note.operation.read' && (raw as { kind: string }).kind === 'inverseText') {
        entered = true;
        await held.promise;
      }
      return transport(m, raw);
    });
    await f.run();
    f.startSaga();
    publishSavedState(f);
    await vi.waitFor(() => expect(entered).toBe(true));
    const before = f.read().document!;
    if (change === 'selection')
      f.dispatch(
        a.pageDocumentSelectionChanged('w', 'n', f.read().generation, before, {
          anchor: 3,
          head: 1,
          anchorAffinity: -1,
          headAffinity: 1,
        }),
      );
    if (change === 'nativeToken') {
      const history = [...before.history];
      history[0] = { ...history[0], inverseReplay: [...history[0].inverseReplay] };
      f.replace({ ...f.read(), document: { ...before, history } });
    }
    const expected = f.read().document!;
    expect(f.port.read().resourceLedger.used.physicalReads).toBe(1);
    held.resolve();
    await vi.waitFor(() => expect(f.port.read().resourceLedger.used.physicalReads).toBe(0));
    if (change === 'selection') {
      expect(f.read().needsReconcile).toBe(false);
      expect(f.read().document!.selection).toEqual(expected.selection);
      expect(f.read().document!.history).toBe(expected.history);
      expect(f.port.read().resourceLedger.used.payloadBytes).toBe(0);
    } else {
      expect(f.read().needsReconcile).toBe(true);
      expect(f.read().document).toBe(expected);
      expect(f.read().receipts).toHaveLength(1);
      f.clean();
    }
  },
);
it.each(['range', 'missing', 'cycle', 'extra'] as const)(
  'refuses incomplete or divergent resolved inverse provenance: %s',
  async (failure) => {
    const f = setup();
    const { doc } = receiptFixture(f, (kind, page) => {
      if (kind !== 'detail') return;
      const items = page.items as Array<Record<string, unknown>>;
      if (failure === 'range') for (const item of items) if (item.key === 'start') item.value = 999;
      if (failure === 'missing') page.items = [];
      if (failure === 'cycle')
        for (const item of items) if (item.childrenRef) item.childrenRef = 'retained:0:0';
      if (failure === 'extra')
        items.push({ id: 'extra', parentId: null, type: 'number', value: 1 });
    });
    await f.run();
    f.startSaga();
    publishSavedState(f);
    await vi.waitFor(() =>
      expect(
        rpc.mock.calls.some(
          ([m, p]) => m === 'note.operation.read' && (p as { kind: string }).kind === 'detail',
        ),
      ).toBe(true),
    );
    await vi.waitFor(() => expect(f.port.read().resourceLedger.used.physicalReads).toBe(0));
    expect(f.read().needsReconcile).toBe(true);
    expect(f.read().document).toBe(doc);
    f.clean();
  },
);
it('refuses unadmitted native witness before any RPC and retires both reservations', async () => {
  const f = setup();
  f.dispatch(
    a.pageResourceLimitsConfigured({
      payloadBytes: 20_000_000,
      stringUnits: 20_000_000,
      objectNodes: 10_000,
      physicalReads: 2,
      assemblies: 2,
      domNodes: 0,
    }),
  );
  await expect(f.run()).rejects.toThrow('Native witness admission denied');
  expect(rpc).not.toHaveBeenCalled();
  f.clean();
});
it('retains the native witness allocation after discard until the physical inverse read settles', async () => {
  const f = setup();
  receiptFixture(f);
  const transport = rpc.getMockImplementation()!,
    held = deferred();
  let entered = false;
  rpc.mockImplementation(async (m, raw) => {
    if (m === 'note.operation.read' && (raw as { kind: string }).kind === 'inverseText') {
      const response = await transport(m, raw);
      entered = true;
      await held.promise;
      return response;
    }
    return transport(m, raw);
  });
  await f.run();
  const operation = f.read().committedDocumentSave!.operation;
  if (!('witnessOwner' in operation)) throw new Error('Expected staged witness');
  f.startSaga();
  publishSavedState(f);
  await vi.waitFor(() => expect(entered).toBe(true));
  const cost = f.port.read().resourceLedger.resources[operation.witnessOwner].cost;
  f.dispatch(a.pageSessionDiscarded('w', 'n'));
  const ledger = f.port.read().resourceLedger;
  expect(ledger.owners).not.toHaveProperty(operation.witnessOwner);
  expect(ledger.resources[operation.witnessOwner].cost).toEqual(cost);
  expect(Object.values(ledger.owners).some((ids) => ids.includes(operation.witnessOwner))).toBe(
    true,
  );
  expect(ledger.used.physicalReads).toBe(1);
  held.resolve();
  await vi.waitFor(() => expect(f.port.read().resourceLedger.used.physicalReads).toBe(0));
  expect(f.port.read().resourceLedger.resources).not.toHaveProperty(operation.witnessOwner);
  f.clean();
});
it.each(['undo'] as const)(
  'retains unsupported native %s crossing the saved prefix while commit acknowledgement is pending',
  async (change) => {
    const f = setup();
    receiptFixture(f);
    const transport = rpc.getMockImplementation()!,
      held = deferred();
    let entered = false;
    rpc.mockImplementation(async (m, raw) => {
      const response = await transport(m, raw);
      if (m === 'note.operation.commit') {
        entered = true;
        await held.promise;
      }
      return response;
    });
    const running = f.run();
    await vi.waitFor(() => expect(entered).toBe(true));
    const before = f.read().document!;
    if (change === 'undo') {
      const undo = moveNoteDocumentHistory(before, 'undo')!;
      f.dispatch(
        a.pageDocumentPublished('w', 'n', f.read().generation, before, undo.state, undo.splices),
      );
      expect(f.read().document).toBe(undo.state);
    }
    const later = f.read().document!,
      lastDraft = f.read().drafts.at(-1)!;
    expect(later.generation).toBeGreaterThan(before.generation);
    held.resolve();
    await running;
    f.startSaga();
    publishSavedState(f);
    expect(f.read().needsReconcile).toBe(true);
    expect(f.read().document).toBe(later);
    expect(f.read().drafts).toEqual([lastDraft]);
    expect(f.read().receipts).toHaveLength(1);
    expect(rpc.mock.calls.filter(([m]) => m === 'note.operation.read')).toEqual([]);
    f.clean();
  },
);
it('latches owner loss and revival during the final witness borrower release before adoption', async () => {
  const f = setup();
  receiptFixture(f);
  await f.run();
  let borrowed = false,
    changed = false;
  const stop = f.port.subscribe(() => {
    const hasBorrower = Object.keys(f.port.read().resourceLedger.owners).some(
      (id) => id.startsWith('staged-native:') && id.includes(':receipt:'),
    );
    if (hasBorrower) borrowed = true;
    if (borrowed && !hasBorrower && !changed) {
      changed = true;
      const before = f.read();
      f.replace({ ...before, panels: {} });
      f.replace(before);
    }
  });
  f.startSaga();
  publishSavedState(f);
  await vi.waitFor(() => expect(changed).toBe(true));
  expect(f.read().needsReconcile).toBe(true);
  expect(f.read().document!.baseRevision).toBe('r1');
  stop();
  f.clean();
});
it('refuses further nested provenance reads after transcript allocation loss and restoration', async () => {
  const f = setup();
  receiptFixture(f);
  const transport = rpc.getMockImplementation()!,
    held = deferred();
  let entered = false;
  rpc.mockImplementation(async (m, raw) => {
    const response = await transport(m, raw);
    if (m === 'note.operation.read' && (raw as { kind: string }).kind === 'detail' && !entered) {
      entered = true;
      await held.promise;
    }
    return response;
  });
  await f.run();
  f.startSaga();
  publishSavedState(f);
  await vi.waitFor(() => expect(entered).toBe(true));
  const ledger = f.port.read().resourceLedger;
  const owner = Object.keys(ledger.owners).find((id) => id.startsWith('receipt:'))!;
  const resources = ledger.owners[owner].map((id) => ({ id, cost: ledger.resources[id].cost }));
  const calls = rpc.mock.calls.length;
  f.dispatch(a.pageResourcesReleased(owner));
  f.dispatch(a.pageResourcesRequested(owner, resources, 1));
  held.resolve();
  await vi.waitFor(() => expect(f.port.read().resourceLedger.used.physicalReads).toBe(0));
  expect(rpc.mock.calls).toHaveLength(calls);
  expect(f.read().needsReconcile).toBe(true);
  f.clean();
});

async function pendingContinuation() {
  const f = setup();
  const fixture = receiptFixture(f);
  const transport = rpc.getMockImplementation()!;
  const held = deferred();
  let entered = false;
  rpc.mockImplementation(async (m, raw) => {
    const response = await transport(m, raw);
    if (m === 'note.operation.commit') {
      entered = true;
      await held.promise;
    }
    return response;
  });
  const running = f.run();
  await vi.waitFor(() => expect(entered).toBe(true));
  const move = (direction: 'undo' | 'redo') => {
    const before = f.read().document!;
    const result = moveNoteDocumentHistory(before, direction)!;
    f.dispatch(
      a.pageDocumentPublished('w', 'n', f.read().generation, before, result.state, result.splices),
    );
    expect(f.read().document).toBe(result.state);
  };
  const settle = async () => {
    held.resolve();
    await running;
    f.startSaga();
    publishSavedState(f);
  };
  return { f, fixture, move, settle };
}
it.each(['forward', 'undo', 'redo'] as const)(
  'adopts saved prefix while preserving later native %s and its chronological drafts',
  async (mode) => {
    const { f, fixture, move, settle } = await pendingContinuation();
    f.edit('😀Q');
    if (mode !== 'forward') move('undo');
    if (mode === 'redo') move('redo');
    const later = f.read().document!;
    const drafts = f.read().drafts.slice(3);
    const savedText = 'aZYXbc';
    await settle();
    await vi.waitFor(() => expect(f.read().needsReconcile).toBe(false));
    const adopted = f.read().document!;
    expect(adopted.history).toBe(later.history);
    expect(adopted.selection).toBe(later.selection);
    expect(adopted.cursor).toBe(later.cursor);
    expect(adopted.generation).toBe(later.generation + 1);
    expect(adopted.baseRevision).toBe('r-final');
    expect(adopted.baseLength).toBe(fixture.doc.length);
    expect(f.read().drafts).toEqual(drafts.map((draft) => ({ ...draft, baseRevision: 'r-final' })));
    expect(f.read().history[0].sequence).toBe(drafts.at(-1)!.sequence);
    const fresh = nativeFixture(savedText, 0, savedText.length);
    fresh.w.sourceRevision = 'r-final';
    const base = createNoteEditAuthority(
      fresh.w,
      fresh.projection,
      [fresh.owner],
      fresh.authority.doc,
    );
    expect(materializeNoteDocumentAuthority(adopted, base).source).toBe(
      mode === 'undo' ? savedText : 'a😀QZYXbc',
    );
    if (mode === 'undo') {
      expect(adopted.dirty).toEqual([]);
      expect(
        materializeNoteDocumentAuthority(moveNoteDocumentHistory(adopted, 'redo')!.state, base)
          .source,
      ).toBe('a😀QZYXbc');
    } else {
      expect(
        materializeNoteDocumentAuthority(moveNoteDocumentHistory(adopted, 'undo')!.state, base)
          .source,
      ).toBe(savedText);
    }
    expect(f.read().receipts).toEqual([]);
    f.clean();
  },
);
it.each(['prefix-undo-revival', 'branch-revival', 'journal-revival', 'append-saved'] as const)(
  'permanently refuses unsupported observed continuation path %s',
  async (mode) => {
    const { f, move, settle } = await pendingContinuation();
    if (mode === 'append-saved') f.edit('Q', f.read().document!.history.at(-1)!.id);
    else if (mode === 'prefix-undo-revival') {
      move('undo');
      move('redo');
    } else {
      f.edit('Q');
      const retained = f.read();
      if (mode === 'journal-revival') f.replace({ ...retained, drafts: retained.drafts.slice(1) });
      else {
        move('undo');
        f.replace({
          ...f.read(),
          document: { ...f.read().document!, history: f.read().document!.history.slice(0, -1) },
        });
      }
      f.replace(retained);
    }
    const later = f.read().document!;
    const drafts = f.read().drafts.filter((d) => d.sequence > 3);
    await settle();
    expect(f.read().needsReconcile).toBe(true);
    expect(f.read().document).toBe(later);
    expect(f.read().drafts).toEqual(drafts);
    expect(rpc.mock.calls.filter(([m]) => m === 'note.operation.read')).toEqual([]);
    f.clean();
  },
);
it.each(['discard', 'owner-revival', 'data-denial'] as const)(
  'retains continuation snapshot ownership through %s',
  async (mode) => {
    const { f, settle } = await pendingContinuation();
    f.edit('Q');
    const hold = deferred();
    let entered = false;
    const transport = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (m, p) => {
      if (m === 'note.operation.read' && !entered) {
        entered = true;
        await hold.promise;
      }
      return transport(m, p);
    });
    let stop = () => {};
    if (mode === 'data-denial') {
      let denied = false;
      stop = f.port.subscribe(() => {
        const owner = Object.keys(f.port.read().resourceLedger.owners).find((id) =>
          id.startsWith('staged-continuation:'),
        );
        if (owner && !denied) {
          denied = true;
          f.dispatch(a.pageResourcesReleased(owner));
        }
      });
    }
    await settle();
    if (mode === 'data-denial') {
      expect(entered).toBe(false);
      expect(f.read().needsReconcile).toBe(true);
    } else {
      await vi.waitFor(() => expect(entered).toBe(true));
      const charged = f.port.read().resourceLedger.used.payloadBytes;
      expect(charged).toBeGreaterThan(4 * 262144);
      if (mode === 'discard') f.dispatch(a.pageSessionDiscarded('w', 'n'));
      else {
        const n = f.read();
        f.replace({ ...n, panels: {} });
        f.replace(n);
      }
      expect(f.port.read().resourceLedger.used.physicalReads).toBeGreaterThan(0);
      expect(f.port.read().resourceLedger.used.payloadBytes).toBeGreaterThan(0);
      hold.resolve();
      await vi.waitFor(() => expect(f.port.read().resourceLedger.used.physicalReads).toBe(0));
      if (mode !== 'discard') expect(f.read().needsReconcile).toBe(true);
    }
    stop();
    f.clean();
  },
);

it('permanently refuses witness sponsor loss and restoration before receipt traversal', async () => {
  const { f, settle } = await pendingContinuation();
  f.edit('Q');
  const operation = f.read().pending!.operation;
  if (!('witnessOwner' in operation)) throw new Error('Expected staged operation');
  const resource = f.port.read().resourceLedger.resources[operation.witnessOwner];
  f.dispatch(a.pageResourcesReleased(operation.witnessOwner));
  f.dispatch(
    a.pageResourcesRequested(
      operation.witnessOwner,
      [{ id: operation.witnessOwner, cost: resource.cost }],
      1,
    ),
  );
  expect(f.port.read().resourceLedger.owners).toHaveProperty(operation.witnessOwner);
  await settle();
  expect(f.read().needsReconcile).toBe(true);
  expect(rpc.mock.calls.filter(([m]) => m === 'note.operation.read')).toEqual([]);
  f.clean();
});

it.each(['native-token', 'checkpoint', 'revision', 'continuity-resource'] as const)(
  'latches observed pending continuation mutation and restoration of %s',
  async (kind) => {
    const { f, settle } = await pendingContinuation();
    f.edit('Q');
    const n = f.read();
    if (kind === 'native-token') {
      const token = n.document!.history.at(-1)!.forwardReplay[0].tokens[0];
      const text = token.text;
      token.text += 'mutated';
      f.replace(n);
      token.text = text;
      f.replace(n);
    } else if (kind === 'checkpoint') {
      const checkpoint = n.history[0],
        sequence = checkpoint.sequence;
      checkpoint.sequence++;
      f.replace(n);
      checkpoint.sequence = sequence;
      f.replace(n);
    } else if (kind === 'revision') {
      f.replace({ ...n, state: { ...n.state!, sourceRevision: 'other' } });
      f.replace(n);
    } else {
      const owner = Object.keys(f.port.read().resourceLedger.owners).find((id) =>
        id.endsWith(':continuity'),
      )!;
      const resource = f.port.read().resourceLedger.resources[owner];
      f.dispatch(a.pageResourcesReleased(owner));
      f.dispatch(a.pageResourcesRequested(owner, [{ id: owner, cost: resource.cost }], 1));
    }
    await settle();
    expect(f.read().needsReconcile).toBe(true);
    expect(f.read().document).toBe(n.document);
    expect(rpc.mock.calls.filter(([m]) => m === 'note.operation.read')).toEqual([]);
    f.clean();
  },
);

it('never replaces the pinned continuation witness while receipt IO retains it', async () => {
  const { f, settle } = await pendingContinuation();
  f.edit('Q');
  const operation = f.read().pending!.operation;
  if (!('headerDigest' in operation)) throw new Error('Expected staged operation');
  const continuity = noteStagedSaveContinuity(operation, f.read())!;
  const witness = continuity.witness;
  const hold = deferred();
  let entered = false;
  const transport = rpc.getMockImplementation()!;
  rpc.mockImplementation(async (method, params) => {
    if (method === 'note.operation.read' && !entered) {
      entered = true;
      await hold.promise;
    }
    return transport(method, params);
  });
  await settle();
  await vi.waitFor(() => expect(entered).toBe(true));
  const n = f.read();
  // Even an otherwise witness-admissible source state must not replace the
  // borrowed snapshot or regain adoption after restoration during physical IO.
  f.replace({ ...n, document: { ...n.document!, generation: n.document!.generation + 1 } });
  expect(continuity.witness).toBe(witness);
  f.replace(n);
  expect(f.port.read().resourceLedger.used.physicalReads).toBeGreaterThan(0);
  hold.resolve();
  await vi.waitFor(() => expect(f.port.read().resourceLedger.used.physicalReads).toBe(0));
  expect(f.read().needsReconcile).toBe(true);
  expect(f.read().document).toBe(n.document);
  f.clean();
});

it.each(['panel', 'document', 'scratch', 'native', 'continuity'] as const)(
  'refuses commit after continuation-admission callback loses and restores %s',
  async (kind) => {
    const f = setup();
    let changed = false;
    const stop = f.port.subscribe(() => {
      const owners = Object.keys(f.port.read().resourceLedger.owners);
      if (changed || !owners.some((id) => id.endsWith(':continuity'))) return;
      changed = true;
      const n = f.read();
      if (kind === 'panel') {
        f.replace({ ...n, panels: {} });
        f.replace(n);
      } else if (kind === 'document') {
        f.replace({ ...n, document: { ...n.document!, generation: n.document!.generation + 1 } });
        f.replace(n);
      } else {
        const id = owners.find((id) =>
          kind === 'scratch'
            ? id.startsWith('staged-save:')
            : kind === 'continuity'
              ? id.endsWith(':continuity')
              : id.startsWith('staged-native:') && !id.endsWith(':continuity'),
        )!;
        const resources = f.port.read().resourceLedger.owners[id].map((key) => ({
          id: key,
          cost: f.port.read().resourceLedger.resources[key].cost,
        }));
        f.dispatch(a.pageResourcesReleased(id));
        f.dispatch(a.pageResourcesRequested(id, resources, 1));
      }
    });
    await expect(f.run()).rejects.toThrow(/superseded|continuity lost/);
    expect(changed).toBe(true);
    expect(rpc.mock.calls.filter(([method]) => method === 'note.operation.commit')).toEqual([]);
    stop();
    f.clean();
  },
);
it('denies the conservative combined snapshot peak before commit without increasing production limits', async () => {
  const f = setup();
  f.dispatch(
    a.pageResourceLimitsConfigured({ ...f.port.read().resourceLedger.limit, objectNodes: 600_000 }),
  );
  await expect(f.run()).rejects.toThrow(/Continuation admission denied/);
  expect(rpc.mock.calls.filter(([method]) => method === 'note.operation.commit')).toEqual([]);
  f.clean();
  expect(f.port.read().resourceLedger.pending).toHaveLength(0);
});

it.each(['same-length', 'changed-length'])(
  'preserves canonical adoption refusal and native history for %s output',
  async (mode) => {
    const f = setup();
    const inserted = mode === 'same-length' ? 'Z' : 'ZZ';
    const detail = {
      inputState: 'e:0:in',
      outputState: 'e:0:out',
      range: { start: 0, end: 1 },
      removed: 'a',
      inserted,
    };
    const fixture = receiptFixture(f, (kind, page) => {
      if (kind === 'effects')
        page.items = [
          {
            kind: 'sourceEffect',
            reason: 'phantom-scrub',
            inputState: detail.inputState,
            outputState: detail.outputState,
            range: detail.range,
            insertedLength: inserted.length,
            beforeDigest: createHash('sha256').update('a').digest('hex'),
            afterDigest: createHash('sha256').update(inserted).digest('hex'),
            detailRef: 'canonical-root',
          },
        ];
    });
    fixture.details.set('canonical-root', [fixture.encode('canonical-root', detail)]);
    const transport = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (m, p) => {
      const result = await transport(m, p);
      return m === 'note.operation.commit'
        ? { ...(result as object), sourceLength: fixture.doc.length + inserted.length - 1 }
        : result;
    });
    await f.run();
    const retainedReceipt = f.read().receipts[0];
    const capture = f.read().committedDocumentSave!;
    if (!('headerDigest' in capture.operation)) throw new Error('Expected staged capture');
    // Successful canonical decoding must reach the explicit adoption refusal.
    // Any swallowed scalar, digest or metadata error would fail this assertion.
    await expect(
      readNoteStagedReceiptResult(
        f.port,
        f.client,
        retainedReceipt,
        capture.operation,
        fixture.doc,
        () => true,
      ),
    ).rejects.toThrow(
      mode === 'same-length'
        ? 'Canonical staged effects unsupported'
        : 'Unsupported staged receipt capture',
    );
    expect(f.port.read().resourceLedger.used.physicalReads).toBe(0);
    rpc.mockClear();
    f.startSaga();
    publishSavedState(f);
    if (mode === 'same-length') {
      await vi.waitFor(() =>
        expect(
          rpc.mock.calls.some(
            ([, p]) => (p as { ref?: string }).ref === 'canonical-root:range:children',
          ),
        ).toBe(true),
      );
    } else {
      // Existing continuation admission refuses changed extents before traversal.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(rpc.mock.calls.some(([method]) => method === 'note.operation.read')).toBe(false);
    }
    await vi.waitFor(() => expect(f.port.read().resourceLedger.used.physicalReads).toBe(0));
    expect(f.read().needsReconcile).toBe(true);
    expect(f.read().document).toBe(fixture.doc);
    expect(f.read().document!.history).toBe(fixture.doc.history);
    expect(f.read().receipts[0]).toBe(retainedReceipt);
    expect(f.read().committedDocumentSave?.receipt).toBe(retainedReceipt);
    expect(
      rpc.mock.calls.some(([, p]) =>
        ['inverse', 'inverseText'].includes(String((p as { kind?: string }).kind)),
      ),
    ).toBe(false);
    f.clean();
  },
);
