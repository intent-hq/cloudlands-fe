/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import sourceText from './fixtures/marker-source.capture.txt?raw';
import outputText from './fixtures/marker-output.capture.txt?raw';
import { NotePageReader } from '$lib/client/note-page-reader';
import { readNoteWindow } from '../note-window-reader';
import type { NotePageRequest, NoteReadPage } from '$lib/client/note-pages';
const capture = JSON.parse(sourceText);
const recorded = JSON.parse(outputText);
vi.mock('uuid', () => ({ v4: () => JSON.parse(outputText).calls[0].params.operationId }));
import { NoteWindowView } from '../note-window-view';
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

const original = capture.calls[0].response;
const scope = original.scope,
  source = capture.source;
const prefix = 'prefix😀\n\n';
const literal = /<!--anchor:[^<>]+:point-->/.exec(source)![0];
const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(capture.capturedAtMs);
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
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
// Original Store context and operation response objects, actual configured
// native view/Redux/Live client, recorded clock and controlled transport.
// No live authorization, native marker output or OS integration claim.
async function fixture() {
  const calls = capture.calls as unknown as { request: NotePageRequest; response: NoteReadPage }[];
  const reader = new NotePageReader(async (_method, params) => {
    const page = params.page as NotePageRequest;
    const enriched = (q: NotePageRequest) => ({
      ...q,
      ...(q.kind === 'source' && !q.cursor
        ? {
            noteInstanceId: original.scope.noteInstanceId,
            sourceRevision: original.sourceRevision,
            snapshotId: original.snapshotId,
          }
        : {}),
    });
    const found = calls.find((c) => canonical(enriched(c.request)) === canonical(page));
    if (!found) throw new Error('Uncaptured original Store page request ' + JSON.stringify(page));
    return found.response;
  });
  const window = await readNoteWindow((q) => reader.read(scope.workspaceId, scope.noteId, q), {
    ...original,
    at: capture.at,
  });
  let state: NotePagesState = a.notePagesReducer(
    undefined,
    a.pagePanelOpened(scope.workspaceId, scope.noteId, 'p'),
  );
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
    a.pageStateReceived(scope.workspaceId, scope.noteId, 0, {
      kind: 'notePageState',
      scope,
      sourceRevision: original.sourceRevision,
      stateGeneration: '1',
      commentRevision: 'c',
      attributionGeneration: 'a',
      attributionState: 'ready',
      deleted: false,
      invalidation: 'all',
    }),
  );
  dispatch(a.pageWindowRequested(scope.workspaceId, scope.noteId, 'p', prefix.length));
  const seed = { owner: 'seed', data: 'seed-data', control: 'seed-control' };
  dispatch(a.pageResourcesRequested(seed.owner, noteAssemblyResources(seed), 12));
  dispatch(
    a.pageWindowSettled(scope.workspaceId, scope.noteId, 'p', 0, 1, window, null, {
      sponsor: seed.owner,
      resource: seed.data,
      owner: 'window-seed',
    }),
  );
  dispatch(a.pageResourcesReleased(seed.owner));
  const note = state.byWorkspaceId[scope.workspaceId].notes[scope.noteId];
  state = {
    ...state,
    byWorkspaceId: {
      [scope.workspaceId]: {
        notes: {
          [scope.noteId]: {
            ...note,
            document: createNoteDocumentSession(scope, original.sourceRevision, source.length),
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
      dispatch(a.pageWindowRetained(scope.workspaceId, scope.noteId, 'p', 0, w, 'native-marker'));
      return () => dispatch(a.pageResourcesReleased('native-marker'));
    },
  });
  expect(view.show(window)).toBe(true);
  cleanups.push(() => view.destroy());
  const position = view.projection!.tokens.find((t) => t.raw === literal)!.pm;
  let alive = true,
    predicate = () => true;
  const requests: { method: string; params: any }[] = [];
  let index = 0;
  let hook: ((method: string, params: Record<string, unknown>) => Promise<void>) | undefined;
  vi.mocked(backendRequest).mockImplementation(async (method, params) => {
    const expected =
      method === 'note.operation.cancel' ? recorded.calls.at(-1) : recorded.calls[index++];
    expect({ method, params }).toEqual({ method: expected.method, params: expected.params });
    requests.push({ method, params: structuredClone(params) });
    await hook?.(method, params);
    return expected.response;
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
    workspaceId: scope.workspaceId,
    noteId: scope.noteId,
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

it('replays all original marker uploads, source output and cancellation through the actual native consumer', async () => {
  const f = await fixture();
  let output = '';
  expect(f.window.context.some((i) => i.kind === 'span' && i.role === 'commentMarker')).toBe(true);
  await f.owner.readMarkerSource(f.position, async (text) => {
    expect(f.state().resourceLedger.used.physicalReads).toBe(1);
    output += text;
  });
  expect(output).toBe(capture.source);
  expect(f.requests).toEqual(
    recorded.calls.map((c: any) => ({ method: c.method, params: c.params })),
  );
  expect(f.requests).toHaveLength(17);
  const live = f.requests.find(
    (r) => r.method === 'note.operation.append' && r.params.stream === 'live',
  )!.params.records;
  expect(live[1]).toMatchObject({
    role: 'marker-occurrence',
    canonicalId: '11111111-1111-4111-8111-111111111111',
    sourceRange: { start: 12, end: 68 },
  });
  expect(output.slice(12, 68)).toBe(literal);
  expect(f.state().resourceLedger.used.physicalReads).toBe(0);
});
it('native loss during original held source read refuses delivery until physical settlement', async () => {
  const f = await fixture(),
    held = deferred();
  let entered = false;
  f.setHook(async (method) => {
    if (method === 'note.operation.read') {
      entered = true;
      await held.promise;
    }
  });
  const consume = vi.fn(),
    running = f.owner.readMarkerSource(f.position, consume);
  const failed = expect(running).rejects.toThrow();
  await vi.waitFor(() => expect(entered).toBe(true));
  f.view.destroy();
  f.dispatch(workspaceUnmounted(scope.workspaceId));
  expect(f.state().resourceLedger.used.physicalReads).toBe(1);
  held.resolve();
  await failed;
  expect(consume).not.toHaveBeenCalled();
  expect(f.requests.at(-1)!.method).toBe('note.operation.cancel');
  expect(f.state().resourceLedger.used.physicalReads).toBe(0);
});
it('holds original window and DATA during borrowed callback cancellation', async () => {
  const f = await fixture(),
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
  f.dispatch(workspaceUnmounted(scope.workspaceId));
  expect(f.state().resourceLedger.used.physicalReads).toBe(1);
  held.resolve();
  await failed;
  expect(f.requests.filter((r) => r.method === 'note.operation.cancel')).toHaveLength(1);
  expect(f.state().resourceLedger.used.physicalReads).toBe(0);
});
it('preserves a recorded typed Store refusal without claiming RPC error serialization', async () => {
  const f = await fixture();
  const refusal = recorded.refusals.find((r: any) => r.phase === 'afterCancel');
  expect(refusal.typedStoreError).toBe('NotePage(Expired)');
  f.setHook(async (method, params) => {
    if (method === 'note.operation.read') {
      expect(params).toEqual(refusal.params);
      throw refusal;
    }
  });
  const consume = vi.fn();
  await expect(f.owner.readMarkerSource(f.position, consume)).rejects.toBe(refusal);
  expect(consume).not.toHaveBeenCalled();
  expect(f.state().resourceLedger.used.physicalReads).toBe(0);
});
