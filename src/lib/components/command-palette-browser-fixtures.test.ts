import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { backendRequest } from '$lib/client/live/backend-transport';
import { store } from '$store/renderer/store';
import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
import { workspaceNotesSaga } from '$store/renderer/slices/workspace-notes/sagas/workspace-notes-saga';
import {
  loadWorkspaceNotesSucceeded,
  searchNotesRequested,
} from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import { ContentType, NoteVisibility, type Note } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
import { createNoteQuery, type NoteQueryUpdate } from '$lib/utils/palette-note-search';
import {
  paletteNoteSearchFixture,
  setupPaletteNoteSearchFixture,
} from './command-palette-browser-fixtures';

const workspaceId = 'palette-owner-test';
let stopRoot: () => void;
let previousBridge: Window['electronAPI'];
const stops: Array<() => void> = [];
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const start = (callback = vi.fn()) => {
  const stop = setupPaletteNoteSearchFixture(callback);
  stops.push(stop);
  return { stop, callback };
};
beforeEach(() => {
  vi.useFakeTimers();
  previousBridge = window.electronAPI;
  stopRoot = startRootStoreLifecycle(store, { startSagas: () => [] });
  const notes: Note[] = Array.from({ length: 16 }, (_, index) => ({
    id: NoteId(String(index)),
    workspaceId: WorkspaceId(workspaceId),
    title: `Context ${index}`,
    content: 'Body needle',
    tags: ['tag'],
    contentType: ContentType.Markdown,
    visibility: NoteVisibility.Workspace,
    isPinned: false,
    isArchived: index === 15,
    createdAt: '2026-10-07T00:00:00Z',
    updatedAt: '2026-10-07T00:00:00Z',
  }));
  store.dispatch(loadWorkspaceNotesSucceeded([workspaceId], { [workspaceId]: notes }));
});
afterEach(() => {
  stops
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  stopRoot();
  window.electronAPI = previousBridge;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('returns query-filtered legacy hits within the request limit and settles local fallback', async () => {
  const { callback } = start();
  const result = await backendRequest<{ requestId: string; matches: unknown[]; indexed?: boolean }>(
    'search.notes',
    {
      query: 'needle',
      limit: 10,
      includeArchived: false,
    },
  );
  expect(result.indexed).toBeUndefined();
  expect(result.matches).toHaveLength(10);
  expect(
    await backendRequest('search.notes', { query: 'missing', limit: 10, includeArchived: false }),
  ).toEqual({ requestId: 'palette-fixture:missing', matches: [] });
  const updates: NoteQueryUpdate[] = [];
  const controller = createNoteQuery((value) => updates.push(value));
  controller.query('context', workspaceId, []);
  await vi.runAllTimersAsync();
  expect(callback).toHaveBeenCalledExactlyOnceWith('context');
  expect(updates.at(-1)).toMatchObject({ loading: false, capability: 'legacy', fallback: true });
  controller.query('', workspaceId, []);
  await vi.runAllTimersAsync();
  expect(callback).toHaveBeenCalledTimes(1);
  expect(updates.at(-1)).toMatchObject({ loading: false, items: [] });
  controller.close();
});

it('restores its bridge and cannot release a remounted owner twice', async () => {
  const first = start();
  first.stop();
  expect(window.electronAPI).toBe(previousBridge);
  const second = start();
  const bridge = window.electronAPI;
  first.stop();
  expect(window.electronAPI).toBe(bridge);
  await expect(store.dispatch(searchNotesRequested('missing', workspaceId))).resolves.toEqual({
    requestId: 'palette-fixture:missing',
    matches: [],
  });
  await settle();
  expect(first.callback).not.toHaveBeenCalled();
  expect(second.callback).toHaveBeenCalledExactlyOnceWith('missing');
});

it('owns the element settlement marker until the action is destroyed', async () => {
  const node = document.createElement('div');
  const action = paletteNoteSearchFixture(node);
  stops.push(action.destroy);
  expect(node.dataset.searchSettled).toBeUndefined();
  await store.dispatch(searchNotesRequested('context', workspaceId));
  await settle();
  expect(node.dataset.searchSettled).toBe('context');
  action.destroy();
  start();
  await store.dispatch(searchNotesRequested('missing', workspaceId));
  await settle();
  expect(node.dataset.searchSettled).toBe('context');
  expect(window.electronAPI).not.toBe(previousBridge);
});

it('releases fixture observation without cancelling an existing root search owner', async () => {
  stops.push(store.runSaga(workspaceNotesSaga));
  const fixture = start();
  let resolve!: (value: unknown) => void;
  const pending = new Promise((done) => {
    resolve = done;
  });
  vi.spyOn(window.electronAPI!, 'invoke').mockReturnValueOnce(pending as never);
  const inFlight = store.dispatch(searchNotesRequested('context', workspaceId));
  await settle();
  fixture.stop();
  const next = start();
  resolve({ ok: true, result: { requestId: 'old', matches: [] } });
  await expect(inFlight).resolves.toEqual({ requestId: 'old', matches: [] });
  await settle();
  expect(fixture.callback).not.toHaveBeenCalled();
  expect(next.callback).not.toHaveBeenCalled();
  await store.dispatch(searchNotesRequested('missing', workspaceId));
  await settle();
  expect(next.callback).toHaveBeenCalledExactlyOnceWith('missing');
});
