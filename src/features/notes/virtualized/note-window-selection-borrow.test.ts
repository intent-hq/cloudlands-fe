/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { appClient } from '$lib/client';
import { MockNotePagesClient } from '$lib/client/mock/mock-note-pages-client';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
import { notePagesSaga } from '$store/renderer/slices/note-pages/sagas/note-pages-saga';
import { workspaceUnmounted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { noteAssemblyResources } from './note-assembly-reservation';
import { prepareNoteParagraphViewEditing } from './editing/note-paragraph-view-editing';
import { TextSelection } from '@tiptap/pm/state';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest, NoteReadPage } from '$lib/client/note-pages';
import { readNoteWindow } from './note-window-reader';
import { NoteWindowView, type NoteViewEditing } from './note-window-view';
import {
  createNoteParagraphEditAuthority,
  noteParagraphEditContextSteps,
  type NoteParagraphEditGrant,
} from './editing/note-paragraph-edit-authority';
import { createNoteDocumentSession } from './editing/note-document-edit-session';
import { createNoteDocumentTransactionOwner } from './editing/note-document-transaction-owner';
import plainOne from './editing/__fixtures__/note-paragraph/plain-paragraph-one.json';
import plainFar from './editing/__fixtures__/note-paragraph/plain-paragraph-far.json';
import { serializeSelectionToMarkdown } from '$lib/utils/selected-note-markdown-copy';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
// Controlled DATA grant for immutable captured responses, not a live reservation.
function controlledGrant(
  window: NoteParagraphEditGrant['window'],
  identity: NoteParagraphEditGrant['identity'],
): NoteParagraphEditGrant {
  let claimed = false;
  return {
    window,
    identity,
    allowance: { retainedBytes: 8192, requests: 96, descriptors: 128, wireBytes: 8192 },
    current: () => true,
    claim: () => {
      if (claimed) return false;
      claimed = true;
      return true;
    },
  };
}
async function capturedWindow(raw: { at: number; calls: unknown[] } = plainOne) {
  const calls = raw.calls as unknown as Array<{
    request: NotePageRequest;
    response: NoteReadPage;
  }>;
  const identity = calls[0].response;
  if (identity.kind !== 'noteSourcePage') throw new Error('Missing captured source');
  const requests: NotePageRequest[] = [];
  const reader = new NotePageReader(async (_method, params) => {
    const q = params.page as NotePageRequest;
    requests.push(q);
    const found = calls.find(
      ({ request: r }) =>
        r.kind === q.kind &&
        r.cursor === q.cursor &&
        r.maxWireBytes === q.maxWireBytes &&
        r.maxItems === q.maxItems &&
        ('contextRef' in q
          ? 'contextRef' in r && r.contextRef === q.contextRef
          : 'ref' in q
            ? 'ref' in r && r.ref === q.ref
            : q.kind === 'source' &&
              r.kind === 'source' &&
              r.at === q.at &&
              r.maxSourceBytes === q.maxSourceBytes),
    );
    if (!found) throw new Error('Uncaptured Store edit request: ' + JSON.stringify(q));
    return found.response;
  });
  const window = await readNoteWindow(
    (q) => reader.read(identity.scope.workspaceId, identity.scope.noteId, q),
    { ...identity, at: raw.at },
  );
  expect(window.cost.requests).toBeLessThanOrEqual(96);
  expect(window.cost.canonicalBytes ?? 0).toBeLessThanOrEqual(8192);
  return {
    window,
    identity,
    requests,
    read: (q: NotePageRequest) => reader.read(identity.scope.workspaceId, identity.scope.noteId, q),
  };
}

