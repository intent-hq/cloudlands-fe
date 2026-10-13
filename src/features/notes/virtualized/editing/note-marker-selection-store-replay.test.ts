/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import sourceText from './fixtures/marker-selection-source.capture.txt?raw';
import outputText from './fixtures/marker-selection-output.capture.txt?raw';
const capture = JSON.parse(sourceText),
  recorded = JSON.parse(outputText);
vi.mock('uuid', () => ({ v4: () => JSON.parse(outputText).calls[0].params.operationId }));
import { NotePageReader } from '$lib/client/note-page-reader';
import { readNoteWindow } from '../note-window-reader';
import type { NotePageRequest, NoteReadPage } from '$lib/client/note-pages';
import { Editor } from '@tiptap/core';
import { CommentAnchor } from '$lib/components/tiptap/CommentAnchor';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { serializeSelectionToMarkdown } from '$lib/utils/selected-note-markdown-copy';
import { TextSelection } from '@tiptap/pm/state';
import { NoteWindowView } from '../note-window-view';
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

const original = capture.calls[0].response;
const scope = original.scope,
  source = capture.source;
const prefix = 'prefix😀\n\n';
const literal = /<!--anchor:[^<>]+:point-->/.exec(source)![0];
const expected = 'A'.repeat(1024) + '  ' + 'B'.repeat(1024);
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
// Immutable actual Store source/context/output, configured native view and Redux/Live consumer.
// Recorded original clock and controlled transport/sink; no live auth/OS claim.
async function fixture(anchor = 2052, head = 1) {
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
  view.editor!.view.dispatch(
    view.editor!.state.tr.setSelection(TextSelection.create(view.editor!.state.doc, anchor, head)),
  );
  const position = view.projection!.tokens.find((t) => t.raw === literal)!.pm;
  let alive = true,
    predicate = () => true;
  const requests: { method: string; params: any }[] = [];
  const sink = {
    write: vi.fn(async (_text: string) => {}),
    commit: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  };
  const openSink = vi.fn(async () => sink);
  let index = 0;
  let hook: ((method: string, p: any) => Promise<void>) | undefined;
  vi.mocked(backendRequest).mockImplementation(async (method, params) => {
    const expectedCall =
      method === 'note.operation.cancel' ? recorded.calls.at(-1) : recorded.calls[index++];
    expect({ method, params }).toEqual({
      method: expectedCall.method,
      params: expectedCall.params,
    });
    requests.push({ method, params: structuredClone(params) });
    await hook?.(method, params);
    return expectedCall.response;
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
      return capture.capturedAtMs;
    },
    workspaceId: scope.workspaceId,
    noteId: scope.noteId,
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

it('replays exact original marker-selection uploads and three output pages through the native consumer', async () => {
  const f = await fixture();
  const config = createEditorConfig({
    element: document.createElement('div'),
    content: '',
    editable: false,
    useMarkdown: true,
    workspace: { id: scope.workspaceId },
    enableNotePrimitives: true,
    enableMentions: true,
    enableComments: false,
    onUpdate: () => {},
  });
  const native = new Editor({
    ...config,
    extensions: [...(config.extensions ?? []), CommentAnchor],
    content: await processMarkdownToHTML(source.slice(prefix.length), {
      workspaceId: scope.workspaceId,
      preserveAnchors: true,
    }),
  });
  try {
    expect(native.state.doc.firstChild!.childCount).toBe(3);
    expect(native.state.doc.firstChild!.child(1).type.name).toBe('commentAnchor');
    native.view.dispatch(
      native.state.tr.setSelection(TextSelection.create(native.state.doc, 2052, 1)),
    );
    const independent = serializeSelectionToMarkdown(native.view);
    expect(independent).toBe(expected);
    await expect(f.owner.copySelection()).resolves.toBe('copied');
    expect(f.sink.write.mock.calls.map((c) => c[0]).join('')).toBe(independent);
    expect(f.sink.write.mock.calls.map((c) => c[0].length)).toEqual([1024, 1024, 2]);
    expect(f.sink.commit).toHaveBeenCalledTimes(1);
    expect(f.sink.abort).not.toHaveBeenCalled();
    expect(f.requests).toEqual(
      recorded.calls.map((c: any) => ({ method: c.method, params: c.params })),
    );
    expect(f.requests).toHaveLength(24);
    const live = f.requests.find(
      (r) => r.method === 'note.operation.append' && r.params.stream === 'live',
    )!.params.records;
    expect(live.map((r: any) => r.role)).toEqual([
      'selection-owner',
      'inline-span',
      'marker-occurrence',
      'inline-span',
    ]);
    expect(live[2].sourceRange).toEqual({ start: 1035, end: 1091 });
    expect(source.slice(1035, 1091)).toBe(literal);
    expect(f.state().resourceLedger.used.physicalReads).toBe(0);
  } finally {
    native.destroy();
  }
}, 120000);
it('returns actual marker-only NoCopy before any RPC or sink', async () => {
  const f = await fixture(1027, 1026);
  await expect(f.owner.copySelection()).resolves.toBe('noCopy');
  expect(f.requests).toEqual([]);
  expect(f.openSink).not.toHaveBeenCalled();
  expect(f.state().resourceLedger.used.physicalReads).toBe(0);
}, 120000);
it('retains original native DATA through held actual read loss until settlement', async () => {
  const f = await fixture(),
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
  // Wait for the recorded long upload before applying the controlled loss.
  // This diagnostic test budget is not a production latency acceptance.
  await vi.waitFor(() => expect(entered).toBe(true), { timeout: 110000 });
  f.view.destroy();
  f.dispatch(workspaceUnmounted(scope.workspaceId));
  expect(f.state().resourceLedger.used.physicalReads).toBe(1);
  held.resolve();
  await failed;
  expect(f.sink.write).not.toHaveBeenCalled();
  expect(f.sink.commit).not.toHaveBeenCalled();
  expect(f.sink.abort).toHaveBeenCalledTimes(1);
  expect(f.state().resourceLedger.used.physicalReads).toBe(0);
}, 120000);
it('retains physical sink debt through held-write cancellation without native publication', async () => {
  const f = await fixture(),
    held = deferred();
  let entered = false;
  f.sink.write.mockImplementation(async () => {
    entered = true;
    await held.promise;
  });
  const running = f.owner.copySelection(),
    failed = expect(running).rejects.toThrow();
  // Wait for the recorded long upload before applying the controlled loss.
  // This diagnostic test budget is not a production latency acceptance.
  await vi.waitFor(() => expect(entered).toBe(true), { timeout: 110000 });
  f.owner.cancelSelectionCopy();
  f.view.destroy();
  f.dispatch(workspaceUnmounted(scope.workspaceId));
  expect(f.state().resourceLedger.used.physicalReads).toBe(1);
  expect(f.sink.commit).not.toHaveBeenCalled();
  held.resolve();
  await failed;
  expect(f.sink.commit).not.toHaveBeenCalled();
  expect(f.sink.abort).toHaveBeenCalledTimes(1);
  expect(f.state().resourceLedger.used.physicalReads).toBe(0);
}, 120000);
it('preserves original typed Store refusal without claiming RPC error serialization', async () => {
  const f = await fixture();
  const refusal = recorded.refusals.find((r: any) => r.phase === 'afterCancel');
  expect(refusal.typedStoreError).toBe('NotePage(Expired)');
  f.setHook(async (method, params) => {
    if (method === 'note.operation.read') {
      expect(params).toEqual(refusal.params);
      throw refusal;
    }
  });
  await expect(f.owner.copySelection()).rejects.toBe(refusal);
  expect(f.sink.write).not.toHaveBeenCalled();
  expect(f.sink.commit).not.toHaveBeenCalled();
  expect(f.sink.abort).toHaveBeenCalledTimes(1);
  expect(f.state().resourceLedger.used.physicalReads).toBe(0);
}, 120000);
