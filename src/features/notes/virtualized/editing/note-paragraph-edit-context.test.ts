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
import { readNoteWindow } from '../note-window-reader';
import { projectNoteWindow } from '../note-window-projection';
import { noteAssemblyResources } from '../note-assembly-reservation';
import { nativeFixtureEditor } from '../__tests__/canonical-table-fixture';
import {
  createNoteDocumentSession,
  materializeNoteDocumentAuthority,
  prepareNoteDocumentEdit,
} from './note-document-edit-session';
import { prepareNoteParagraphContext } from './note-paragraph-edit-context';

const original = appClient.notes.pages;
afterEach(() => {
  appClient.notes.pages = original;
  vi.restoreAllMocks();
});
it('composes the real far Store closure with admitted saga reads and a retained native authority borrow', async () => {
  const calls = capture.calls as unknown as { request: NotePageRequest; response: NoteReadPage }[];
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
    at: capture.at,
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
  dispatch(a.pageWindowRequested(ws, id, 'p', capture.at));
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
  const offer = prepareNoteParagraphContext(port, window, 'p', undefined, () => now);
  const projection = projectNoteWindow(window),
    editor = nativeFixtureEditor(projection.content);
  let retireBorrow: (() => void) | undefined;
  try {
    const ready = await offer.ready;
    expect(transport).toHaveBeenCalled();
    expect(requests.filter((q) => q.kind === 'source').every((q) => q.at === 65538)).toBe(true);
    expect(state.resourceLedger.used.physicalReads).toBe(0);
    expect(state.resourceLedger.used.assemblies).toBe(0);
    const borrow = ready.borrow();
    retireBorrow = borrow.release;
    const base = borrow.create(projection, editor.state.doc);
    const session = createNoteDocumentSession(
      window.scope,
      window.sourceRevision,
      window.sourceLength,
    );
    editor.commands.setTextSelection(2);
    session.selection = {
      anchor: base.sourceAt(editor.state.selection.anchor),
      head: base.sourceAt(editor.state.selection.head),
      anchorAffinity: 1,
      headAffinity: 1,
    };
    const initial = materializeNoteDocumentAuthority(session, base);
    const edited = prepareNoteDocumentEdit(session, editor.state.tr.insertText('X'), initial);
    expect(edited.splices).toEqual([{ start: 65539, end: 65539, text: 'X' }]);
    expect(() => borrow.create(projection, editor.state.doc)).toThrow(/superseded/);
    offer.cancel();
    expect(ready.current()).toBe(false);
    const releasing = offer.release();
    expect(offer.release()).toBe(releasing);
    dispatch(workspaceUnmounted(ws));
    let retired = false;
    void releasing.then(() => {
      retired = true;
    });
    await Promise.resolve();
    expect(retired).toBe(false);
    expect(state.resourceLedger.used.payloadBytes).toBeGreaterThan(0);
    editor.destroy();
    borrow.release();
    borrow.release();
    await releasing;
    expect(state.resourceLedger.used.payloadBytes).toBe(0);
    expect(listeners.size).toBe(0);
  } finally {
    editor.destroy();
    retireBorrow?.();
    await offer.release();
    task.cancel();
  }
});
