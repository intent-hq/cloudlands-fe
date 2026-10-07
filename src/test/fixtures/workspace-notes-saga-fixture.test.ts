import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { appClient } from '$lib/client';
import { store } from '$store/renderer/store';
import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
import { workspaceNotesSaga } from '$store/renderer/slices/workspace-notes/sagas/workspace-notes-saga';
import {
  readNoteRequested,
  searchNotesRequested,
} from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import { selectNoteById } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
import { ContentType, NoteVisibility, type Note } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
import { installMockElectronBridge } from '../ct-mock-electron-bridge';
import { startWorkspaceNotesSagaFixture } from './workspace-notes-saga-fixture';

const workspaceId = 'note-fixture-owner';
const note: Note = {
  id: NoteId('same-note'),
  workspaceId: WorkspaceId(workspaceId),
  title: 'Fixture note',
  content: 'Complete fixture content',
  rev: 1,
  contentType: ContentType.Markdown,
  visibility: NoteVisibility.Workspace,
  tags: [],
  isPinned: false,
  isArchived: false,
  createdAt: '2026-10-07T00:00:00Z',
  updatedAt: '2026-10-07T00:00:00Z',
};
const stops: Array<() => void> = [];
let stopRoot: () => void;
let previousBridge: Window['electronAPI'];
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
function acquire() {
  const [stop] = startWorkspaceNotesSagaFixture(store);
  stops.push(stop);
  return stop;
}

beforeEach(() => {
  previousBridge = window.electronAPI;
  stopRoot = startRootStoreLifecycle(store, { startSagas: () => [] });
});
afterEach(() => {
  stops
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  stopRoot();
  window.electronAPI = previousBridge;
  vi.restoreAllMocks();
});

it('shares the root owner and releases only the fixture reference', async () => {
  const get = vi.spyOn(appClient.notes, 'get').mockResolvedValue(note);
  stops.push(store.runSaga(workspaceNotesSaga));
  const stop = acquire();
  await expect(store.dispatch(readNoteRequested(workspaceId, note.id))).resolves.toEqual(note);
  expect(get).toHaveBeenCalledTimes(1);
  stop();
  await expect(store.dispatch(readNoteRequested(workspaceId, note.id))).resolves.toEqual(note);
  expect(get).toHaveBeenCalledTimes(2);
});

it('ignores late standalone reads and repeated old cleanup after same-ID remount', async () => {
  const old = deferred<Note>();
  const fresh = deferred<Note>();
  const get = vi
    .spyOn(appClient.notes, 'get')
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(fresh.promise)
    .mockResolvedValue(note);
  const stopOld = acquire();
  void store.dispatch(readNoteRequested(workspaceId, note.id));
  await settle();
  stopOld();
  acquire();
  const next = store.dispatch(readNoteRequested(workspaceId, note.id));
  await settle();
  expect(get).toHaveBeenCalledTimes(2);
  stopOld();
  old.resolve({ ...note, content: 'Obsolete content' });
  await settle();
  expect(selectNoteById.select(store.state, workspaceId, note.id)).toBeUndefined();
  fresh.resolve(note);
  await expect(next).resolves.toEqual(note);
  expect(selectNoteById.select(store.state, workspaceId, note.id)?.content).toBe(note.content);
  await expect(store.dispatch(readNoteRequested(workspaceId, note.id))).resolves.toEqual(note);
  expect(get).toHaveBeenCalledTimes(3);
});

it('sends protocol-shaped search requests once and suppresses a cancelled late response', async () => {
  const pending = deferred<unknown>();
  const indexed = {
    requestId: 'indexed',
    indexed: true,
    matches: [
      {
        noteId: note.id,
        workspaceId,
        title: note.title,
        preview: note.content,
        score: 1,
        updatedAt: note.updatedAt,
        isArchived: false,
        workspaceArchived: false,
      },
    ],
  };
  const search = vi
    .fn()
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(indexed)
    .mockResolvedValue({
      requestId: 'fresh',
      indexed: true,
      matches: [],
    });
  installMockElectronBridge({ 'search.notes': search });
  const stop = acquire();
  const adopted = vi.fn();
  void store.dispatch(searchNotesRequested('obsolete', workspaceId)).then(adopted);
  await settle();
  expect(search.mock.calls).toEqual([
    [
      {
        query: 'obsolete',
        limit: 10,
        includeArchived: false,
        preferWorkspaceId: workspaceId,
      },
    ],
  ]);
  stop();
  pending.resolve({ requestId: 'old', indexed: true, matches: [] });
  await settle();
  expect(adopted).not.toHaveBeenCalled();
  acquire();
  stop();
  await expect(store.dispatch(searchNotesRequested('fixture', workspaceId))).resolves.toEqual(
    indexed,
  );
  await expect(store.dispatch(searchNotesRequested('fresh', workspaceId))).resolves.toEqual({
    requestId: 'fresh',
    indexed: true,
    matches: [],
  });
  expect(search).toHaveBeenCalledTimes(3);
});