async function fixture(raw: { at: number; calls: unknown[] } = plainFar) {
  const f = await capturedWindow(raw);
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(f.identity.expiresAt) - 1000);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const iterator = noteParagraphEditContextSteps(
    f.window,
    f.identity,
    () => true,
    controlledGrant(f.window, f.identity),
    () => Date.now(),
  );
  let next = iterator.next();
  while (!next.done) next = iterator.next(await f.read(next.value));
  const context = next.value;
  let session = createNoteDocumentSession(
    f.window.scope,
    f.window.sourceRevision,
    f.window.sourceLength,
  );
  const editing: NoteViewEditing = {
    bind(window, projection, doc) {
      const authority = createNoteParagraphEditAuthority(window, projection, context, doc);
      return createNoteDocumentTransactionOwner(
        authority,
        () => session,
        (_before, after) => {
          session = after;
        },
      );
    },
    undo() {},
    redo() {},
  };
  const scroller = document.createElement('div');
  document.body.append(scroller);
  let held = 0,
    released = 0,
    operationLive = true;
  const retainWindow = vi.fn((window) => {
    expect(window).toBe(f.window);
    held++;
    let done = false;
    return () => {
      if (!done) {
        done = true;
        held--;
        released++;
      }
    };
  });
  const options = {
    editing,
    retainWindow,
    seek: vi.fn(),
    selectionChanged: vi.fn((selection) => {
      session = { ...session, selection };
    }),
    fullOperation: vi.fn(),
  };
  const view = new NoteWindowView(scroller, options);
  cleanups.push(() => view.destroy());
  expect(view.show(f.window)).toBe(true);
  const selected = {
    anchor: raw.at + 2,
    head: raw.at,
    anchorAffinity: 1 as const,
    headAffinity: -1 as const,
  };
  view.setSelection(selected);
  const identity = {
    scope: f.identity.scope,
    sourceRevision: f.identity.sourceRevision,
    snapshotId: f.identity.snapshotId,
    documentGeneration: session.generation,
    liveGeneration: view.selectionCaptureGeneration,
    selectionGeneration: 9,
    expiresAt: f.identity.expiresAt,
  };
  return {
    ...f,
    view,
    identity,
    selected,
    editing,
    options,
    raw,
    borrow: () => {
      identity.liveGeneration = view.selectionCaptureGeneration;
      identity.documentGeneration = session.generation;
      return view.borrowSelectionMarkdown(identity, () => operationLive);
    },
    counts: () => ({ held, released }),
    setLive: (value: boolean) => {
      operationLive = value;
    },
    session: () => session,
    invalidateOwner: () => {
      session = { ...session, generation: session.generation + 1 };
    },
  };
}

