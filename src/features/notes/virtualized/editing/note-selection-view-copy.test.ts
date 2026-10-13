/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { appClient } from '$lib/client';
import { MockNotePagesClient } from '$lib/client/mock/mock-note-pages-client';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest, NoteReadPage } from '$lib/client/note-pages';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
import { notePagesSaga } from '$store/renderer/slices/note-pages/sagas/note-pages-saga';
import { readNoteWindow } from '../note-window-reader';
import { noteAssemblyResources } from '../note-assembly-reservation';
import { NoteWindowView } from '../note-window-view';
import { prepareNoteParagraphContext } from './note-paragraph-edit-context';
import { createNoteDocumentTransactionOwner } from './note-document-transaction-owner';
import { createNoteSelectionCopyOwner } from './note-selection-copy';
import capture from './__fixtures__/note-paragraph/plain-paragraph-far.json';
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(),
  onBackendReconnected: vi.fn(),
}));
import { backendRequest } from '$lib/client/live/backend-transport';
import { LiveNotePagesClient } from '$lib/client/live/live-note-pages-client';

const original = appClient.notes.pages;
afterEach(() => {
  appClient.notes.pages = original;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
// Original Store page objects feed the actual reader, prepared context, configured
// view and capture. Staged output responses below are controlled transport, not
// daemon execution or an OS clipboard test.
async function fixture() {
  const calls = capture.calls as unknown as { request: NotePageRequest; response: NoteReadPage }[];
  const identity = calls[0].response;
  if (identity.kind !== 'noteSourcePage') throw new Error('Missing source');
  const now = Date.parse(identity.expiresAt) - 10_000;
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const reader = new NotePageReader(async (_method, params) => {
    const q = params.page as NotePageRequest;
    const found = calls.find(
      ({ request: r }) =>
        r.kind === q.kind &&
        r.cursor === q.cursor &&
        r.maxWireBytes === q.maxWireBytes &&
        r.maxItems === q.maxItems &&
        (q.kind === 'context'
          ? r.kind === 'context' && r.contextRef === q.contextRef
          : q.kind === 'source' &&
            r.kind === 'source' &&
            r.at === q.at &&
            r.maxSourceBytes === q.maxSourceBytes),
    );
    if (!found) throw new Error('Uncaptured Store request');
    return found.response;
  });
  const { workspaceId: ws, noteId: id } = identity.scope;
  const window = await readNoteWindow((q) => reader.read(ws, id, q), {
    ...identity,
    at: capture.at,
  });
  let state = a.initialNotePagesState,
    started = false;
  const listeners = new Set<() => void>(),
    channel = stdChannel();
  const dispatch = (action: Parameters<typeof a.notePagesReducer>[1]) => {
    state = a.notePagesReducer(state, action);
    for (const f of [...listeners]) f();
    if (started) channel.put(action);
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
  dispatch(a.pagePanelOpened(ws, id, 'p'));
  dispatch(
    a.pageStateReceived(ws, id, 0, {
      kind: 'notePageState',
      scope: identity.scope,
      sourceRevision: identity.sourceRevision,
      stateGeneration: '1',
      attributionGeneration: 'a',
      attributionState: 'ready',
      commentRevision: 'c',
      deleted: false,
      invalidation: 'all',
    }),
  );
  dispatch(a.pageWindowRequested(ws, id, 'p', capture.at));
  const seed = { owner: 'seed', data: 'seed-data', control: 'seed-control' };
  dispatch(a.pageResourcesRequested(seed.owner, noteAssemblyResources(seed), 12));
  expect(Object.hasOwn(state.resourceLedger.owners, seed.owner)).toBe(true);
  dispatch(
    a.pageWindowSettled(ws, id, 'p', 0, 1, window, null, {
      sponsor: seed.owner,
      resource: seed.data,
      owner: 'window-seed',
    }),
  );
  dispatch(a.pageResourcesReleased(seed.owner));
  const port = {
    read: () => state,
    dispatch,
    subscribe: (f: () => void) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
  };
  appClient.notes.pages = new MockNotePagesClient({
    capabilities: { backendId: identity.scope.backendId, annotations: false },
    read: (w, n, q) => reader.read(w, n, q),
  });
  started = true;
  const task = runSaga(
    { channel, dispatch, getState: () => ({ notePages: state }) },
    notePagesSaga,
  );
  const offer = prepareNoteParagraphContext(port, window, 'p', undefined, () => now);
  const ready = await offer.ready;
  let sequence = 0,
    selectionGeneration = 0;
  const scroller = document.createElement('div');
  document.body.append(scroller);
  const view = new NoteWindowView(scroller, {
    seek: () => {},
    fullOperation: () => {},
    selectionChanged(selection) {
      selectionGeneration++;
      const n = state.byWorkspaceId[ws].notes[id];
      dispatch(a.pageDocumentSelectionChanged(ws, id, n.generation, n.document!, selection));
    },
    retainWindow(w) {
      const owner = `selection-view:${sequence++}`;
      dispatch(a.pageWindowRetained(ws, id, 'p', 0, w, owner));
      return () => dispatch(a.pageResourcesReleased(owner));
    },
    editing: {
      bind() {
        throw new Error('Expected owned context borrow');
      },
      undo() {},
      redo() {},
      borrow() {
        const lease = ready.borrow();
        return {
          release: lease.release,
          bind(w, p, doc) {
            return createNoteDocumentTransactionOwner(
              lease.create(p, doc),
              () => state.byWorkspaceId[ws].notes[id].document!,
              () => {
                throw new Error('Read-only capture');
              },
            );
          },
        };
      },
    },
  });
  expect(view.show(window)).toBe(true);
  view.setSelection({
    anchor: capture.at + 2,
    head: capture.at,
    anchorAffinity: 1,
    headAffinity: -1,
  });
  let wire: any,
    payload = '',
    offset = 0;
  const streams = ['text', 'dirty', 'selection', 'mutation', 'live'].map((stream) => ({
    stream,
    nextSequence: 0,
    lastDigest: null as string | null,
  }));
  const records = new Map<string, any[]>();
  const stage = (phase: string) => ({
    kind: 'noteStageState',
    scope: identity.scope,
    operationId: wire.operationId,
    headerDigest: wire.headerDigest,
    baseRevision: identity.sourceRevision,
    expiresAt: wire.expiresAt,
    phase,
    streams: streams.map((s) => ({ ...s })),
    ...(phase === 'sealed' ? { payloadDigest: payload, viewLength: window.sourceLength } : {}),
  });
  const respond = async (method: string, p: any): Promise<any> => {
    if (method === 'note.operation.begin') {
      wire = p;
      return stage('staging');
    }
    if (method === 'note.operation.append') {
      records.set(p.stream, [...(records.get(p.stream) ?? []), ...p.records]);
      const s = streams.find((s) => s.stream === p.stream)!;
      s.nextSequence++;
      s.lastDigest = p.chunkDigest;
      return {
        kind: 'noteStageAck',
        scope: identity.scope,
        operationId: wire.operationId,
        stream: p.stream,
        sequence: p.sequence,
        chunkDigest: p.chunkDigest,
        nextSequence: s.nextSequence,
        expiresAt: wire.expiresAt,
      };
    }
    if (method === 'note.operation.seal') {
      payload = p.payloadDigest;
      return stage('sealed');
    }
    if (method === 'note.operation.cancel') return stage('cancelled');
    expect(method).toBe('note.operation.read');
    expect(p.kind).toBe('selectionMarkdown');
    const text = 'ab'[offset],
      start = offset++;
    return {
      kind: 'noteOperationPage',
      scope: identity.scope,
      operationId: wire.operationId,
      headerDigest: wire.headerDigest,
      payloadDigest: payload,
      viewId: 'controlled-selection-view',
      outputKind: 'selectionMarkdown',
      sourceLength: window.sourceLength,
      expiresAt: wire.expiresAt,
      items: [{ offset: start, text }],
      nextCursor: offset === 2 ? null : 'next',
    };
  };
  vi.mocked(backendRequest).mockImplementation(respond);
  const chunks: string[] = [];
  const sink = {
    write: vi.fn(async (text: string) => {
      chunks.push(text);
    }),
    commit: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  };
  const owner = createNoteSelectionCopyOwner({
    port,
    client: new LiveNotePagesClient(),
    workspaceId: ws,
    noteId: id,
    editorSessionId: 'selection-editor',
    view: () => view,
    selectionGeneration: () => selectionGeneration,
    current: () => true,
    openSink: async () => sink,
    now: () => now,
  });
  return {
    owner,
    view,
    sink,
    records,
    chunks,
    respond,
    state: () => state,
    async close() {
      view.destroy();
      await offer.release();
      task.cancel();
    },
  };
}
it('copies a real far Store paragraph through view, capture, upload and validated bounded output', async () => {
  const f = await fixture();
  try {
    expect(await f.owner.copySelection()).toBe('copied');
    expect(f.chunks).toEqual(['a', 'b']);
    expect(f.records.get('selection')).toEqual([
      {
        kind: 'range',
        ordinal: 0,
        start: capture.at,
        end: capture.at + 2,
        direction: 'backward',
        anchorAffinity: 'after',
        headAffinity: 'before',
      },
    ]);
    expect(f.records.get('live')?.map((r) => r.role)).toEqual(['selection-owner', 'inline-span']);
    expect(f.records.get('text')).toHaveLength(6);
    expect(f.sink.commit).toHaveBeenCalledOnce();
    expect(f.state().resourceLedger.used.physicalReads).toBe(0);
  } finally {
    await f.close();
  }
});
it('native destruction during held output keeps borrowed DATA until physical read settles', async () => {
  const f = await fixture(),
    entered = deferred(),
    held = deferred();
  vi.mocked(backendRequest).mockImplementation(async (method, p) => {
    const page = await f.respond(method, p);
    if (method === 'note.operation.read') {
      entered.resolve();
      await held.promise;
    }
    return page;
  });
  try {
    const pending = f.owner.copySelection(),
      result = expect(pending).rejects.toThrow();
    await entered.promise;
    f.view.destroy();
    expect(f.state().resourceLedger.used.physicalReads).toBe(1);
    expect(
      Object.keys(f.state().resourceLedger.owners).some((x) => x.startsWith('edit-context:')),
    ).toBe(true);
    held.resolve();
    await result;
    expect(f.sink.commit).not.toHaveBeenCalled();
    expect(f.sink.abort).toHaveBeenCalledOnce();
    expect(f.state().resourceLedger.used.physicalReads).toBe(0);
  } finally {
    held.resolve();
    await f.close();
  }
});
it('real view selection loss promptly aborts a held sink commit before acknowledgement', async () => {
  const f = await fixture(),
    entered = deferred(),
    held = deferred();
  f.sink.commit.mockImplementation(async () => {
    entered.resolve();
    await held.promise;
    throw new Error('native not invoked');
  });
  try {
    const pending = f.owner.copySelection(),
      result = expect(pending).rejects.toThrow('native not invoked');
    await entered.promise;
    f.view.setSelection({
      anchor: capture.at,
      head: capture.at + 1,
      anchorAffinity: 1,
      headAffinity: -1,
    });
    expect(f.sink.abort).toHaveBeenCalledOnce();
    expect(f.state().resourceLedger.used.physicalReads).toBe(1);
    held.resolve();
    await result;
    expect(f.state().resourceLedger.used.physicalReads).toBe(0);
  } finally {
    held.resolve();
    await f.close();
  }
});
