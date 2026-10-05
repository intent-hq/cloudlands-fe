/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
import sourceBytes from './fixtures/selection-source.capture.txt?raw';
import outputBytes from './fixtures/selection-output.capture.txt?raw';
const capture = JSON.parse(sourceBytes);
const output = JSON.parse(outputBytes) as {
  clock: number;
  refusals: { phase: string; params: Record<string, unknown>; typedStoreError: string }[];
  calls: { method: string; params: Record<string, unknown>; response: unknown }[];
};
import { TextSelection } from '@tiptap/pm/state';
import { nativeFixtureEditor } from '../__tests__/canonical-table-fixture';
import { serializeSelectionToMarkdown } from '$lib/utils/selected-note-markdown-copy';
const uuids = vi.hoisted(() => ({ n: 0 }));
vi.mock('uuid', () => ({
  v4: () => `00000000-0000-4000-8000-${String(++uuids.n).padStart(12, '0')}`,
}));
beforeEach(() => {
  uuids.n = 0;
  vi.clearAllMocks();
});
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
// Original Store source/context and staged output objects are replayed unchanged.
// The adjacent attribution binds the actual producers and native upload capture.
// This is recorded-clock transport integration, not live auth or OS clipboard proof.
async function fixture() {
  const calls = capture.calls as unknown as { request: NotePageRequest; response: NoteReadPage }[];
  const identity = calls[0].response;
  if (identity.kind !== 'noteSourcePage') throw new Error('Missing source');
  const now = capture.capturedAtMs;
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
    // The Store fixture records normalized page selectors. The FE additionally
    // fences its first source read with the unchanged captured identity.
    expect(q).toEqual({
      ...found.request,
      ...(q.kind === 'source' && !q.cursor
        ? {
            noteInstanceId: identity.scope.noteInstanceId,
            sourceRevision: identity.sourceRevision,
            snapshotId: identity.snapshotId,
          }
        : {}),
    });
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
    anchor: capture.at + 2050,
    head: capture.at,
    anchorAffinity: 1,
    headAffinity: -1,
  });
  const requests: { method: string; params: Record<string, unknown> }[] = [];
  let readIndex = 0;
  const respond = async (method: string, p: Record<string, unknown>): Promise<unknown> => {
    const frame =
      method === 'note.operation.cancel'
        ? output.calls.find((c) => c.method === method)
        : output.calls[readIndex++];
    if (!frame) throw new Error('Missing original Store operation frame');
    expect(method).toBe(frame.method);
    expect(p).toEqual(frame.params);
    requests.push({ method, params: structuredClone(p) });
    return frame.response;
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
  const openSink = vi.fn(async () => sink);
  const owner = createNoteSelectionCopyOwner({
    port,
    client: new LiveNotePagesClient(),
    workspaceId: ws,
    noteId: id,
    editorSessionId: 'selection-editor',
    view: () => view,
    selectionGeneration: () => selectionGeneration,
    current: () => true,
    openSink,
    now: () => now,
  });
  const independent = nativeFixtureEditor(`<p>${'a'.repeat(2050)}</p>`);
  independent.view.dispatch(
    independent.state.tr.setSelection(TextSelection.create(independent.state.doc, 2051, 1)),
  );
  const expected = serializeSelectionToMarkdown(independent.view);
  return {
    owner,
    expected,
    openSink,
    requests,
    now,
    view,
    sink,
    chunks,
    respond,
    state: () => state,
    async close() {
      independent.destroy();
      view.destroy();
      await offer.release();
      task.cancel();
    },
  };
}
it('replays actual Store output for the exact configured native selection upload', async () => {
  const f = await fixture();
  try {
    const expected = f.expected;
    expect(expected).toBe('a'.repeat(2050));
    expect(await f.owner.copySelection()).toBe('copied');
    expect(f.chunks.map((x) => x.length)).toEqual([1024, 1024, 2]);
    expect(f.chunks.join('')).toBe(expected);
    expect(f.requests).toEqual(output.calls.map(({ method, params }) => ({ method, params })));
    expect(f.sink.commit).toHaveBeenCalledOnce();
    expect(f.state().resourceLedger.used.physicalReads).toBe(0);
  } finally {
    await f.close();
  }
});
it('retains actual prepared-context DATA after native loss until the original Store read settles', async () => {
  const f = await fixture(),
    entered = deferred(),
    held = deferred();
  vi.mocked(backendRequest).mockImplementation(async (method, p) => {
    const result = await f.respond(method, p);
    if (method === 'note.operation.read') {
      entered.resolve();
      await held.promise;
    }
    return result;
  });
  try {
    const result = expect(f.owner.copySelection()).rejects.toThrow();
    await entered.promise;
    f.view.destroy();
    expect(f.state().resourceLedger.used.physicalReads).toBe(1);
    expect(
      Object.keys(f.state().resourceLedger.owners).some((x) => x.startsWith('edit-context:')),
    ).toBe(true);
    held.resolve();
    await result;
    expect(f.sink.write).not.toHaveBeenCalled();
    expect(f.sink.commit).not.toHaveBeenCalled();
    expect(f.sink.abort).toHaveBeenCalledOnce();
    expect(f.state().resourceLedger.used.physicalReads).toBe(0);
  } finally {
    held.resolve();
    await f.close();
  }
});
it('handles native collapsed selection locally without staging or opening a sink', async () => {
  const f = await fixture();
  try {
    f.view.setSelection({
      anchor: capture.at,
      head: capture.at,
      anchorAffinity: 1,
      headAffinity: -1,
    });
    expect(await f.owner.copySelection()).toBe('noCopy');
    expect(backendRequest).not.toHaveBeenCalled();
    expect(f.openSink).not.toHaveBeenCalled();
    expect(f.sink.write).not.toHaveBeenCalled();
    expect(f.sink.commit).not.toHaveBeenCalled();
    expect(f.sink.abort).not.toHaveBeenCalled();
    expect(f.state().resourceLedger.used.physicalReads).toBe(0);
  } finally {
    await f.close();
  }
});