it.each([plainOne, plainFar])(
  'borrows actual configured view selection at $at and retains DATA until release',
  async (raw) => {
    const f = await fixture(raw),
      baseline = f.counts().held,
      borrow = f.borrow();
    expect(borrow.capture.markdown).toBe('ab');
    expect(borrow.capture.markdown).toBe(serializeSelectionToMarkdown(f.view.editor!.view));
    expect(borrow.capture.sourceRange).toEqual({ start: raw.at, end: raw.at + 2 });
    expect(borrow.capture.selection).toEqual(f.selected);
    expect(borrow.capture.inline.attributes).toEqual({});
    expect(borrow.current()).toBe(true);
    expect(Object.isFrozen(borrow)).toBe(true);
    expect(f.counts().held).toBe(baseline);
    borrow.release();
    borrow.release();
    expect(borrow.current()).toBe(false);
    expect(f.counts().held).toBe(baseline);
  },
);
it('cannot revive after external selection loss and restoration without an intermediate current poll', async () => {
  const f = await fixture(),
    borrow = f.borrow();
  f.view.setSelection({ ...f.selected, head: f.raw.at + 1 });
  f.view.setSelection(f.selected);
  expect(borrow.current()).toBe(false);
  borrow.release();
});
it('cannot revive after native selection transactions restore the original endpoints', async () => {
  const f = await fixture(),
    borrow = f.borrow(),
    editor = f.view.editor!;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2, 3)));
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3, 1)));
  expect(borrow.current()).toBe(false);
  borrow.release();
});
it('invalidates on actual native edits and keeps original immutable capture', async () => {
  const f = await fixture(),
    borrow = f.borrow(),
    editor = f.view.editor!;
  editor.view.dispatch(editor.state.tr.insertText('X', 2));
  expect(f.session().generation).toBeGreaterThan(0);
  expect(borrow.current()).toBe(false);
  expect(borrow.capture.markdown).toBe('ab');
  borrow.release();
});
it('latches observed operation revocation and identity changes permanently', async () => {
  const f = await fixture(),
    borrow = f.borrow();
  f.setLive(false);
  expect(borrow.current()).toBe(false);
  f.setLive(true);
  expect(borrow.current()).toBe(false);
  borrow.release();
  const second = f.borrow();
  f.identity.selectionGeneration++;
  expect(second.current()).toBe(false);
  f.identity.selectionGeneration--;
  expect(second.current()).toBe(false);
  second.release();
});
it('invalidates owner replacement and view retirement while retaining borrow through cleanup', async () => {
  const f = await fixture(),
    borrow = f.borrow(),
    baseline = f.counts().held;
  f.view.updateEditing(undefined);
  f.view.updateEditing(f.editing);
  expect(borrow.current()).toBe(false);
  f.view.destroy();
  await Promise.resolve();
  await Promise.resolve();
  expect(f.counts().held).toBeGreaterThanOrEqual(1);
  borrow.release();
  expect(f.counts().held).toBeLessThan(baseline);
});
it('rejects unowned views and stale expiry before borrowing DATA', async () => {
  const f = await fixture(),
    baseline = f.counts().held;
  f.identity.expiresAt = '2099-01-01T00:00:00Z';
  expect(() => f.borrow()).toThrow();
  expect(f.counts().held).toBe(baseline);
  f.identity.expiresAt = f.window.expiresAt!;
  f.view.updateEditing(undefined);
  expect(() => f.borrow()).toThrow();
});
it('returns collapsed NoCopy without publishing or clearing clipboard', async () => {
  const f = await fixture();
  f.view.setSelection({ ...f.selected, anchor: f.raw.at, head: f.raw.at });
  const borrow = f.borrow();
  expect(borrow.capture.empty).toBe('collapsed');
  expect(borrow.capture.markdown).toBe(null);
  expect(f.options.fullOperation).not.toHaveBeenCalled();
  borrow.release();
});
it('releases retained DATA if actual serializer capture fails', async () => {
  const f = await fixture(),
    baseline = f.counts().held;
  const schema = f.view.editor!.schema,
    spec = schema.nodes.paragraph.spec,
    original = spec.toDOM;
  delete schema.cached.domSerializer;
  try {
    spec.toDOM = () => ['h1', 0];
    expect(() => f.borrow()).toThrow();
    expect(f.counts().held).toBe(baseline);
  } finally {
    spec.toDOM = original;
    delete schema.cached.domSerializer;
  }
});
it('revokes on composition and remount requests before deferred changes settle', async () => {
  const f = await fixture(),
    borrow = f.borrow();
  f.view.host.dispatchEvent(new Event('compositionstart'));
  expect(borrow.current()).toBe(false);
  borrow.release();
  expect(() => f.borrow()).toThrow();
});

