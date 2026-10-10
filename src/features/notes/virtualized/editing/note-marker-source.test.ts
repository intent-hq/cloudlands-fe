/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { NoteWindowView } from '../note-window-view';
import type { NoteWindow } from '../note-window-reader';
import { createNoteDocumentSession } from './note-document-edit-session';
import { createNoteMarkerSourceOwner } from './note-marker-source';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
import type { NotePagesState } from '$store/renderer/slices/note-pages/note-pages-types';
import { noteAssemblyResources } from '../note-assembly-reservation';
import { workspaceUnmounted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(),
  onBackendReconnected: vi.fn(),
}));
import { backendRequest } from '$lib/client/live/backend-transport';
import { LiveNotePagesClient } from '$lib/client/live/live-note-pages-client';

const scope = { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' };
const prefix = 'prefix😀\n\n',
  literal = '<!--anchor:11111111-1111-4111-8111-111111111111:point-->',
  paragraph = `A ${literal} B`,
  source = prefix + paragraph;
const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(1000);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  for (const f of cleanups.splice(0)) f();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.entries(v)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
          .join(',')}}`
      : JSON.stringify(v);
const hash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
// Controlled complete lexical window and staged ACKs; actual configured native
// view, raw projection, Redux ledger and Live adapter. This is not Store authority.
function fixture() {
  const window: NoteWindow = {
    scope,
    sourceRevision: 'r',
    snapshotId: 's',
    expiresAt: new Date(10000).toISOString(),
    sourceLength: source.length,
    range: { start: prefix.length, end: source.length },
    text: paragraph,
    context: [
      {
        kind: 'boundary',
        id: 'paragraph',
        construct: 'paragraph',
        entryPath: 'markdown',
        sourceRange: { start: prefix.length, end: source.length },
        continuationBefore: false,
        continuationAfter: false,
      },
    ],
    details: {},
    mapBindings: [],
    documentEnd: true,
    cost: {
      requests: 2,
      wireBytes: 500,
      sourceBytes: 70,
      contextBytes: 200,
      assemblyPeakBytes: 1000,
    },
  };
  let state: NotePagesState = a.notePagesReducer(undefined, a.pagePanelOpened('w', 'n', 'p'));
  const listeners = new Set<() => void>();
  const dispatch = (action: Parameters<typeof a.notePagesReducer>[1]) => {
    state = a.notePagesReducer(state, action);
    for (const f of [...listeners]) f();
  };
  dispatch(
    a.pageResourceLimitsConfigured({
      payloadBytes: 100_000_000,
      stringUnits: 100_000_000,
      objectNodes: 100_000_000,
      domNodes: 100000,
      physicalReads: 1,
      assemblies: 1,
    }),
  );
  dispatch(
    a.pageStateReceived('w', 'n', 0, {
      kind: 'notePageState',
      scope,
      sourceRevision: 'r',
      stateGeneration: '1',
      commentRevision: 'c',
      attributionGeneration: 'a',
      attributionState: 'ready',
      deleted: false,
      invalidation: 'all',
    }),
  );
  dispatch(a.pageWindowRequested('w', 'n', 'p', prefix.length));
  const seed = { owner: 'seed', data: 'seed-data', control: 'seed-control' };
  dispatch(a.pageResourcesRequested(seed.owner, noteAssemblyResources(seed), 12));
  dispatch(
    a.pageWindowSettled('w', 'n', 'p', 0, 1, window, null, {
      sponsor: seed.owner,
      resource: seed.data,
      owner: 'window-seed',
    }),
  );
  dispatch(a.pageResourcesReleased(seed.owner));
  const note = state.byWorkspaceId.w.notes.n;
  state = {
    ...state,
    byWorkspaceId: {
      w: {
        notes: {
          n: {
            ...note,
            document: createNoteDocumentSession(scope, 'r', source.length),
            status: 'ready',
          },
        },
      },
    },
  };
  const host = document.createElement('div');
  document.body.append(host);
  const view = new NoteWindowView(host, {
    seek: vi.fn(),
    selectionChanged: vi.fn(),
    fullOperation: vi.fn(),
    retainWindow(w) {
      dispatch(a.pageWindowRetained('w', 'n', 'p', 0, w, 'native-marker'));
      return () => dispatch(a.pageResourcesReleased('native-marker'));
    },
  });
  expect(view.show(window)).toBe(true);
  cleanups.push(() => view.destroy());
  const position = view.projection!.tokens.find((t) => t.raw === literal)!.pm;
  let alive = true,
    predicate = () => true;
  const requests: { method: string; params: any }[] = [];
  const records = new Map<string, any[]>();
  let begin: any, payload: string | undefined;
  const streams = ['text', 'dirty', 'selection', 'mutation', 'live'].map((stream) => ({
    stream,
    nextSequence: 0,
    lastDigest: null as string | null,
  }));
  const stage = (phase: string) => ({
    kind: 'noteStageState',
    scope,
    operationId: begin.operationId,
    headerDigest: begin.headerDigest,
    baseRevision: 'r',
    expiresAt: begin.expiresAt,
    phase,
    streams: structuredClone(streams),
    ...(phase === 'sealed' ? { payloadDigest: payload, viewLength: source.length } : {}),
  });
  const respond = async (method: string, p: any): Promise<any> => {
    if (method === 'note.operation.begin') {
      begin = structuredClone(p);
      expect(p.headerDigest).toBe(
        hash({
          method,
          ...scope,
          operationId: p.operationId,
          expiresAt: p.expiresAt,
          header: p.header,
        }),
      );
      return stage('staging');
    }
    if (method === 'note.operation.append') {
      const stream = streams.find((s) => s.stream === p.stream)!;
      expect(p.sequence).toBe(stream.nextSequence);
      expect(p.previousDigest).toBe(stream.lastDigest);
      expect(p.chunkDigest).toBe(
        hash({
          stream: p.stream,
          sequence: p.sequence,
          previousDigest: p.previousDigest,
          records: p.records,
        }),
      );
      records.set(p.stream, [...(records.get(p.stream) ?? []), ...structuredClone(p.records)]);
      stream.nextSequence++;
      stream.lastDigest = p.chunkDigest;
      return {
        kind: 'noteStageAck',
        scope,
        operationId: p.operationId,
        stream: p.stream,
        sequence: p.sequence,
        nextSequence: stream.nextSequence,
        chunkDigest: p.chunkDigest,
      };
    }
    if (method === 'note.operation.seal') {
      payload = p.payloadDigest;
      expect(payload).toBe(hash({ headerDigest: begin.headerDigest, manifest: p.manifest }));
      return stage('sealed');
    }
    if (method === 'note.operation.cancel') return stage('cancelled');
    if (method === 'note.operation.read') {
      expect(p).toEqual({
        ...scope,
        operationId: begin.operationId,
        headerDigest: begin.headerDigest,
        kind: 'source',
        maxSourceBytes: 4096,
        maxWireBytes: 8192,
        maxItems: 64,
      });
      return {
        kind: 'noteOperationPage',
        scope,
        operationId: begin.operationId,
        headerDigest: begin.headerDigest,
        payloadDigest: payload,
        viewId: 'v',
        outputKind: 'source',
        sourceLength: source.length,
        expiresAt: begin.expiresAt,
        items: [{ offset: 0, text: source }],
        nextCursor: null,
      };
    }
    throw new Error('Unexpected method');
  };
  let hook: ((method: string, p: any) => Promise<void>) | undefined;
  vi.mocked(backendRequest).mockImplementation(async (method, p) => {
    requests.push({ method, params: structuredClone(p) });
    await hook?.(method, p);
    return respond(method, p);
  });
  const owner = createNoteMarkerSourceOwner({
    port: {
      read: () => state,
      dispatch,
      subscribe(f) {
        listeners.add(f);
        return () => {
          listeners.delete(f);
        };
      },
    },
    client: new LiveNotePagesClient(),
    workspaceId: 'w',
    noteId: 'n',
    editorSessionId: 'e',
    view: () => view,
    selectionGeneration: () => 0,
    current: () => alive && predicate(),
  });
  return {
    owner,
    view,
    window,
    position,
    requests,
    records,
    respond,
    dispatch,
    state: () => state,
    setState(s: NotePagesState) {
      state = s;
    },
    notify() {
      for (const f of [...listeners]) f();
    },
    setAlive(v: boolean) {
      alive = v;
      for (const f of [...listeners]) f();
    },
    setPredicate(f: () => boolean) {
      predicate = f;
    },
    setHook(f: typeof hook) {
      hook = f;
    },
  };
}
it('uploads exact configured marker and explicit owned attributes through the Live client', async () => {
  const f = fixture();
  let output = '';
  await f.owner.readMarkerSource(f.position, async (text) => {
    expect(f.state().resourceLedger.used.physicalReads).toBe(1);
    output += text;
  });
  expect(output).toBe(source);
  const texts = new Map(f.records.get('text')!.map((r) => [r.id, r.text]));
  const live = f.records.get('live')!;
  expect(live).toHaveLength(2);
  expect(live[1]).toMatchObject({
    role: 'marker-occurrence',
    canonicalId: '11111111-1111-4111-8111-111111111111',
    sourceRange: { start: 12, end: 68 },
  });
  expect(JSON.parse(texts.get('marker-descriptor'))).toEqual({
    version: 1,
    nodeType: 'commentAnchor',
    parentOrdinal: 0,
    nativeRange: { from: f.position, to: f.position + 1 },
    attributesRef: 'marker-attrs',
  });
  const attrs = JSON.parse(texts.get('marker-children'));
  expect(attrs.kind).toBe('metadataChildren');
  expect(attrs.nextRef).toBeNull();
  expect(attrs.items).toEqual(['marker-commentId-entry', 'marker-id-entry', 'marker-type-entry']);
  expect(f.records.get('text')).toHaveLength(12);
  const expectedAttributes = {
    commentId: '11111111-1111-4111-8111-111111111111',
    id: '11111111-1111-4111-8111-111111111111:point',
    type: 'point',
  };
  for (const [index, key] of ['commentId', 'id', 'type'].entries()) {
    const textId = attrs.items[index];
    expect(typeof textId).toBe('string');
    const entry = JSON.parse(texts.get(textId));
    expect(entry).toEqual({
      id: `marker-${key}`,
      parentId: 'marker-attributes',
      key,
      type: 'string',
      valueRef: `marker-${key}-value`,
    });
    expect(texts.get(entry.valueRef)).toBe(
      expectedAttributes[key as keyof typeof expectedAttributes],
    );
    expect(texts.get(textId)).toBe(canonical(entry));
  }
  expect(f.records.has('dirty')).toBe(false);
  expect(f.records.has('selection')).toBe(false);
  expect(f.requests.at(-1)!.method).toBe('note.operation.cancel');
  expect(f.state().resourceLedger.used.physicalReads).toBe(0);
});
it('queued DATA admission sends no request', async () => {
  const f = fixture();
  f.dispatch(
    a.pageResourcesRequested(
      'blocker',
      [
        {
          id: 'blocker-data',
          cost: {
            payloadBytes: 1,
            stringUnits: 1,
            objectNodes: 1,
            domNodes: 0,
            physicalReads: 1,
            assemblies: 1,
          },
        },
      ],
      1,
    ),
  );
  expect(f.state().resourceLedger.owners.blocker).toBeDefined();
  await expect(f.owner.readMarkerSource(f.position, vi.fn())).rejects.toThrow();
  expect(f.requests).toEqual([]);
  expect(f.state().resourceLedger.pending).toHaveLength(0);
  f.dispatch(a.pageResourcesReleased('blocker'));
});
it('dirty context sends no request', async () => {
  const f = fixture();
  f.state().byWorkspaceId.w.notes.n.drafts.push({} as never);
  await expect(f.owner.readMarkerSource(f.position, vi.fn())).rejects.toThrow();
  expect(f.requests).toEqual([]);
});
it('callback loss and restoration before capture sends no begin', async () => {
  const f = fixture();
  let once = true;
  f.setPredicate(() => {
    if (once) {
      once = false;
      f.setAlive(false);
      f.setAlive(true);
    }
    return true;
  });
  await expect(f.owner.readMarkerSource(f.position, vi.fn())).rejects.toThrow();
  expect(f.requests).toEqual([]);
});
it('in-place checkpoint change observed during upload cannot revive', async () => {
  const f = fixture();
  f.setHook(async (method) => {
    if (method === 'note.operation.append') {
      const n = f.state().byWorkspaceId.w.notes.n;
      n.history.push({ sequence: 3 } as never);
      f.notify();
      n.history.pop();
      f.notify();
    }
  });
  await expect(f.owner.readMarkerSource(f.position, vi.fn())).rejects.toThrow();
  expect(f.requests.some((r) => r.method === 'note.operation.seal')).toBe(false);
  expect(f.requests.at(-1)!.method).toBe('note.operation.cancel');
});
it('held read loses native owner without delivering and retains physical debt until settlement', async () => {
  const f = fixture(),
    held = deferred();
  let entered = false;
  f.setHook(async (method) => {
    if (method === 'note.operation.read') {
      entered = true;
      await held.promise;
    }
  });
  const consume = vi.fn();
  const running = f.owner.readMarkerSource(f.position, consume);
  const failed = expect(running).rejects.toThrow();
  await vi.waitFor(() => expect(entered).toBe(true));
  f.view.destroy();
  f.dispatch(workspaceUnmounted('w'));
  expect(f.state().resourceLedger.used.physicalReads).toBe(1);
  held.resolve();
  await failed;
  expect(consume).not.toHaveBeenCalled();
  expect(f.state().resourceLedger.used.physicalReads).toBe(0);
});
it('held callback cancellation retains window and DATA until callback settlement', async () => {
  const f = fixture(),
    held = deferred();
  let entered = false;
  const running = f.owner.readMarkerSource(f.position, async () => {
    entered = true;
    await held.promise;
  });
  const failed = expect(running).rejects.toThrow();
  await vi.waitFor(() => expect(entered).toBe(true));
  f.owner.cancelMarkerSource();
  f.view.destroy();
  f.dispatch(workspaceUnmounted('w'));
  expect(f.state().resourceLedger.used.physicalReads).toBe(1);
  held.resolve();
  await failed;
  expect(f.requests.filter((r) => r.method === 'note.operation.cancel')).toHaveLength(1);
  expect(f.state().resourceLedger.used.physicalReads).toBe(0);
});
it('cancel failure is not reported as completed source consumption', async () => {
  const f = fixture();
  f.setHook(async (method) => {
    if (method === 'note.operation.cancel') throw new Error('cancel failed');
  });
  await expect(f.owner.readMarkerSource(f.position, vi.fn())).rejects.toThrow('cancel failed');
  expect(f.requests.filter((r) => r.method === 'note.operation.cancel')).toHaveLength(1);
  expect(f.state().resourceLedger.used.physicalReads).toBe(0);
});
it('lost append acknowledgement cancels without requiring the previous manifest tail', async () => {
  const f = fixture();
  let once = true;
  vi.mocked(backendRequest).mockImplementation(async (method, p) => {
    f.requests.push({ method, params: p });
    const result = await f.respond(method, p);
    if (method === 'note.operation.append' && once) {
      once = false;
      throw new Error('lost append ack');
    }
    return result;
  });
  await expect(f.owner.readMarkerSource(f.position, vi.fn())).rejects.toThrow('lost append ack');
  expect(f.requests.at(-1)!.method).toBe('note.operation.cancel');
});
it('wrong source extent refuses before callback', async () => {
  const f = fixture();
  vi.mocked(backendRequest).mockImplementation(async (method, p) => {
    const result = await f.respond(method, p);
    return method === 'note.operation.read'
      ? { ...result, sourceLength: source.length + 1 }
      : result;
  });
  const consume = vi.fn();
  await expect(f.owner.readMarkerSource(f.position, consume)).rejects.toThrow();
  expect(consume).not.toHaveBeenCalled();
});
it('ordinary source adapter continues rejecting marker live records', async () => {
  const f = fixture(),
    client = new LiveNotePagesClient();
  const op = client.createSourceOperation(
    {
      scope,
      operationId: '00000000-0000-4000-8000-000000000001',
      expiresAt: new Date(10000).toISOString(),
      header: {
        baseRevision: 'r',
        editorSessionId: 'e',
        localEditSequence: 0,
        liveGeneration: 0,
        selectionGeneration: 0,
        action: 'read',
        output: 'source',
        selection: 'all',
      },
    },
    () => true,
  );
  await op.begin();
  await expect(
    op.append('live', [
      {
        kind: 'projection',
        ordinal: 0,
        role: 'selection-owner',
        sourceRange: { start: 10, end: 70 },
        detail: { textId: 'x', length: 1, utf8Bytes: 1, sha256: 'a'.repeat(64) },
      },
    ]),
  ).rejects.toThrow('Invalid staged append');
  await op.cancel();
  expect(f.requests.filter((r) => r.method === 'note.operation.append')).toHaveLength(0);
});
