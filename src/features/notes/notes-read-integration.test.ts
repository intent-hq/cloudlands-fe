import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType, NoteVisibility } from '$shared/types';
import type { Note } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';

// FAKE seam: `appClient.notes.get` is stubbed so event-driven refreshes never
// reach the daemon (the event path fetches the single target note, §5.2).
const { notesGetMock } = vi.hoisted(() => ({
  notesGetMock: vi.fn<(noteId: string, wsId?: string) => Promise<Note | null>>(),
}));
vi.mock('$lib/client', () => ({
  appClient: { notes: { get: notesGetMock } },
}));

import { notesReadSaga } from '$store/renderer/slices/workspace-notes/sagas/notes-read-saga';
import { store as appStore } from '$store/renderer/store';

const testStore = appStore as typeof appStore & {
  storeContext?: unknown;
  getExistingStoreContext(): unknown;
};
testStore.getExistingStoreContext = function () {
  return this.storeContext;
};
import {
  applyNoteFromEvent,
  ensureNoteContentLoaded,
  __resetNotesReadServiceForTests,
} from './notes-read-service';
import { loadWorkspaceNotesSucceeded } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';

beforeAll(() => {
  appStore.init();
  const stop = appStore.runSaga(notesReadSaga);
  return stop;
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeNote(id: string, wsId: string, overrides: Partial<Note> = {}): Note {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: NoteId(id),
    workspaceId: WorkspaceId(wsId),
    title: `Note ${id}`,
    content: `body-${id}`,
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Workspace,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Note;
}

import {
  pagePanelOpened,
  pageSessionDiscarded,
} from '$store/renderer/slices/note-pages/note-pages-slice';
it('never full-loads an opted-in page session through open or note events', async () => {
  const ws = 'paged-service',
    id = 'spec';
  appStore.dispatch(
    loadWorkspaceNotesSucceeded([ws], {
      [ws]: [makeNote(id, ws, { content: '', contentLength: 99 })],
    }),
  );
  appStore.dispatch(pagePanelOpened(ws, id, 'panel'));
  notesGetMock.mockClear();
  applyNoteFromEvent(ws, id, 'note:updated');
  expect(await ensureNoteContentLoaded(ws, id)).toBe(false);
  await flush();
  expect(notesGetMock).not.toHaveBeenCalled();
  appStore.dispatch(pageSessionDiscarded(ws, id));
});
it('does not resurrect a note from a full read that finishes after deletion', async () => {
  const ws = 'delete-race',
    id = 'n';
  appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [makeNote(id, ws)] }));
  const pending = deferred<Note | null>();
  notesGetMock.mockReturnValueOnce(pending.promise);
  applyNoteFromEvent(ws, id, 'note:updated');
  applyNoteFromEvent(ws, id, 'note:deleted');
  pending.resolve(makeNote(id, ws));
  await flush();
  expect(appStore.state.workspaceNotes.byWorkspaceId[ws].notes.ids).not.toContain(id);
});

it('rechecks paged ownership before applying concurrent complete-content requests', async () => {
  notesGetMock.mockReset();
  __resetNotesReadServiceForTests();
  const ws = 'trailing-page-owner',
    id = 'spec';
  const slim = makeNote(id, ws, { content: '', contentLength: 80 });
  appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [slim] }));
  const pending = deferred<Note | null>();
  notesGetMock.mockReturnValueOnce(pending.promise).mockResolvedValue({ ...slim, content: 'full' });
  const first = ensureNoteContentLoaded(ws, id);
  expect(notesGetMock).toHaveBeenCalledTimes(1);
  appStore.dispatch(pagePanelOpened(ws, id, 'panel'));
  pending.resolve({ ...slim, content: 'full' });
  expect(await first).toBe(false);
  expect(notesGetMock).toHaveBeenCalledTimes(1);
  appStore.dispatch(pageSessionDiscarded(ws, id));
});

it('keeps the recreated owner when an ensure joins a pending event refresh', async () => {
  notesGetMock.mockReset();
  __resetNotesReadServiceForTests();
  const ws = 'recreated-event-owner';
  const id = 'note';
  const stale = makeNote(id, ws, { content: '', contentLength: 10 });
  appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [stale] }));
  const pending = deferred<Note | null>();
  const recreated = makeNote(id, ws, { content: 'recreated' });
  notesGetMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(recreated);
  const first = ensureNoteContentLoaded(ws, id);
  applyNoteFromEvent(ws, id, 'note:deleted');
  applyNoteFromEvent(ws, id, 'note:created');
  pending.resolve(makeNote(id, ws, { content: 'deleted' }));
  await first;
  expect(notesGetMock).toHaveBeenCalledTimes(2);
  expect(appStore.state.workspaceNotes.byWorkspaceId[ws].notes.map[id]?.content).toBe('recreated');
});

