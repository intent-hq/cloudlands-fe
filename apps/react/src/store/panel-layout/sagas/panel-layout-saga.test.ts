import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { store } from '@/store';
import { createReactPanelLayoutSagas } from './panel-layout-saga';
import { selectPanelLayoutWorkspace } from '../panel-layout-selectors';
import { createAdmittedLegacyPrincipal } from '../../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  closeTab,
  focusPanel,
  openTab,
  panelLayoutReducer,
  panelLayoutScopeMounted,
  panelLayoutScopeUnmounted,
  reopenClosedTab,
  resizePanelLayoutRightEdge,
  splitPanel,
  updateTabTitle,
} from '../../../../../../src/store/renderer/slices/panel-layout/panel-layout-slice';
import type { WorkspacePanelLayout } from '../../../../../../src/store/renderer/slices/panel-layout/panel-layout-types';
import { connectionsListReceived } from '../../../../../../src/store/renderer/slices/connections/connections-slice';
import { workspaceUnmounted } from '../../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';

// The target must load its canonical owners without constructing a Svelte Store.
vi.mock('../../../../../../src/store/renderer/store', () => {
  throw new Error('React panel lifecycle imported the Svelte Store');
});

const ws = 'retained-workspace';
const key = `panel-layout-${ws}`;
const saved: WorkspacePanelLayout = {
  version: 2,
  root: { type: 'panel', panelId: 'original' },
  panels: {
    original: {
      id: 'original',
      tabs: [{ id: 'note-tab', type: 'note', title: 'Saved', noteId: 'note', closable: true }],
      activeTabId: 'note-tab',
    },
  },
  focusedPanelId: 'original',
  columnCount: 1,
  canvasWidth: null,
  canvasWidthSource: null,
};
let dispose: () => void;
const stops: Array<() => void> = [];
const cleanup = vi.fn();

function start() {
  const owners = createReactPanelLayoutSagas({ clearPanelLayoutAdapter: cleanup });
  stops.push(store.runSaga(owners.panelLayoutSaga));
  return owners;
}

function layout() {
  return selectPanelLayoutWorkspace.select(store.state, ws);
}

beforeEach(() => {
  vi.useFakeTimers();
  const storage = new Map<string, string>();
  vi.mocked(localStorage.getItem).mockImplementation((key) => storage.get(key) ?? null);
  vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
    storage.set(key, value);
  });
  vi.mocked(localStorage.removeItem).mockImplementation((key) => {
    storage.delete(key);
  });
  vi.mocked(localStorage.clear).mockImplementation(() => storage.clear());
  cleanup.mockReset();
  dispose = store.init(createAdmittedLegacyPrincipal());
  vi.mocked(window.electronAPI.invoke).mockReset().mockResolvedValue(null);
});

