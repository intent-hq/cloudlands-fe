/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { TextSelection } from '@tiptap/pm/state';
import { NoteWindowView } from '../note-window-view';
import type { NoteWindow } from '../note-window-reader';
import { createNoteDocumentSession } from './note-document-edit-session';
import { createNoteMarkerSelectionCopyOwner } from './note-marker-selection-copy';
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
function fixture(anchor = 1, head = 6) {
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
  view.editor!.view.dispatch(
    view.editor!.state.tr.setSelection(TextSelection.create(view.editor!.state.doc, anchor, head)),
  );
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
        kind: 'selectionMarkdown',
        maxSourceBytes: 1024,
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
        outputKind: 'selectionMarkdown',
        sourceLength: source.length,
        expiresAt: begin.expiresAt,
        items: [{ offset: 0, text: output }],
        nextCursor: null,
      };
    }
    throw new Error('Unexpected method');
  };
  let output = 'A  B';
  const sink = {
    write: vi.fn(async (_text: string) => {}),
    commit: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  };
  const openSink = vi.fn(async () => sink);
  let hook: ((method: string, p: any) => Promise<void>) | undefined;
  vi.mocked(backendRequest).mockImplementation(async (method, p) => {
    requests.push({ method, params: structuredClone(p) });
    await hook?.(method, p);
    return respond(method, p);
  });
  let readHook: (() => void) | undefined, nowHook: (() => void) | undefined;
  const owner = createNoteMarkerSelectionCopyOwner({
    port: {
      read: () => {
        readHook?.();
        return state;
      },
      dispatch,
      subscribe(f) {
        listeners.add(f);
        return () => {
          listeners.delete(f);
        };
      },
    },
    client: new LiveNotePagesClient(),
    openSink,
    now: () => {
      nowHook?.();
      return 1000;
    },
    workspaceId: 'w',
    noteId: 'n',
    editorSessionId: 'e',
    view: () => view,
    selectionGeneration: () => 0,
    current: () => alive && predicate(),
  });
  return {
    owner,
    sink,
    openSink,
    setReadHook(f: () => void) {
      readHook = f;
    },
    setNowHook(f: () => void) {
      nowHook = f;
    },
    setOutput(text: string) {
      output = text;
    },
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
it('captures the actual selection and uploads a complete original marker context', async () => {
  const f = fixture(6, 1);
  await expect(f.owner.copySelection()).resolves.toBe('copied');
  expect(f.sink.write).toHaveBeenCalledExactlyOnceWith('A  B');
  expect(f.sink.commit).toHaveBeenCalledTimes(1);
  expect(f.sink.abort).not.toHaveBeenCalled();
  const texts = new Map(f.records.get('text')!.map((r) => [r.id, r.text]));
  expect(texts.size).toBe(16);
  const live = f.records.get('live')!;
  expect(live.map((r) => r.role)).toEqual([
    'selection-owner',
    'inline-span',
    'marker-occurrence',
    'inline-span',
  ]);
  expect(live.map((r) => r.sourceRange)).toEqual([
    { start: 10, end: 70 },
    { start: 10, end: 12 },
    { start: 12, end: 68 },
    { start: 68, end: 70 },
  ]);
  expect(live[2].canonicalId).toBe('11111111-1111-4111-8111-111111111111');
  const attrs = JSON.parse(texts.get('marker-children'));
  expect(attrs.items).toEqual(['marker-commentId-entry', 'marker-id-entry', 'marker-type-entry']);
  for (const [index, key] of ['commentId', 'id', 'type'].entries()) {
    const entry = JSON.parse(texts.get(attrs.items[index]));
    expect(entry).toEqual({
      id: `marker-${key}`,
      parentId: 'marker-attributes',
      key,
      type: 'string',
      valueRef: `marker-${key}-value`,
    });
    expect(texts.get(entry.valueRef)).toBe(
      key === 'type'
        ? 'point'
        : `11111111-1111-4111-8111-111111111111${key === 'id' ? ':point' : ''}`,
    );
  }
  expect(f.records.get('selection')).toEqual([
    {
      kind: 'range',
      ordinal: 0,
      start: 10,
      end: 70,
      anchorAffinity: 'after',
      headAffinity: 'after',
      direction: 'backward',
    },
  ]);
  expect(f.records.has('dirty')).toBe(false);
  expect(f.requests.at(-1)!.method).toBe('note.operation.cancel');
  expect(f.state().resourceLedger.used.physicalReads).toBe(0);
});
it.each([
  [3, 4],
  [4, 3],
  [3, 3],
  [2, 5],
])('local NoCopy for selection %i..%i opens no sink or RPC', async (anchor, head) => {
  const f = fixture(anchor, head);
  await expect(f.owner.copySelection()).resolves.toBe('noCopy');
  expect(f.requests).toEqual([]);
  expect(f.openSink).not.toHaveBeenCalled();
  expect(f.state().resourceLedger.used.physicalReads).toBe(0);
});
it('denies queued DATA before any sink or RPC', async () => {
  const f = fixture();
  f.dispatch(
    a.pageResourcesRequested(
      'blocker',
      [
        {
          id: 'blocker',
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
  await expect(f.owner.copySelection()).rejects.toThrow();
  expect(f.requests).toEqual([]);
  expect(f.openSink).not.toHaveBeenCalled();
  expect(f.state().resourceLedger.pending).toHaveLength(0);
  f.dispatch(a.pageResourcesReleased('blocker'));
});
it('refuses dirty context before native output preparation', async () => {
  const f = fixture();
  f.state().byWorkspaceId.w.notes.n.drafts.push({} as never);
  await expect(f.owner.copySelection()).rejects.toThrow();
  expect(f.requests).toEqual([]);
  expect(f.openSink).not.toHaveBeenCalled();
});
it('latches restored owner loss while the sink is opening', async () => {
  const f = fixture(),
    held = deferred();
  f.openSink.mockImplementation(async () => {
    await held.promise;
    return f.sink;
  });
  const running = f.owner.copySelection(),
    failed = expect(running).rejects.toThrow();
  await vi.waitFor(() => expect(f.openSink).toHaveBeenCalledTimes(1));
  f.setAlive(false);
  f.setAlive(true);
  expect(f.state().resourceLedger.used.physicalReads).toBe(1);
  held.resolve();
  await failed;
  expect(f.requests).toEqual([]);
  expect(f.sink.abort).toHaveBeenCalledTimes(1);
  expect(f.sink.commit).not.toHaveBeenCalled();
  expect(f.state().resourceLedger.used.physicalReads).toBe(0);
});
it('holds DATA through a pending read after native retirement', async () => {
  const f = fixture(),
    held = deferred();
  let entered = false;
  f.setHook(async (method) => {
    if (method === 'note.operation.read') {
      entered = true;
      await held.promise;
    }
  });
  const running = f.owner.copySelection(),
    failed = expect(running).rejects.toThrow();
  await vi.waitFor(() => expect(entered).toBe(true));
  f.view.destroy();
  f.dispatch(workspaceUnmounted('w'));
  expect(f.state().resourceLedger.used.physicalReads).toBe(1);
  held.resolve();
  await failed;
  expect(f.sink.write).not.toHaveBeenCalled();
  expect(f.sink.commit).not.toHaveBeenCalled();
  expect(f.sink.abort).toHaveBeenCalledTimes(1);
  expect(f.state().resourceLedger.used.physicalReads).toBe(0);
});
it('holds DATA through a pending sink write and cancels before publication', async () => {
  const f = fixture(),
    held = deferred();
  f.sink.write.mockImplementation(async () => held.promise);
  const running = f.owner.copySelection(),
    failed = expect(running).rejects.toThrow();
  await vi.waitFor(() => expect(f.sink.write).toHaveBeenCalledTimes(1));
  f.owner.cancelSelectionCopy();
  f.view.destroy();
  f.dispatch(workspaceUnmounted('w'));
  expect(f.state().resourceLedger.used.physicalReads).toBe(1);
  held.resolve();
  await failed;
  expect(f.sink.commit).not.toHaveBeenCalled();
  expect(f.sink.abort).toHaveBeenCalledTimes(1);
  expect(f.state().resourceLedger.used.physicalReads).toBe(0);
});
it('forwards cancellation while native publication acknowledgement is pending', async () => {
  const f = fixture(),
    held = deferred(),
    committing = deferred();
  f.sink.commit.mockImplementation(async () => {
    committing.resolve();
    return held.promise;
  });
  const running = f.owner.copySelection();
  // Join the actual publication boundary even when suite load delays hashing.
  // Observe rejection immediately so a failed producer cannot leak past cleanup.
  await Promise.race([
    committing.promise,
    running.then(() => {
      throw new Error('Copy completed without reaching publication');
    }),
  ]);
  f.owner.cancelSelectionCopy();
  expect(f.sink.abort).toHaveBeenCalledTimes(1);
  expect(f.state().resourceLedger.used.physicalReads).toBe(1);
  held.resolve();
  await running;
  expect(f.sink.commit).toHaveBeenCalledTimes(1);
  expect(f.state().resourceLedger.used.physicalReads).toBe(0);
});
it('rejects raw marker source instead of captured Markdown before sink write', async () => {
  const f = fixture();
  f.setOutput(paragraph);
  await expect(f.owner.copySelection()).rejects.toThrow(
    'Selection output differs from native serializer',
  );
  expect(f.sink.write).not.toHaveBeenCalled();
  expect(f.sink.commit).not.toHaveBeenCalled();
  expect(f.sink.abort).toHaveBeenCalledTimes(1);
});
it('observed checkpoint mutation during upload cannot revive', async () => {
  const f = fixture();
  let once = true;
  f.setHook(async (method) => {
    if (once && method === 'note.operation.append') {
      once = false;
      const n = f.state().byWorkspaceId.w.notes.n;
      n.history.push({ sequence: 3 } as never);
      f.notify();
      n.history.pop();
      f.notify();
    }
  });
  await expect(f.owner.copySelection()).rejects.toThrow();
  expect(f.requests.some((r) => r.method === 'note.operation.seal')).toBe(false);
  expect(f.sink.commit).not.toHaveBeenCalled();
});

it.each(['read', 'now'] as const)(
  'rechecks mapping after executable %s before sink commit',
  async (kind) => {
    const f = fixture();
    let enabled = false,
      afterProof = false,
      changed = false;
    const borrow = f.view.borrowMarkerSelectionMarkdown.bind(f.view);
    vi.spyOn(f.view, 'borrowMarkerSelectionMarkdown').mockImplementation((...args) => {
      const lease = borrow(...args);
      return Object.freeze({
        ...lease,
        current: () => {
          afterProof = false;
          const valid = lease.current();
          afterProof = true;
          return valid;
        },
      });
    });
    const original = f.view.projection!.positions.get(f.position);
    const mutate = () => {
      if (enabled && afterProof && !changed) {
        changed = true;
        f.view.projection!.positions.set(f.position, 999);
      }
    };
    if (kind === 'read') f.setReadHook(mutate);
    else f.setNowHook(mutate);
    f.setHook(async (method) => {
      if (method === 'note.operation.cancel') enabled = true;
    });
    await expect(f.owner.copySelection()).rejects.toThrow();
    expect(changed).toBe(true);
    expect(f.sink.commit).not.toHaveBeenCalled();
    expect(f.sink.abort).toHaveBeenCalledTimes(1);
    f.view.projection!.positions.set(f.position, original!);
    f.notify();
    expect(f.sink.commit).not.toHaveBeenCalled();
    expect(f.state().resourceLedger.used.physicalReads).toBe(0);
  },
);
it('released marker selection lease cannot execute or revive its retired native proof', () => {
  const f = fixture();
  const predicate = vi.fn(() => true);
  const lease = f.view.borrowMarkerSelectionMarkdown(
    {
      scope,
      sourceRevision: 'r',
      snapshotId: 's',
      expiresAt: new Date(10000).toISOString(),
      documentGeneration: 0,
      liveGeneration: f.view.selectionCaptureGeneration,
      selectionGeneration: 0,
    },
    predicate,
  );
  expect(lease.current()).toBe(true);
  lease.release();
  const calls = predicate.mock.calls.length;
  f.view.destroy();
  expect(lease.current()).toBe(false);
  expect(predicate).toHaveBeenCalledTimes(calls);
  lease.release();
  expect(lease.current()).toBe(false);
});
