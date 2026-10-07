import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { store } from '$store/renderer/store';
import { searchNotesRequested } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import { createNoteQuery } from '$lib/utils/palette-note-search';
import { preview } from './command-palette.preview.svelte';

const workspaceId = 'preview-command-palette';
const stops: Array<() => void> = [];

beforeEach(() => stops.push(store.init()));
afterEach(() => {
  while (stops.length) stops.pop()?.();
  vi.restoreAllMocks();
});

function start(state: string) {
  const stop = preview.states[state].setup?.();
  expect(stop).toBeTypeOf('function');
  stops.push(stop as () => void);
}

describe('command palette preview note search', () => {
  it('completes indexed hits and empty queries across disposal and remount', async () => {
    const previousBridge = window.electronAPI;
    for (const state of ['search', 'long-names']) {
      start(state);
      const invoke = vi.spyOn(window.electronAPI, 'invoke');
      const update = vi.fn();
      const query = createNoteQuery(update);
      stops.push(() => query.cancel());
      const term = state === 'search' ? 'keyboard' : 'implementation notes';
      query.query(term, workspaceId, []);

      await vi.waitFor(() =>
        expect(update).toHaveBeenLastCalledWith(
          expect.objectContaining({ loading: false, capability: 'indexed', fallback: false }),
        ),
      );
      expect(invoke).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.BACKEND.REQUEST, {
        method: 'search.notes',
        params: {
          query: term,
          limit: 10,
          includeArchived: false,
          preferWorkspaceId: workspaceId,
        },
      });
      const result = update.mock.lastCall![0];
      expect(result.items).toHaveLength(10);
      expect(result.items[0]).toMatchObject({
        noteId: 'preview-palette-note-0',
        workspaceId,
        isArchived: false,
        isArchivedWorkspace: false,
      });
      query.query('no-matching-context-xyz', undefined, []);
      await vi.waitFor(() =>
        expect(update).toHaveBeenLastCalledWith({
          items: [],
          loading: false,
          capability: 'indexed',
          fallback: false,
        }),
      );
      expect(invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.BACKEND.REQUEST, {
        method: 'search.notes',
        params: { query: 'no-matching-context-xyz', limit: 10, includeArchived: false },
      });
      expect(invoke).toHaveBeenCalledTimes(2);
      stops.pop()?.();
      stops.pop()?.();
      expect(window.electronAPI).toBe(previousBridge);
    }
  });

  it.each(['no-workspace', 'gitlab-off', 'gitlab-on'])(
    'completes empty indexed searches in %s and restores the bridge',
    async (state) => {
      const previousBridge = window.electronAPI;
      start(state);
      const invoke = vi.spyOn(window.electronAPI, 'invoke');
      const search = store.dispatch(searchNotesRequested('context'));
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
      await expect(search).resolves.toMatchObject({ indexed: true, matches: [] });
      stops.pop()?.();
      expect(window.electronAPI).toBe(previousBridge);
    },
  );

  it('cancels pending searches and removes the reader before restoring the bridge', async () => {
    const previousBridge = window.electronAPI;
    const previousInvoke = vi.spyOn(previousBridge, 'invoke');
    start('search');
    const originalInvoke = window.electronAPI.invoke.bind(window.electronAPI);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const invoke = vi.spyOn(window.electronAPI, 'invoke').mockImplementation(async (...args) => {
      const response = await originalInvoke(...args);
      await held;
      return response;
    });
    const settled = vi.fn();
    store.dispatch(searchNotesRequested('context', workspaceId)).then(settled, settled);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    stops.pop()?.();
    expect(window.electronAPI).toBe(previousBridge);
    release();
    await held;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).not.toHaveBeenCalled();

    store.dispatch(searchNotesRequested('keyboard', workspaceId));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(previousInvoke).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledOnce();
  });
});

