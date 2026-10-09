import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { store } from '$store/renderer/store';
import { searchNotesRequested } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import {
  paletteNoteSearchReleased,
  paletteNoteSearchRequested,
} from '$store/renderer/slices/palette/palette-slice';
import { selectPaletteNoteSearch } from '$store/renderer/slices/palette/palette-selectors';
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
      const consumerId = `preview-${state}`;
      stops.push(() => store.dispatch(paletteNoteSearchReleased(consumerId)));
      const term = state === 'search' ? 'keyboard' : 'implementation notes';
      store.dispatch(paletteNoteSearchRequested(consumerId, `request-${state}`, term, workspaceId));

      await vi.waitFor(() =>
        expect(selectPaletteNoteSearch.select(store.state, consumerId)).toMatchObject({
          loading: false,
          capability: 'indexed',
          fallback: false,
        }),
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
      const result = selectPaletteNoteSearch.select(store.state, consumerId);
      expect(result.items).toHaveLength(10);
      expect(result.items[0]).toMatchObject({
        noteId: 'preview-palette-note-0',
        workspaceId,
        isArchived: false,
        isArchivedWorkspace: false,
      });
      store.dispatch(
        paletteNoteSearchRequested(consumerId, `empty-request-${state}`, 'no-matching-context-xyz'),
      );
      await vi.waitFor(() =>
        expect(selectPaletteNoteSearch.select(store.state, consumerId)).toMatchObject({
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

  it('settles and releases a held palette query before restoring the preview bridge', async () => {
    const previousBridge = window.electronAPI;
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
    const action = paletteNoteSearchRequested(
      'preview-held',
      'preview-held-request',
      'context',
      workspaceId,
    );
    store.dispatch(action);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    stops.pop()?.();
    await expect(action.promise).resolves.toMatchObject({ capability: 'unknown', items: [] });
    expect(selectPaletteNoteSearch.select(store.state, 'preview-held')).toMatchObject({
      requestId: 'preview-held-request',
      loading: false,
      capability: 'unknown',
    });
    expect(window.electronAPI).toBe(previousBridge);

    store.dispatch(paletteNoteSearchReleased('preview-held'));
    release();
    await held;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.state.palette.noteSearches.ids).not.toContain('preview-held');
  });
});

it('preserves a replacement bridge when the palette preview stops', () => {
  const previousBridge = window.electronAPI;
  start('search');
  const replacementBridge = { ...previousBridge };
  window.electronAPI = replacementBridge;
  try {
    stops.pop()?.();
    expect(window.electronAPI).toBe(replacementBridge);
  } finally {
    window.electronAPI = previousBridge;
  }
});
