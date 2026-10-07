import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { appClient } from '$lib/client';
import * as transport from '$lib/client/live/backend-transport';
import { store } from '$store/renderer/store';
import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
import {
  readNoteRequested,
  searchNotesRequested,
} from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import { startNoteFixtureReads } from './note-fixture-sagas';

let stopRoot: () => void;
let stopNotes: () => void;

beforeEach(() => {
  stopRoot = startRootStoreLifecycle(store, { startSagas: () => [] });
  stopNotes = startNoteFixtureReads(store);
});

afterEach(() => {
  stopNotes();
  stopRoot();
  vi.restoreAllMocks();
});

it('settles note reads and indexed searches in a standalone preview', async () => {
  const read = vi.spyOn(appClient.notes, 'get').mockResolvedValue(null);
  const response = { indexed: true, matches: [] };
  const search = vi.spyOn(transport, 'backendRequest').mockResolvedValue(response);
  await expect(
    store.dispatch(readNoteRequested('fixture-workspace', 'missing')),
  ).resolves.toBeNull();
  await expect(
    store.dispatch(searchNotesRequested('no-match', 'fixture-workspace')),
  ).resolves.toEqual(response);
  expect(read).toHaveBeenCalledTimes(1);
  expect(search).toHaveBeenCalledTimes(1);
});

it('stops consuming requests on cleanup and remounts without duplicate reads', async () => {
  const read = vi.spyOn(appClient.notes, 'get').mockResolvedValue(null);
  const search = vi
    .spyOn(transport, 'backendRequest')
    .mockResolvedValue({ indexed: true, matches: [] });
  stopNotes();
  void store.dispatch(readNoteRequested('fixture-workspace', 'after-dispose'));
  void store.dispatch(searchNotesRequested('after-dispose', 'fixture-workspace'));
  await Promise.resolve();
  expect(read).not.toHaveBeenCalled();
  expect(search).not.toHaveBeenCalled();

  stopNotes = startNoteFixtureReads(store);
  await expect(
    store.dispatch(readNoteRequested('fixture-workspace', 'after-remount')),
  ).resolves.toBeNull();
  await store.dispatch(searchNotesRequested('after-remount', 'fixture-workspace'));
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith('after-remount', 'fixture-workspace');
  expect(search).toHaveBeenCalledTimes(1);
});