it('cancels during an awaited sink write while retaining DATA through settlement', async () => {
  const f = await fixture(),
    entered = deferred(),
    held = deferred();
  f.sink.write.mockImplementation(async () => {
    entered.resolve();
    await held.promise;
  });
  try {
    const result = expect(f.owner.copySelection()).rejects.toThrow();
    await entered.promise;
    f.owner.cancelSelectionCopy();
    // Staging writes settle before cleanup; prompt abort is reserved for the
    // later commit handoff where main may otherwise invoke native publication.
    expect(f.sink.abort).not.toHaveBeenCalled();
    expect(f.state().resourceLedger.used.physicalReads).toBe(1);
    held.resolve();
    await result;
    expect(f.sink.abort).toHaveBeenCalledOnce();
    expect(f.sink.commit).not.toHaveBeenCalled();
    expect(f.requests.filter((c) => c.method === 'note.operation.read')).toHaveLength(1);
    expect(f.requests.filter((c) => c.method === 'note.operation.cancel')).toHaveLength(1);
    expect(f.state().resourceLedger.used.physicalReads).toBe(0);
  } finally {
    held.resolve();
    await f.close();
  }
});

// The Store capture records a typed Rust refusal, not a JSON-RPC error envelope.
// Forward that recorded rejection through the Live client at the identical read
// selector; this does not claim service error-code serialization coverage.
it('propagates the original Store post-cancel refusal without publishing or source fallback', async () => {
  const f = await fixture();
  const refusal = output.refusals.find((x) => x.phase === 'afterCancel')!;
  expect(refusal.typedStoreError).toBe('NotePage(Expired)');
  vi.mocked(backendRequest).mockImplementation(async (method, p) => {
    if (method === 'note.operation.read') {
      expect(p).toEqual(refusal.params);
      throw refusal;
    }
    return f.respond(method, p);
  });
  try {
    await expect(f.owner.copySelection()).rejects.toBe(refusal);
    expect(f.sink.write).not.toHaveBeenCalled();
    expect(f.sink.commit).not.toHaveBeenCalled();
    expect(f.sink.abort).toHaveBeenCalledOnce();
    expect(f.requests.filter((c) => c.method === 'note.operation.cancel')).toHaveLength(1);
    expect(f.state().resourceLedger.used.physicalReads).toBe(0);
  } finally {
    await f.close();
  }
});