afterEach(() => {
  for (const stop of stops.splice(0).reverse()) stop();
  dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('React binding of the canonical panel lifecycle', () => {
  it.each([
    [undefined, 'empty'],
    [{ version: 2, root: {} }, 'invalid'],
  ])('reports the actual restore result for %j', (stored, status) => {
    if (stored) localStorage.setItem(key, JSON.stringify(stored));
    start();
    store.dispatch(panelLayoutScopeMounted(ws));
    expect(layout().restoreStatus).toBe(status);
    expect(Object.values(layout().panels).flatMap((panel) => panel.tabs)).toEqual([]);
  });

  it('persists split, resize, focus, close and reopen through the shared owner and reloads them', async () => {
    localStorage.setItem(key, JSON.stringify(saved));
    start();
    store.dispatch(panelLayoutScopeMounted(ws));
    expect(layout().restoreStatus).toBe('restored');
    await vi.advanceTimersByTimeAsync(0);

    const split = splitPanel(ws, 'original', 'horizontal');
    store.dispatch(split);
    const right = split.payload.newPanelId;
    store.dispatch(
      openTab(
        ws,
        { type: 'note', title: 'Second', noteId: 'second', closable: true },
        right,
        'second-tab',
      ),
    );
    store.dispatch(focusPanel(ws, right));
    store.dispatch(resizePanelLayoutRightEdge(ws, 800, 1000, 1000));
    store.dispatch(closeTab(ws, 'note-tab', 'original', undefined, { preservePanel: true }));
    expect(layout().panels.original.tabs).toEqual([]);
    store.dispatch(reopenClosedTab(ws));
    expect(
      Object.values(layout().panels).flatMap((panel) => panel.tabs.map((tab) => tab.noteId)),
    ).toEqual(['note', 'second']);
    const persisted = JSON.parse(localStorage.getItem(key)!);
    expect(persisted.root.type).toBe('split');
    expect(persisted.canvasWidth).toBe(1000);

    for (const stop of stops.splice(0)) stop();
    dispose();
    dispose = store.init(createAdmittedLegacyPrincipal());
    start();
    store.dispatch(panelLayoutScopeMounted(ws));
    expect(layout()).toMatchObject({
      restoreStatus: 'restored',
      root: persisted.root,
      panels: persisted.panels,
      focusedPanelId: persisted.focusedPanelId,
      canvasWidth: 1000,
    });
  });

  it('keeps parked layouts live but performs a fresh restore after closing the workspace', () => {
    localStorage.setItem(key, JSON.stringify(saved));
    start();
    store.dispatch(panelLayoutScopeMounted(ws));
    const read = vi.mocked(localStorage.getItem);
    store.dispatch(panelLayoutScopeUnmounted(ws));
    store.dispatch(updateTabTitle(ws, 'note-tab', 'Changed while parked'));
    expect(JSON.parse(localStorage.getItem(key)!).panels.original.tabs[0].title).toBe(
      'Changed while parked',
    );
    read.mockClear();
    store.dispatch(panelLayoutScopeMounted(ws));
    expect(read).not.toHaveBeenCalledWith(key);
    expect(layout().panels.original.tabs[0].title).toBe('Changed while parked');
    expect(cleanup).toHaveBeenCalledWith(ws);

    store.dispatch(workspaceUnmounted(ws));
    localStorage.setItem(key, JSON.stringify(saved));
    store.dispatch(panelLayoutScopeMounted(ws));
    expect(read).toHaveBeenCalledWith(key);
    expect(layout().panels.original.tabs[0].title).toBe('Saved');
  });

  it('restores each mounted workspace under the incoming backend and leaves outgoing storage intact', () => {
    localStorage.setItem(key, JSON.stringify(saved));
    localStorage.setItem('panel-layout-other-workspace', JSON.stringify(saved));
    start();
    store.dispatch(panelLayoutScopeMounted(ws));
    store.dispatch(panelLayoutScopeMounted('other-workspace'));
    store.dispatch(
      connectionsListReceived({ connections: [], activeId: 'remote', windowBackendId: 'remote' }),
    );
    expect(layout().restoreStatus).toBe('empty');
    expect(selectPanelLayoutWorkspace.select(store.state, 'other-workspace').restoreStatus).toBe(
      'empty',
    );
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(saved);
    store.dispatch(
      openTab(
        ws,
        { type: 'note', title: 'Remote', noteId: 'remote-note', closable: true },
        undefined,
        'remote-tab',
      ),
    );
    expect(localStorage.getItem(`backend:remote:${key}`)).toContain('remote-note');
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(saved);
  });

  it('loads history through the existing IPC contract and flushes pending history on cancellation', async () => {
    const history = [{ ...saved, timestamp: 17 }];
    vi.mocked(window.electronAPI.invoke).mockImplementation(async (channel) =>
      channel === 'panel-layout:load'
        ? {
            version: 1,
            workspaceId: ws,
            history,
            historyIndex: 0,
            lastUpdated: '2026-10-15T00:00:00.000Z',
          }
        : true,
    );
    localStorage.setItem(key, JSON.stringify(saved));
    start();
    store.dispatch(panelLayoutScopeMounted(ws));
    await vi.advanceTimersByTimeAsync(0);
    expect(window.electronAPI.invoke).toHaveBeenCalledWith('panel-layout:load', {
      workspaceId: ws,
      backendId: 'local',
    });
    expect(layout().layoutHistory).toMatchObject(history);
    store.dispatch(
      openTab(
        ws,
        { type: 'note', title: 'New', noteId: 'new', closable: true },
        'original',
        'new-tab',
      ),
    );
    for (const stop of stops.splice(0)) stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(window.electronAPI.invoke).toHaveBeenCalledWith('panel-layout:save', {
      workspaceId: ws,
      backendId: 'local',
      data: {
        version: 1,
        workspaceId: ws,
        history: layout().layoutHistory,
        historyIndex: layout().historyIndex,
        lastUpdated: expect.any(String),
      },
    });
    const writes = vi.mocked(localStorage.setItem).mockClear();
    store.dispatch(updateTabTitle(ws, 'new-tab', 'After stop'));
    expect(writes).not.toHaveBeenCalled();
  });

  it('isolates restore membership between simultaneous renderer owners', async () => {
    localStorage.setItem(key, JSON.stringify(saved));
    const initial = store.state;
    const createOwner = () => {
      let state = initial;
      const channel = stdChannel();
      const owner = createReactPanelLayoutSagas({ clearPanelLayoutAdapter: vi.fn() });
      const task = runSaga(
        {
          channel,
          getState: () => state,
          dispatch: (action: Parameters<typeof panelLayoutReducer>[1]) => {
            state = { ...state, panelLayout: panelLayoutReducer(state.panelLayout, action) };
            channel.put(action);
          },
        },
        owner.hydrateWorkspaceLayout,
        ws,
      );
      return { task, getState: () => state };
    };
    const first = createOwner();
    await first.task.toPromise();
    const second = createOwner();
    await second.task.toPromise();
    expect(selectPanelLayoutWorkspace.select(first.getState(), ws).restoreStatus).toBe('restored');
    expect(selectPanelLayoutWorkspace.select(second.getState(), ws).restoreStatus).toBe('restored');
  });
});
