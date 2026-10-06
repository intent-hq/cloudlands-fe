import { beforeEach, expect, it, vi } from 'vitest';
import type { NoteWindow } from './note-window-reader';
import type { NoteWindowView } from './note-window-view';
const fake = vi.hoisted(() => ({
  read: vi.fn(),
  window: vi.fn(),
  open: vi.fn(),
  state: {} as { notePages: any },
  notify: new Set<(action: { type: string }) => void>(),
}));
vi.mock('$lib/client', () => ({ appClient: { notes: { pages: { read: fake.read } } } }));
vi.mock('./note-window-reader', async (actual) => ({
  ...(await actual<typeof import('./note-window-reader')>()),
  readNoteWindow: fake.window,
}));
vi.mock('$lib/utils/source-clipboard', async (importActual) => ({
  ...(await importActual<typeof import('$lib/utils/source-clipboard')>()),
  openNoteSourceClipboardSink: fake.open,
}));
vi.mock('$store/renderer/store', async () => {
  const { runSaga, stdChannel } = await import('redux-saga');
  const { notePagesReducer } = await import('$store/renderer/slices/note-pages/note-pages-slice');
  return {
    store: {
      get state() {
        return fake.state;
      },
      runSaga(saga: () => Generator) {
        const channel = stdChannel();
        const task = runSaga({ channel }, saga);
        const send = (action: { type: string }) => channel.put(action);
        fake.notify.add(send);
        return () => {
          fake.notify.delete(send);
          task.cancel();
        };
      },
      dispatch(action: Parameters<typeof notePagesReducer>[1]) {
        fake.state.notePages = notePagesReducer(fake.state.notePages, action);
        for (const fn of fake.notify) fn(action);
      },
    },
  };
});
import { createNoteReadingSurface } from './note-reading-surface';
import {
  notePagesReducer,
  pageResourceLimitsConfigured,
} from '$store/renderer/slices/note-pages/note-pages-slice';
const scope = { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' };
const seed = {
  scope,
  sourceRevision: 'r7',
  snapshotId: 's',
  sourceLength: 10,
  expiresAt: '2099-01-01T00:00:00.000Z',
};
const sink = {
  write: vi.fn(async (_s: string) => {}),
  commit: vi.fn(async () => {}),
  abort: vi.fn(async () => {}),
};
function window(text: string, from: number, to: number): NoteWindow {
  return {
    ...seed,
    range: { start: from, end: to },
    documentEnd: to === 10,
    native: { texts: { text }, references: { parent: ['p'] } },
    context: [
      { kind: 'nativeNode', id: 'p', nodeType: 'paragraph', parentRef: null },
      { kind: 'nativeNode', id: 't', nodeType: 'text', parentRef: 'parent' },
      {
        kind: 'sourceMap',
        textNodeId: 't',
        textRef: 'text',
        mapping: 'identity',
        sourceRange: { start: from, end: to },
        renderedRange: { start: from - 2, end: to - 2 },
      },
    ],
  } as unknown as NoteWindow;
}
function setup() {
  const owner = createNoteReadingSurface('w', 'n', 'panel', vi.fn());
  fake.state.notePages = notePagesReducer(
    undefined,
    pageResourceLimitsConfigured(owner.resourceLimits),
  );
  fake.state.notePages.byWorkspaceId.w = {
    notes: {
      n: {
        generation: 1,
        status: 'ready',
        state: { scope, sourceRevision: 'r7' },
        panels: { panel: [] },
      },
    },
  };
  const view = {
    window: { ...seed },
    selectionCaptureGeneration: 0,
    getSelection: () => ({ anchor: 2, head: 10, anchorAffinity: 1, headAffinity: -1 }),
  } as unknown as NoteWindowView;
  owner.ready!(view);
  return { owner, view };
}
beforeEach(() => {
  vi.clearAllMocks();
  fake.notify.clear();
  fake.open.mockResolvedValue(sink);
});
it('copies the complete source with note.get page reads and releases its credits', async () => {
  const { owner } = setup();
  fake.read.mockResolvedValue({
    ...seed,
    kind: 'noteSourcePage',
    range: { start: 0, end: 10 },
    text: '**source**',
    nextCursor: null,
  });
  await owner.copyDocument();
  expect(fake.read).toHaveBeenCalledWith(
    'w',
    'n',
    expect.objectContaining({ kind: 'source', sourceRevision: 'r7', snapshotId: 's' }),
  );
  expect(sink.write).toHaveBeenCalledWith('**source**');
  expect(sink.commit).toHaveBeenCalledOnce();
  expect(Object.keys(fake.state.notePages.resourceLedger.owners)).toHaveLength(0);
});
it('selects canonical rendered text across pages and publishes only after both complete passes', async () => {
  const { owner } = setup();
  fake.window.mockImplementation(async (_read, { at }) =>
    at === 2 ? window('Hello ', 2, 8) : window('世界', 8, 10),
  );
  await expect(owner.copySelection!()).resolves.toBe('copied');
  expect(fake.open).toHaveBeenCalledWith(
    expect.objectContaining({ length: 8 }),
    expect.any(AbortSignal),
  );
  expect(sink.write.mock.calls.map((c) => c[0]).join('')).toBe('Hello 世界');
  expect(sink.commit).toHaveBeenCalledOnce();
  expect(fake.window).toHaveBeenCalledTimes(4);
});
it('searches all pinned canonical windows and emits correct cross-page source coordinates', async () => {
  const { owner } = setup();
  fake.window.mockImplementation(async (_read, { at }) =>
    at === 0 ? window('hel', 2, 5) : window('lo!!!', 5, 10),
  );
  // A source window covers its requested address even where delimiters have no text.
  fake.window.mockImplementationOnce(async () => ({
    ...window('hel', 2, 5),
    range: { start: 0, end: 5 },
  }));
  const consume = vi.fn(async () => {});
  await owner.searchRendered!('hello', consume);
  expect(consume.mock.calls.at(-1)).toMatchObject([
    { hits: [{ sourceRange: { start: 2, end: 7 } }], count: { value: 1, exact: true } },
  ]);
  expect(fake.window.mock.calls[1][1]).toMatchObject({
    at: 5,
    sourceRevision: 'r7',
    snapshotId: 's',
  });
});
it('cancels on revision invalidation without publishing partial clipboard data', async () => {
  const { owner } = setup();
  fake.read.mockImplementation(async () => {
    fake.state.notePages.byWorkspaceId.w.notes.n.generation++;
    return {
      ...seed,
      kind: 'noteSourcePage',
      range: { start: 0, end: 10 },
      text: '**source**',
      nextCursor: null,
    };
  });
  await expect(owner.copyDocument()).rejects.toThrow();
  expect(sink.commit).not.toHaveBeenCalled();
  expect(sink.abort).toHaveBeenCalledOnce();
  expect(Object.keys(fake.state.notePages.resourceLedger.owners)).toHaveLength(0);
});
it('rejects selection changes between count and publication passes', async () => {
  const { owner, view } = setup();
  fake.window.mockResolvedValue(window('abcdefgh', 2, 10));
  fake.open.mockImplementation(async () => {
    Object.defineProperty(view, 'selectionCaptureGeneration', { value: 1 });
    return sink;
  });
  await expect(owner.copySelection!()).rejects.toThrow();
  expect(sink.commit).not.toHaveBeenCalled();
  expect(sink.abort).toHaveBeenCalledOnce();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function sourcePage() {
  return {
    ...seed,
    kind: 'noteSourcePage',
    range: { start: 0, end: 10 },
    text: '**source**',
    nextCursor: null,
  };
}
it.each(['cancel', 'dispose'])(
  'forwards %s while publication preparation is pending and joins cleanup',
  async (kind) => {
    const { owner } = setup();
    fake.read.mockResolvedValue(sourcePage());
    const pending = deferred<void>();
    const cleanup = deferred<void>();
    sink.commit.mockImplementationOnce(() => pending.promise);
    sink.abort.mockImplementationOnce(() => cleanup.promise);
    const copy = owner.copyDocument();
    await vi.waitFor(() => expect(sink.commit).toHaveBeenCalledOnce());
    if (kind === 'cancel') owner.cancelCopy!();
    else owner.dispose();
    expect(sink.abort).toHaveBeenCalledOnce();
    expect(Object.keys(fake.state.notePages.resourceLedger.owners).length).toBeGreaterThan(0);
    pending.resolve();
    cleanup.resolve();
    await copy;
    expect(Object.keys(fake.state.notePages.resourceLedger.owners)).toHaveLength(0);
  },
);
it('retains cleanup debt when failed publication cannot acknowledge abort', async () => {
  const { owner } = setup();
  fake.read.mockResolvedValue(sourcePage());
  sink.commit.mockRejectedValueOnce(new Error('lost commit'));
  sink.abort.mockRejectedValueOnce(new Error('lost abort'));
  await expect(owner.copyDocument()).rejects.toThrow('lost commit');
  expect(Object.keys(fake.state.notePages.resourceLedger.owners)).toHaveLength(1);
});
it('holds rendered search result admission until cleared', async () => {
  const { owner } = setup();
  fake.window.mockResolvedValue({ ...window('hello!!!', 2, 10), range: { start: 0, end: 10 } });
  await owner.searchRendered!('hello', async () => {});
  expect(Object.keys(fake.state.notePages.resourceLedger.owners)).toHaveLength(1);
  owner.cancelRenderedSearch!();
  expect(Object.keys(fake.state.notePages.resourceLedger.owners)).toHaveLength(0);
});

it('forwards session invalidation while commit is pending', async () => {
  const { owner } = setup();
  fake.read.mockResolvedValue(sourcePage());
  const pending = deferred<void>();
  sink.commit.mockImplementationOnce(() => pending.promise);
  const copying = owner.copyDocument();
  await vi.waitFor(() => expect(sink.commit).toHaveBeenCalledOnce());
  fake.state.notePages.byWorkspaceId.w.notes.n.generation++;
  for (const fn of fake.notify) fn({ type: 'notePages/reset' });
  expect(sink.abort).toHaveBeenCalledOnce();
  pending.resolve();
  await copying;
});
it('retains only sink credit for an unknown begin cleanup acknowledgement', async () => {
  const { SourceClipboardCleanupError } = await import('$lib/utils/source-clipboard');
  const { owner } = setup();
  fake.open.mockRejectedValueOnce(
    new SourceClipboardCleanupError(new Error('lost begin'), new Error('lost abort')),
  );
  await expect(owner.copyDocument()).rejects.toThrow('lost begin');
  const ledger = fake.state.notePages.resourceLedger;
  expect(Object.keys(ledger.owners)).toHaveLength(1);
  expect(Object.keys(ledger.owners)[0]).toContain('note-copy-sink:');
  await expect(owner.copyDocument()).rejects.toThrow('cleanup');
});
it('refuses excessive window assembly input before canonical processing', async () => {
  const { owner } = setup();
  fake.read.mockResolvedValue({ ...sourcePage(), text: 'x'.repeat(6000) });
  fake.window.mockImplementation(async (read) => {
    for (let i = 0; i < 150; i++) await read({ kind: 'source' });
    return window('hello!!!', 2, 10);
  });
  await expect(owner.searchRendered!('hello', async () => {})).rejects.toThrow('assembly budget');
  expect(fake.read.mock.calls.length).toBeLessThan(150);
  owner.cancelRenderedSearch!();
  expect(Object.keys(fake.state.notePages.resourceLedger.owners)).toHaveLength(0);
});
it('accounts retained results across simultaneous panels under the global limit', async () => {
  const { view } = setup();
  fake.window.mockResolvedValue({ ...window('hello!!!', 2, 10), range: { start: 0, end: 10 } });
  const owners = Array.from({ length: 128 }, () =>
    createNoteReadingSurface('w', 'n', 'panel', vi.fn()),
  );
  let refused = 0;
  for (const owner of owners) {
    owner.ready!(view);
    try {
      await owner.searchRendered!('hello', async () => {});
    } catch {
      refused++;
    }
  }
  expect(refused).toBeGreaterThan(0);
  for (const owner of owners) owner.dispose();
  expect(Object.keys(fake.state.notePages.resourceLedger.owners)).toHaveLength(0);
});

it('admits retained and replacement viewer DATA alongside a command with held results', async () => {
  const { owner } = setup();
  const { store } = await import('$store/renderer/store');
  const { noteAssemblyResources } = await import('./note-assembly-reservation');
  const { pageResourcesRequested, pageResourcesReleased } =
    await import('$store/renderer/slices/note-pages/note-pages-slice');
  for (const id of ['retained', 'replacement']) {
    store.dispatch(
      pageResourcesRequested(
        id,
        noteAssemblyResources({ owner: id, data: id + '-data', control: id + '-control' }),
      ),
    );
    expect(fake.state.notePages.resourceLedger.owners[id]).toBeDefined();
  }
  fake.window.mockResolvedValue({ ...window('hello!!!', 2, 10), range: { start: 0, end: 10 } });
  await owner.searchRendered!('hello', async () => {});
  expect(Object.keys(fake.state.notePages.resourceLedger.owners)).toHaveLength(3);
  owner.dispose();
  for (const id of ['retained', 'replacement']) store.dispatch(pageResourcesReleased(id));
  expect(Object.keys(fake.state.notePages.resourceLedger.owners)).toHaveLength(0);
});

it.each(['cancel', 'replace', 'dispose'])(
  'holds pending consume credit through %s until it settles',
  async (action) => {
    const { owner } = setup();
    fake.window.mockResolvedValue({ ...window('hello!!!', 2, 10), range: { start: 0, end: 10 } });
    const pending = deferred<void>();
    const consume = vi.fn(() => pending.promise);
    const searching = owner.searchRendered!('hello', consume);
    const outcome = expect(searching).rejects.toThrow();
    await vi.waitFor(() => expect(consume).toHaveBeenCalledOnce());
    const old = Object.keys(fake.state.notePages.resourceLedger.owners).find((x) =>
      x.startsWith('note-search-results:'),
    )!;
    const cost = { ...fake.state.notePages.resourceLedger.resources[old].cost };
    if (action === 'dispose') owner.dispose();
    else if (action === 'replace') await owner.searchRendered!('hello', async () => {});
    else owner.cancelRenderedSearch!();
    expect(fake.state.notePages.resourceLedger.resources[old].cost).toEqual(cost);
    pending.resolve();
    await outcome;
    expect(fake.state.notePages.resourceLedger.owners[old]).toBeUndefined();
    expect(Object.keys(fake.state.notePages.resourceLedger.owners)).toHaveLength(
      action === 'replace' ? 1 : 0,
    );
    owner.dispose();
  },
);

it('releases cancelled result credit when the pending consumer rejects', async () => {
  const { owner } = setup();
  fake.window.mockResolvedValue({ ...window('hello!!!', 2, 10), range: { start: 0, end: 10 } });
  const pending = deferred<void>();
  const consume = vi.fn(() => pending.promise);
  const searching = owner.searchRendered!('hello', consume);
  const outcome = expect(searching).rejects.toThrow('consumer rejected');
  await vi.waitFor(() => expect(consume).toHaveBeenCalledOnce());
  owner.cancelRenderedSearch!();
  expect(Object.keys(fake.state.notePages.resourceLedger.owners)).toHaveLength(2);
  pending.reject(new Error('consumer rejected'));
  await outcome;
  expect(Object.keys(fake.state.notePages.resourceLedger.owners)).toHaveLength(0);
});