it('notifies native loss once immediately while a borrower holds pending work', async () => {
  const f = await fixture(),
    borrow = f.borrow(),
    changed = vi.fn(),
    baseline = f.counts().held;
  const unsubscribe = borrow.subscribe(changed);
  f.view.setSelection({ ...f.selected, head: f.raw.at + 1 });
  expect(changed).toHaveBeenCalledTimes(1);
  expect(borrow.current()).toBe(false);
  expect(f.counts().held).toBe(baseline);
  f.view.setSelection(f.selected);
  expect(changed).toHaveBeenCalledTimes(1);
  unsubscribe();
  borrow.release();
  expect(f.counts().held).toBe(baseline);
  f.view.destroy();
  await vi.waitFor(() => expect(f.counts().held).toBe(0));
  const late = vi.fn();
  borrow.subscribe(late);
  expect(late).toHaveBeenCalledTimes(1);
});
it('supports unsubscribe and safely contains a throwing loss subscriber', async () => {
  const f = await fixture(),
    borrow = f.borrow(),
    gone = vi.fn(),
    observed = vi.fn();
  borrow.subscribe(gone)();
  borrow.subscribe(() => {
    throw new Error('observer');
  });
  borrow.subscribe(observed);
  f.view.destroy();
  expect(gone).not.toHaveBeenCalled();
  expect(observed).toHaveBeenCalledTimes(1);
  borrow.release();
  expect(observed).toHaveBeenCalledTimes(1);
});
it('binds numeric native generation and allows a shorter original operation expiry', async () => {
  const f = await fixture(),
    generation = f.view.selectionCaptureGeneration;
  f.identity.liveGeneration = generation - 1;
  expect(() => f.view.borrowSelectionMarkdown(f.identity, () => true)).toThrow();
  f.identity.liveGeneration = generation;
  f.identity.expiresAt = new Date(Date.now() + 100).toISOString();
  const borrow = f.borrow();
  expect(borrow.current()).toBe(true);
  borrow.release();
  f.view.setSelection(f.selected);
  expect(f.view.selectionCaptureGeneration).toBeGreaterThan(generation);
});

it('refuses direct native state loss and restoration before any current poll', async () => {
  const f = await fixture(),
    borrow = f.borrow(),
    changed = vi.fn(),
    editor = f.view.editor!,
    original = editor.state;
  borrow.subscribe(changed);
  editor.view.updateState(
    original.apply(original.tr.setSelection(TextSelection.create(original.doc, 2, 3))),
  );
  editor.view.updateState(original);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(borrow.current()).toBe(false);
  borrow.release();
});
it('refuses mutation of the original window expiry', async () => {
  const f = await fixture(),
    borrow = f.borrow(),
    original = f.window.expiresAt;
  f.window.expiresAt = '2099-01-01T00:00:00Z';
  expect(borrow.current()).toBe(false);
  f.window.expiresAt = original;
  expect(borrow.current()).toBe(false);
  borrow.release();
});

it('notifies immediate direct native destruction and keeps DATA until borrower release', async () => {
  const f = await fixture(),
    borrow = f.borrow(),
    changed = vi.fn(),
    baseline = f.counts().held;
  borrow.subscribe(changed);
  f.view.editor!.destroy();
  expect(changed).toHaveBeenCalledTimes(1);
  expect(borrow.current()).toBe(false);
  expect(f.counts().held).toBe(baseline);
  f.view.destroy();
  await Promise.resolve();
  await Promise.resolve();
  expect(f.counts().held).toBe(baseline);
  borrow.release();
  expect(f.counts().held).toBe(0);
});

it('rechecks native owner after an executable operation predicate invalidates it', async () => {
  const f = await fixture();
  let armed = false;
  const borrow = f.view.borrowSelectionMarkdown(f.identity, () => {
    if (armed) f.invalidateOwner();
    return true;
  });
  armed = true;
  expect(borrow.current()).toBe(false);
  borrow.release();
});