describe('explicit complete-source editing', () => {
  beforeEach(() => {
    __resetNotesReadServiceForTests();
    notesGetMock.mockReset();
  });
  it('loads one whole revision only after edit is requested, even with another paged panel', async () => {
    const { beginFullNoteEdit } = await import('./notes-read-service');
    const ws = 'full-edit',
      id = 'body';
    const slim = makeNote(id, ws, { content: '', contentLength: 900_000, rev: 4 });
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [slim] }));
    appStore.dispatch(pagePanelOpened(ws, id, 'viewer'));
    expect(await ensureNoteContentLoaded(ws, id)).toBe(false);
    expect(notesGetMock).not.toHaveBeenCalled();
    notesGetMock.mockResolvedValueOnce(makeNote(id, ws, { content: '漢'.repeat(300_000), rev: 5 }));
    const edit = beginFullNoteEdit(ws, id);
    expect(await edit.load()).toBe(true);
    expect(notesGetMock).toHaveBeenCalledExactlyOnceWith(id, ws);
    expect(appStore.state.workspaceNotes.byWorkspaceId[ws].notes.map[id]).toMatchObject({
      content: '漢'.repeat(300_000),
      rev: 5,
    });
    edit.release();
    notesGetMock.mockClear();
    applyNoteFromEvent(ws, id, 'note:updated');
    await flush();
    expect(notesGetMock).not.toHaveBeenCalled();
  });
  it.each(['cancel', 'deleted', 'wrong-note', 'old-revision', 'failure'] as const)(
    'rejects %s during full edit loading',
    async (reason) => {
      const { beginFullNoteEdit } = await import('./notes-read-service');
      const ws = 'full-edit-' + reason,
        id = 'body';
      const slim = makeNote(id, ws, { content: '', contentLength: 50, rev: 5 });
      appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [slim] }));
      const pending = deferred<Note | null>();
      notesGetMock.mockReturnValueOnce(pending.promise);
      const edit = beginFullNoteEdit(ws, id);
      const result = edit.load();
      if (reason === 'cancel') edit.release();
      if (reason === 'deleted') applyNoteFromEvent(ws, id, 'note:deleted');
      if (reason === 'failure') pending.reject(new Error('Offline'));
      else
        pending.resolve(
          makeNote(reason === 'wrong-note' ? 'other' : id, ws, {
            content: 'complete',
            rev: reason === 'old-revision' ? 4 : 6,
          }),
        );
      expect(await result).toBe(false);
      expect(appStore.state.workspaceNotes.byWorkspaceId[ws].notes.map[id]?.content).not.toBe(
        'complete',
      );
      edit.release();
    },
  );
});

describe('full edit request ownership in the combined saga', () => {
  beforeEach(() => notesGetMock.mockReset());
  it('settles a released editor immediately without canceling the other editor and viewer', async () => {
    const { beginFullNoteEdit } = await import('./notes-read-service');
    const ws = 'two-full-editors',
      id = 'body';
    appStore.dispatch(
      loadWorkspaceNotesSucceeded([ws], {
        [ws]: [makeNote(id, ws, { content: '', contentLength: 80, rev: 4 })],
      }),
    );
    appStore.dispatch(pagePanelOpened(ws, id, 'viewer'));
    const first = deferred<Note | null>(),
      second = deferred<Note | null>();
    notesGetMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const a = beginFullNoteEdit(ws, id),
      b = beginFullNoteEdit(ws, id);
    let canceled: boolean | undefined;
    const ar = a.load().then((value) => {
      canceled = value;
    });
    const br = b.load();
    a.release();
    try {
      await vi.waitFor(() => expect(canceled).toBe(false));
      second.resolve(makeNote(id, ws, { content: 'current owner', rev: 5 }));
      expect(await br).toBe(true);
      first.resolve(makeNote(id, ws, { content: 'obsolete owner', rev: 5 }));
      await ar;
      expect(appStore.state.workspaceNotes.byWorkspaceId[ws].notes.map[id]?.content).toBe(
        'current owner',
      );
    } finally {
      first.resolve(null);
      second.resolve(null);
      a.release();
      b.release();
      appStore.dispatch(pageSessionDiscarded(ws, id));
    }
  });
  it('settles an unmounted load and rejects its late result after the note remounts', async () => {
    const { beginFullNoteEdit } = await import('./notes-read-service');
    const { workspaceUnmounted } =
      await import('$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice');
    const ws = 'full-edit-remount',
      id = 'body';
    const slim = makeNote(id, ws, { content: '', contentLength: 50, rev: 4 });
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [slim] }));
    const pending = deferred<Note | null>();
    notesGetMock.mockReturnValueOnce(pending.promise);
    const edit = beginFullNoteEdit(ws, id),
      result = edit.load();
    appStore.dispatch(workspaceUnmounted(ws));
    appStore.dispatch(
      loadWorkspaceNotesSucceeded([ws], { [ws]: [{ ...slim, content: 'new owner', rev: 8 }] }),
    );
    expect(await result).toBe(false);
    pending.resolve(makeNote(id, ws, { content: 'old owner', rev: 5 }));
    await flush();
    expect(appStore.state.workspaceNotes.byWorkspaceId[ws].notes.map[id]?.content).toBe(
      'new owner',
    );
    edit.release();
  });
});

