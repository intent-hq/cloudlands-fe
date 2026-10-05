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
      payloadBytes: 10_000_000,
      stringUnits: 10_000_000,
      objectNodes: 100_000,
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
  expect(f.read().committedDocumentSave).toBeUndefined();
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
  f.clean();
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