it('retains the real prepared-context ledger through held consumer IO after view destruction', async () => {
  const f = await capturedWindow(plainFar);
  const now = Date.parse(f.identity.expiresAt) - 10000;
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const { workspaceId: ws, noteId: id } = f.identity.scope;
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
      payloadBytes: 100000000,
      stringUnits: 100000000,
      objectNodes: 100000000,
      domNodes: 0,
      physicalReads: 1,
      assemblies: 1,
    }),
  );
  dispatch(a.pagePanelOpened(ws, id, 'p'));
  dispatch(
    a.pageStateReceived(ws, id, 0, {
      kind: 'notePageState',
      scope: f.identity.scope,
      sourceRevision: f.identity.sourceRevision,
      stateGeneration: '1',
      attributionGeneration: 'a',
      attributionState: 'ready',
      commentRevision: 'c',
      deleted: false,
      invalidation: 'all',
    }),
  );
  dispatch(a.pageWindowRequested(ws, id, 'p', plainFar.at));
  const seed = { owner: 'seed', data: 'seed-data', control: 'seed-control' };
  dispatch(a.pageResourcesRequested(seed.owner, noteAssemblyResources(seed), 12));
  dispatch(
    a.pageWindowSettled(ws, id, 'p', 0, 1, f.window, null, {
      sponsor: seed.owner,
      resource: seed.data,
      owner: 'window-seed',
    }),
  );
  dispatch(a.pageResourcesReleased(seed.owner));
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
  const original = appClient.notes.pages;
  appClient.notes.pages = new MockNotePagesClient({
    capabilities: { backendId: f.identity.scope.backendId, annotations: false },
    read: (_w, _n, q) => f.read(q),
  });
  started = true;
  const task = runSaga(
    { channel, dispatch, getState: () => ({ notePages: state }) },
    notePagesSaga,
  );
  const offer = prepareNoteParagraphViewEditing([port, f.window, 'p', undefined, () => now], {
    undo: vi.fn(),
    redo: vi.fn(),
  });
  const host = document.createElement('div');
  document.body.append(host);
  const view = new NoteWindowView(host, {
    seek: vi.fn(),
    selectionChanged: vi.fn(),
    fullOperation: vi.fn(),
    retainWindow(window) {
      const owner = 'selection-test-window';
      dispatch(a.pageWindowRetained(ws, id, 'p', 0, window, owner));
      expect(state.resourceLedger.owners).toHaveProperty(owner);
      return () => dispatch(a.pageResourcesReleased(owner));
    },
  });
  let borrow: ReturnType<NoteWindowView['borrowSelectionMarkdown']> | undefined;
  try {
    view.updateEditing(await offer.ready);
    expect(view.show(f.window)).toBe(true);
    view.setSelection({
      anchor: plainFar.at + 2,
      head: plainFar.at,
      anchorAffinity: 1,
      headAffinity: -1,
    });
    borrow = view.borrowSelectionMarkdown(
      {
        scope: f.identity.scope,
        sourceRevision: f.identity.sourceRevision,
        snapshotId: f.identity.snapshotId,
        documentGeneration: state.byWorkspaceId[ws].notes[id].document!.generation,
        liveGeneration: view.selectionCaptureGeneration,
        selectionGeneration: 1,
        expiresAt: f.identity.expiresAt,
      },
      () => true,
    );
    expect(borrow.capture.markdown).toBe('ab');
    const contextOwner = Object.keys(state.resourceLedger.owners).find((key) =>
      key.startsWith('edit-context:'),
    )!;
    expect(contextOwner).toBeTruthy();
    const allocation = state.resourceLedger.owners[contextOwner];
    let settle!: () => void;
    // Controlled downstream selection IO; preparation itself used actual Redux read saga/ledger.
    const pending = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const finishing = pending.finally(() => borrow!.release());
    let retired = false;
    const retiring = offer.retire().then(() => {
      retired = true;
    });
    view.destroy();
    dispatch(workspaceUnmounted(ws));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(borrow.current()).toBe(false);
    expect(retired).toBe(false);
    expect(state.resourceLedger.owners[contextOwner]).toEqual(allocation);
    expect(state.resourceLedger.used.payloadBytes).toBeGreaterThan(0);
    settle();
    await finishing;
    await retiring;
    expect(state.resourceLedger.used.payloadBytes).toBe(0);
    expect(listeners.size).toBe(0);
    borrow.release();
  } finally {
    borrow?.release();
    view.destroy();
    await offer.release();
    task.cancel();
    appClient.notes.pages = original;
  }
});