it.each(['unmount', 'delete', 'local-delete', 'reconnect'] as const)(
  'retires old edit handles after %s without revoking a fresh editor',
  async (reason) => {
    const { beginFullNoteEdit } = await import('./notes-read-service');
    const { workspaceUnmounted, backendReconnected } =
      await import('$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice');
    const { applyNoteDeleted } =
      await import('$store/renderer/slices/workspace-notes/workspace-notes-slice');
    const ws = 'retire-old-edit-' + reason,
      id = 'body';
    const slim = makeNote(id, ws, { content: '', contentLength: 50, rev: 4 });
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [slim] }));
    const old = beginFullNoteEdit(ws, id);
    if (reason === 'unmount') appStore.dispatch(workspaceUnmounted(ws));
    else if (reason === 'delete') applyNoteFromEvent(ws, id, 'note:deleted');
    else if (reason === 'local-delete') appStore.dispatch(applyNoteDeleted(ws, id));
    else appStore.dispatch(backendReconnected());
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [slim] }));
    appStore.dispatch(pagePanelOpened(ws, id, 'viewer'));
    notesGetMock.mockReset();
    expect(await old.load()).toBe(false);
    expect(await ensureNoteContentLoaded(ws, id)).toBe(false);
    expect(notesGetMock).not.toHaveBeenCalled();
    const fresh = beginFullNoteEdit(ws, id);
    old.release();
    notesGetMock.mockResolvedValueOnce(makeNote(id, ws, { content: 'fresh complete', rev: 5 }));
    try {
      expect(await fresh.load()).toBe(true);
      expect(notesGetMock).toHaveBeenCalledExactlyOnceWith(id, ws);
    } finally {
      fresh.release();
      appStore.dispatch(pageSessionDiscarded(ws, id));
    }
  },
);
it('reopens a failed complete draft without replacing its base with a newer cached revision', async () => {
  const { beginFullNoteEdit } = await import('./notes-read-service');
  const { setRetainedNoteDraft } =
    await import('$store/renderer/slices/workspace-notes/workspace-notes-slice');
  const ws = 'reopen-failed-draft',
    id = 'body';
  appStore.dispatch(
    loadWorkspaceNotesSucceeded([ws], { [ws]: [makeNote(id, ws, { content: 'remote', rev: 8 })] }),
  );
  appStore.dispatch(
    setRetainedNoteDraft(ws, id, {
      workspaceId: ws,
      noteId: id,
      content: 'complete local draft',
      rev: 4,
      error: 'Conflict',
    }),
  );
  notesGetMock.mockReset();
  const edit = beginFullNoteEdit(ws, id);
  try {
    expect(await edit.load()).toBe(true);
    expect(notesGetMock).not.toHaveBeenCalled();
    expect(appStore.state.workspaceNotes.byWorkspaceId[ws].notes.map[id]).toMatchObject({
      content: 'complete local draft',
      rev: 8,
    });
    expect(appStore.state.workspaceNotes.retainedDrafts[JSON.stringify([ws, id])]).toMatchObject({
      content: 'complete local draft',
      rev: 4,
      error: 'Conflict',
    });
  } finally {
    edit.release();
  }
});

it('reopens an exact empty retained source over a slim cached row as a complete editable note', async () => {
  const { beginFullNoteEdit } = await import('./notes-read-service');
  const { setRetainedNoteDraft } =
    await import('$store/renderer/slices/workspace-notes/workspace-notes-slice');
  const { isNoteContentStale } = await import('$shared/utils/note-content');
  const ws = 'reopen-empty-failed-draft',
    id = 'body';
  appStore.dispatch(
    loadWorkspaceNotesSucceeded([ws], {
      [ws]: [
        makeNote(id, ws, {
          content: '',
          contentLength: 80,
          contentPreview: 'remote preview',
          rev: 8,
        }),
      ],
    }),
  );
  appStore.dispatch(
    setRetainedNoteDraft(ws, id, {
      workspaceId: ws,
      noteId: id,
      content: '',
      rev: 4,
      error: 'Conflict',
    }),
  );
  notesGetMock.mockReset();
  const edit = beginFullNoteEdit(ws, id);
  try {
    expect(await edit.load()).toBe(true);
    expect(notesGetMock).not.toHaveBeenCalled();
    const row = appStore.state.workspaceNotes.byWorkspaceId[ws].notes.map[id];
    expect(row?.content).toBe('');
    expect(isNoteContentStale(row)).toBe(false);
    expect(appStore.state.workspaceNotes.retainedDrafts[JSON.stringify([ws, id])]).toMatchObject({
      content: '',
      rev: 4,
      error: 'Conflict',
    });
  } finally {
    edit.release();
  }
});