it('composes the indexed preview and settlement action with one real root owner', async () => {
  const { workspaceNotesSaga } =
    await import('$store/renderer/slices/workspace-notes/sagas/workspace-notes-saga');
  const { paletteNoteSearchFixture } = await import('./command-palette-browser-fixtures');
  stops.push(store.runSaga(workspaceNotesSaga));
  start('search');
  const node = document.createElement('div');
  const action = paletteNoteSearchFixture(node);
  stops.push(action.destroy);
  const invoke = vi.spyOn(window.electronAPI, 'invoke');
  const result = await store.dispatch(searchNotesRequested('context', workspaceId));
  expect(invoke).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.BACKEND.REQUEST, {
    method: 'search.notes',
    params: { query: 'context', limit: 10, includeArchived: false, preferWorkspaceId: workspaceId },
  });
  expect(result).toMatchObject({ indexed: true });
  expect(result.matches).toHaveLength(10);
  await vi.waitFor(() => expect(node.dataset.searchSettled).toBe('context'));
});

it('retires old settlement listeners without cancelling the root or a remounted indexed fixture', async () => {
  const { workspaceNotesSaga } =
    await import('$store/renderer/slices/workspace-notes/sagas/workspace-notes-saga');
  const { paletteNoteSearchFixture } = await import('./command-palette-browser-fixtures');
  stops.push(store.runSaga(workspaceNotesSaga));
  const mount = () => {
    const stop = preview.states.search.setup!() as () => void;
    const node = document.createElement('div');
    const action = paletteNoteSearchFixture(node);
    const destroy = () => {
      action.destroy();
      stop();
    };
    stops.push(destroy);
    return { node, destroy };
  };
  const before = window.electronAPI;
  const old = mount();
  const oldBridge = window.electronAPI;
  const originalInvoke = oldBridge.invoke.bind(oldBridge);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const oldInvoke = vi.spyOn(oldBridge, 'invoke').mockImplementation(async (...args) => {
    const result = await originalInvoke(...args);
    await pending;
    return result;
  });
  const inFlight = store.dispatch(searchNotesRequested('context', workspaceId));
  await vi.waitFor(() => expect(oldInvoke).toHaveBeenCalledTimes(1));
  old.destroy();
  const fresh = mount();
  const freshBridge = window.electronAPI;
  old.destroy();
  expect(window.electronAPI).toBe(freshBridge);
  release();
  await expect(inFlight).resolves.toMatchObject({ indexed: true });
  expect(old.node.dataset.searchSettled).toBeUndefined();
  expect(fresh.node.dataset.searchSettled).toBeUndefined();
  const invoke = vi.spyOn(freshBridge, 'invoke');
  await store.dispatch(searchNotesRequested('keyboard', workspaceId));
  await vi.waitFor(() => expect(fresh.node.dataset.searchSettled).toBe('keyboard'));
  expect(invoke).toHaveBeenCalledTimes(1);
  fresh.destroy();
  window.electronAPI = freshBridge;
  await store.dispatch(searchNotesRequested('context', workspaceId));
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(fresh.node.dataset.searchSettled).toBe('keyboard');
  window.electronAPI = before;
});

it('does not restore a bridge installed by another owner', () => {
  const previousBridge = window.electronAPI;
  const stop = preview.states.search.setup!() as () => void;
  stops.push(stop);
  const otherBridge = { ...window.electronAPI };
  window.electronAPI = otherBridge;
  stop();
  expect(window.electronAPI).toBe(otherBridge);
  window.electronAPI = previousBridge;
});

it('isolates indexed preview hits from local note browsing without changing the default fixture', async () => {
  const { selectAllNotes } =
    await import('$store/renderer/slices/workspace-notes/workspace-notes-selectors');
  start('indexed-context-search');
  expect(selectAllNotes.select(store.state, workspaceId)).toEqual([]);
  const result = await store.dispatch(searchNotesRequested('context', workspaceId));
  expect(result).toMatchObject({ indexed: true });
  expect(result.matches).toHaveLength(10);
  expect(result.matches[0]).toMatchObject({ noteId: 'preview-palette-note-0', workspaceId });
  stops.pop()?.();
  start('context-search');
  expect(selectAllNotes.select(store.state, workspaceId)).toHaveLength(16);
});
