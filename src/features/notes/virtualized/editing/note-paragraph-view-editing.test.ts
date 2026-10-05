import { afterEach, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { appClient } from '$lib/client';
import { MockNotePagesClient } from '$lib/client/mock/mock-note-pages-client';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest, NoteReadPage } from '$lib/client/note-pages';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
import { notePagesSaga } from '$store/renderer/slices/note-pages/sagas/note-pages-saga';
import { workspaceUnmounted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import capture from './__fixtures__/note-paragraph/plain-paragraph-far.json';
import htmlCapture from './__fixtures__/note-paragraph/plain-paragraph-html-tail.json';
import { readNoteWindow } from '../note-window-reader';
import { noteAssemblyResources } from '../note-assembly-reservation';
import { prepareNoteParagraphViewEditing } from './note-paragraph-view-editing';
import { NoteWindowView } from '../note-window-view';
import StarterKit from '@tiptap/starter-kit';
vi.mock('$lib/utils/editor-config', () => ({
  createEditorConfig: () => ({ extensions: [StarterKit] }),
}));

const original = appClient.notes.pages;
afterEach(() => {
  appClient.notes.pages = original;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
async function fixture(raw: { calls: unknown[]; at: number } = capture) {
  const calls = raw.calls as unknown as { request: NotePageRequest; response: NoteReadPage }[];
  const identity = calls[0].response;
  if (identity.kind !== 'noteSourcePage') throw new Error('Missing source');
  const now = Date.parse(identity.expiresAt) - 10_000;
  // Historical signed responses remain unchanged; the clock is explicitly replay-only.
  vi.spyOn(Date, 'now').mockReturnValue(now);
  const requests: NotePageRequest[] = [];
  const reader = new NotePageReader(async (method, params) => {
    expect(method).toBe('note.get');
    const q = params.page as NotePageRequest;
    requests.push(q);
    const found = calls.find(
      ({ request: r }) =>
        r.kind === q.kind &&
        r.cursor === q.cursor &&
        r.maxWireBytes === q.maxWireBytes &&
        r.maxItems === q.maxItems &&
        (q.kind === 'context'
          ? r.kind === 'context' && r.contextRef === q.contextRef
          : 'ref' in q
            ? 'ref' in r && r.ref === q.ref
            : q.kind === 'source' &&
              r.kind === 'source' &&
              r.at === q.at &&
              r.maxSourceBytes === q.maxSourceBytes),
    );
    if (!found) throw new Error('Uncaptured request');
    return found.response;
  });
  const { workspaceId: ws, noteId: id } = identity.scope;
  const window = await readNoteWindow((q) => reader.read(ws, id, q), {
    ...identity,
    at: raw.at,
  });
  let state = a.initialNotePagesState;
  const listeners = new Set<() => void>();
  const channel = stdChannel();
  let started = false;
  const dispatch = (action: Parameters<typeof a.notePagesReducer>[1]) => {
    state = a.notePagesReducer(state, action);
    for (const listener of [...listeners]) listener();
    if (started) channel.put(action);
  };
  dispatch(
    a.pageResourceLimitsConfigured({
      payloadBytes: 100_000_000,
      stringUnits: 100_000_000,
      objectNodes: 100_000_000,
      domNodes: 0,
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
  dispatch(a.pageWindowRequested(ws, id, 'p', raw.at));
  const seed = { owner: 'seed', data: 'seed-data', control: 'seed-control' };
  dispatch(a.pageResourcesRequested(seed.owner, noteAssemblyResources(seed), 12));
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
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  const transport = vi.fn((w: string, n: string, q: NotePageRequest) => reader.read(w, n, q));
  appClient.notes.pages = new MockNotePagesClient({
    capabilities: { backendId: identity.scope.backendId, annotations: false },
    read: transport,
  });
  started = true;
  const task = runSaga(
    { channel, dispatch, getState: () => ({ notePages: state }) },
    notePagesSaga,
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const offer = prepareNoteParagraphViewEditing([port, window, 'p', undefined, () => now], {
    undo: vi.fn(),
    redo: vi.fn(),
  });
  return {
    window,
    offer,
    transport,
    listeners,
    async navigate() {
      dispatch(a.pageWindowRequested(ws, id, 'p', raw.at));
      await vi.waitFor(() => {
        const next = state.byWorkspaceId[ws].notes[id].windows.p;
        expect(next.error).toBeNull();
        expect(next.loading).toBe(false);
        expect(next.value).not.toBe(window);
      });
      const next = state.byWorkspaceId[ws].notes[id].windows.p.value!;
      return {
        window: next,
        offer: prepareNoteParagraphViewEditing([port, next, 'p', undefined, () => now], {
          undo: vi.fn(),
          redo: vi.fn(),
        }),
      };
    },
    read: () => state,
    note: () => state.byWorkspaceId[ws].notes[id],
    unmount: () => dispatch(workspaceUnmounted(ws)),
    stop: () => task.cancel(),
  };
}
it('mounts the actual admitted far paragraph through the production view and atomically publishes its edit', async () => {
  const f = await fixture();
  const { window, offer, transport, listeners } = f;
  const host = document.createElement('div');
  document.body.append(host);
  const view = new NoteWindowView(host, {
    seek: vi.fn(),
    selectionChanged: vi.fn(),
    fullOperation: vi.fn(),
  });
  try {
    const editing = await offer.ready;
    expect(transport).toHaveBeenCalled();
    expect(f.read().resourceLedger.used.physicalReads).toBe(0);
    expect(f.read().resourceLedger.used.assemblies).toBe(0);
    view.updateEditing(editing);
    expect(view.show(window)).toBe(true);
    const editor = view.editor!;
    view.scroller.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(f.note().document!.selection).toEqual({
      anchor: 0,
      head: window.sourceLength,
      anchorAffinity: 1,
      headAffinity: 1,
    });
    expect(f.note().document!.history).toHaveLength(0);
    view.setSelection({ anchor: 65539, head: 65539, anchorAffinity: -1, headAffinity: -1 });
    expect(f.note().document!.selection).toEqual(view.getSelection());
    editor.commands.insertContent('X');
    const note = f.note();
    expect(editor.state.doc.textContent).toBe('aXbc');
    expect(view.host.textContent).toBe('aXbc');
    expect(note.document!.dirty).toEqual([{ start: 65539, end: 65539, text: 'X' }]);
    expect(note.document!.history).toHaveLength(1);
    expect(note.document!.history[0].before).toEqual({
      anchor: 65539,
      head: 65539,
      anchorAffinity: -1,
      headAffinity: -1,
    });
    expect(note.drafts).toHaveLength(1);
    expect(note.drafts[0].splices).toEqual([{ start: 65539, end: 65539, text: 'X' }]);
    expect(view.projection!.sourceAt(3)).toBe(65540);
    offer.cancel();
    const releasing = offer.release();
    f.unmount();
    let retired = false;
    void releasing.then(() => {
      retired = true;
    });
    await Promise.resolve();
    expect(retired).toBe(false);
    expect(f.read().resourceLedger.used.payloadBytes).toBeGreaterThan(0);
    view.destroy();
    await releasing;
    expect(f.read().resourceLedger.used.payloadBytes).toBe(0);
    expect(listeners.size).toBe(0);
  } finally {
    view.destroy();
    await offer.release();
    f.stop();
  }
});

it('replaces a supported captured paragraph with a valid unsupported captured HTML-entry window read-only', async () => {
  const first = await fixture();
  const host = document.createElement('div');
  document.body.append(host);
  const view = new NoteWindowView(host, {
    seek: vi.fn(),
    selectionChanged: vi.fn(),
    fullOperation: vi.fn(),
  });
  let second: Awaited<ReturnType<typeof fixture>> | undefined;
  try {
    view.updateEditing(await first.offer.ready);
    view.show(first.window);
    expect(view.editor!.isEditable).toBe(true);
    const old = view.editor!;
    vi.spyOn(old.view, 'posAtCoords').mockReturnValue(null);
    second = await fixture(htmlCapture);
    const unsupported = await second.offer.ready;
    expect(unsupported).toBeUndefined();
    view.updateEditing(unsupported);
    expect(view.show(second.window)).toBe(true);
    expect(view.editor).not.toBe(old);
    expect(old.isDestroyed).toBe(true);
    expect(view.editor!.isEditable).toBe(false);
    // The immutable Store closure contains renderedText fragments 'html', ' ', 'abc'.
    expect(view.host.textContent).toBe('html abc');
    expect(second.note().drafts).toHaveLength(0);
    await first.offer.release();
  } finally {
    view.destroy();
    first.unmount();
    await first.offer.release();
    first.stop();
    if (second) {
      second.unmount();
      await second.offer.release();
      second.stop();
    }
  }
});

it('accepts the final composing edit before materializing a navigation replacement from current Redux', async () => {
  const f = await fixture();
  const host = document.createElement('div');
  document.body.append(host);
  const view = new NoteWindowView(host, {
    seek: vi.fn(),
    selectionChanged: vi.fn(),
    fullOperation: vi.fn(),
  });
  let next: Awaited<ReturnType<typeof f.navigate>> | undefined;
  try {
    view.showPrepared(f.window, await f.offer.ready);
    const old = view.editor!;
    vi.spyOn(old.view, 'posAtCoords').mockReturnValue(null);
    view.setSelection({ anchor: 65539, head: 65539, anchorAffinity: 1, headAffinity: 1 });
    view.host.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    next = await f.navigate();
    const retiring = f.offer.retire();
    expect(view.showPrepared(next.window, await next.offer.ready)).toBe(false);
    expect(view.editor).toBe(old);
    expect(old.isEditable).toBe(true);
    old.commands.insertContent('X');
    expect(f.note().document!.dirty).toEqual([{ start: 65539, end: 65539, text: 'X' }]);
    expect(f.note().drafts).toHaveLength(1);
    view.host.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await vi.waitFor(() => expect(view.editor).not.toBe(old));
    expect(view.editor!.state.doc.textContent).toBe('aXbc');
    expect(view.host.textContent).toBe('aXbc');
    expect(view.projection!.sourceAt(3)).toBe(65540);
    expect(f.note().document!.history).toHaveLength(1);
    await retiring;
    expect(old.isDestroyed).toBe(true);
  } finally {
    view.destroy();
    f.unmount();
    await f.offer.release();
    if (next) await next.offer.release();
    f.stop();
  }
  expect(f.read().resourceLedger.used.payloadBytes).toBe(0);
  expect(f.listeners.size).toBe(0);
});
