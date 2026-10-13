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
import { createNoteRenderedSearchOwner } from './note-rendered-search';
import sourceBytes from './fixtures/rendered-source.capture.txt?raw';
import outputBytes from './fixtures/rendered-output.capture.txt?raw';
const capture = JSON.parse(sourceBytes);
const output = JSON.parse(outputBytes) as {
  clock: number;
  hitCount: number;
  wholeLeafText: string;
  refusals: { phase: string; params: Record<string, unknown>; typedStoreError: string }[];
  calls: { method: string; params: Record<string, unknown>; response: any }[];
};
const uuids = vi.hoisted(() => ({ n: 0 }));
vi.mock('uuid', () => ({
  v4: () => `00000000-0000-4000-8000-${String(++uuids.n).padStart(12, '0')}`,
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(),
  onBackendReconnected: vi.fn(),
}));
import { backendRequest } from '$lib/client/live/backend-transport';
import { LiveNotePagesClient } from '$lib/client/live/live-note-pages-client';

const original = appClient.notes.pages;
beforeEach(() => {
  uuids.n = 0;
  vi.clearAllMocks();
});
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
// Original Store source/context and staged responses are replayed unchanged.
// Recorded clock and injected transport prove producer/consumer compatibility,
// not live authentication, OS integration or normal route activation.
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
    anchor: 129,
    head: capture.at,
    anchorAffinity: 1,
    headAffinity: -1,
  });
  let readIndex = 0;
  const requests: { method: string; params: unknown }[] = [];
  const respond = async (method: string, p: any): Promise<any> => {
    const frame =
      method === 'note.operation.cancel'
        ? output.calls.find((c) => c.method === method)
        : output.calls[readIndex++];
    if (!frame) throw new Error('Missing original Store frame');
    expect(method).toBe(frame.method);
    expect(p).toEqual(frame.params);
    requests.push({ method, params: structuredClone(p) });
    return frame.response;
  };
  vi.mocked(backendRequest).mockImplementation(respond);
  const owner = createNoteRenderedSearchOwner({
    port,
    client: new LiveNotePagesClient(),
    workspaceId: ws,
    noteId: id,
    editorSessionId: 'selection-editor',
    view: () => view,
    selectionGeneration: () => selectionGeneration,
    current: () => true,
    now: () => now,
  });
  return {
    owner,
    view,
    requests,
    respond,
    state: () => state,
    async close() {
      view.destroy();
      await offer.release();
      task.cancel();
    },
  };
}
it('replays every actual Store hit/detail/cursor for the independently captured native selection', async () => {
  const f = await fixture();
  const spans: { start: number; end: number }[] = [];
  const ids = new Set<string>();
  const sizes: number[] = [];
  try {
    expect(output.wholeLeafText).toBe('Straße '.repeat(18) + '😀');
    expect(output.hitCount).toBe(17);
    await f.owner.searchRendered('STRASSE', async (page) => {
      sizes.push(page.hits.length);
      for (const hit of page.hits) {
        spans.push({ ...hit.sourceRange });
        ids.add(hit.hitId);
        expect(hit.renderedRange).toEqual({
          start: hit.sourceRange.start - 10,
          end: hit.sourceRange.end - 10,
        });
      }
      expect(f.state().resourceLedger.used.physicalReads).toBe(1);
    });
    expect(spans).toEqual(
      Array.from({ length: 17 }, (_, i) => ({ start: 10 + 7 * i, end: 16 + 7 * i })),
    );
    expect(ids.size).toBe(17);
    const searchFrames = output.calls.filter((c) => c.params.kind === 'search');
    expect(sizes).toEqual(searchFrames.map((c) => c.response.items.length));
    expect(sizes).toEqual([16, 1]);
    expect(searchFrames.at(-1)!.response.count).toEqual({ value: 17, exact: true });
    expect(f.requests).toEqual(output.calls.map(({ method, params }) => ({ method, params })));
    const fragments = output.calls
      .flatMap((c) => c.response.items ?? [])
      .filter((x: any) => x.kind === 'fragment');
    expect(fragments).toHaveLength(17);
    expect(fragments.every((x: any) => x.text === output.wholeLeafText)).toBe(true);
    expect(output.wholeLeafText.slice(119)).toBe('Straße 😀');
    expect(f.state().resourceLedger.used.physicalReads).toBe(0);
  } finally {
    await f.close();
  }
});
it('retains native context DATA through held actual read after view loss', async () => {
  const f = await fixture(),
    entered = deferred(),
    held = deferred(),
    consume = vi.fn(async () => {});
  vi.mocked(backendRequest).mockImplementation(async (method, p) => {
    const response = await f.respond(method, p);
    if (method === 'note.operation.read') {
      entered.resolve();
      await held.promise;
    }
    return response;
  });
  try {
    const result = expect(f.owner.searchRendered('STRASSE', consume)).rejects.toThrow();
    await entered.promise;
    f.view.destroy();
    expect(f.state().resourceLedger.used.physicalReads).toBe(1);
    expect(
      Object.keys(f.state().resourceLedger.owners).some((x) => x.startsWith('edit-context:')),
    ).toBe(true);
    held.resolve();
    await result;
    expect(consume).not.toHaveBeenCalled();
    expect(f.requests.at(-1)?.method).toBe('note.operation.cancel');
    expect(f.state().resourceLedger.used.physicalReads).toBe(0);
  } finally {
    held.resolve();
    await f.close();
  }
});
it('keeps borrowed page and native DATA until a cancelled callback settles', async () => {
  const f = await fixture(),
    entered = deferred(),
    held = deferred();
  let callbacks = 0;
  try {
    const result = expect(
      f.owner.searchRendered('STRASSE', async () => {
        callbacks++;
        entered.resolve();
        await held.promise;
      }),
    ).rejects.toThrow();
    await entered.promise;
    f.owner.cancelRenderedSearch();
    f.view.destroy();
    expect(f.state().resourceLedger.used.physicalReads).toBe(1);
    expect(f.requests.some((c) => c.method === 'note.operation.cancel')).toBe(false);
    held.resolve();
    await result;
    expect(callbacks).toBe(1);
    expect(f.requests.at(-1)?.method).toBe('note.operation.cancel');
    expect(f.state().resourceLedger.used.physicalReads).toBe(0);
  } finally {
    held.resolve();
    await f.close();
  }
});
it('preserves a recorded typed Store expiry refusal without delivering a page', async () => {
  const f = await fixture(),
    consume = vi.fn(async () => {});
  const refusal = output.refusals.find((r) => r.phase === 'afterCancel')!;
  const error = new Error(refusal.typedStoreError);
  vi.mocked(backendRequest).mockImplementation(async (method, p) => {
    if (method === 'note.operation.read') {
      expect(p).toEqual(refusal.params);
      throw error;
    }
    return f.respond(method, p);
  });
  try {
    await expect(f.owner.searchRendered('STRASSE', consume)).rejects.toBe(error);
    expect(consume).not.toHaveBeenCalled();
    expect(f.requests.at(-1)?.method).toBe('note.operation.cancel');
    expect(f.state().resourceLedger.used.physicalReads).toBe(0);
  } finally {
    await f.close();
  }
});
