import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearAdapter: vi.fn(),
  getJSON: vi.fn(),
  loadHistory: vi.fn(),
  removeItem: vi.fn(),
  saveHistory: vi.fn(),
  setJSON: vi.fn(),
}));

vi.mock('$features/layout/panel-layout-adapter', () => ({
  clearPanelLayoutAdapter: mocks.clearAdapter,
}));
vi.mock('$features/layout/panel-layout-history.client', () => ({
  loadPanelLayoutHistory: mocks.loadHistory,
  savePanelLayoutHistory: mocks.saveHistory,
}));
vi.mock('../../../utils/safe-local-storage-saga', () => ({
  getLocalStorageJSON: function* (key: string) {
    return mocks.getJSON(key);
  },
  removeLocalStorageItem: function* (key: string) {
    mocks.removeItem(key);
  },
  setLocalStorageJSON: function* (key: string, value: unknown) {
    mocks.setJSON(key, value);
  },
}));

import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import { connectionsListReceived } from '../../connections/connections-slice';
import {
  workspaceMounted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  clearPanelLayout,
  closeActiveTab,
  closeAllOthersEverywhere,
  closeAllTabs,
  closeOtherTabs,
  closePanel,
  closeTab,
  closeTabsByAgentId,
  closeTabsByType,
  closeTabsToRight,
  consumePendingFocus,
  emptyWorkspaceState,
  focusPanel,
  goBack,
  goBackInFocusHistory,
  goForward,
  goForwardInFocusHistory,
  initializeLayout,
  loadLayoutHistory,
  movePanel,
  movePanelToRootEdge,
  moveTabToPanel,
  moveTabToSplit,
  moveTabToSplitLevel,
  openTab,
  openTabInAdjacentOrSplit,
  panelLayoutScopeMounted,
  panelLayoutScopeUnmounted,
  reconcileStaleAgentTabs,
  reorderTabs,
  reopenClosedTab,
  resetLayout,
  resizePanelLayoutRightEdge,
  selectNextTab,
  selectPreviousTab,
  setActiveTab,
  setDeferSpecTab,
  setRestoreStatus,
  splitPanel,
  toggleExpandPanel,
  updateFileTabPath,
  updateSizes,
  updateSplitSizes,
  updateTabBrowserUrl,
  updateTabFavicon,
  updateTabTitle,
} from '../panel-layout-slice';
import {
  HISTORY_PERSIST_DEBOUNCE_MS,
  PANEL_LAYOUT_STORAGE_KEY_PREFIX,
  type LayoutSnapshot,
  type WorkspacePanelLayout,
} from '../panel-layout-types';
import { isStoredLayoutValid, panelLayoutSaga } from './panel-layout-saga';

const WS_1 = 'ws-1';
const WS_2 = 'ws-2';
const REMOTE_ID = 'remote-1';
const STORAGE_KEY_1 = `${PANEL_LAYOUT_STORAGE_KEY_PREFIX}${WS_1}`;
const REMOTE_STORAGE_KEY_1 = `backend:${REMOTE_ID}:${STORAGE_KEY_1}`;
const NOW = new Date('2026-07-31T00:00:00.000Z');

const tab = { id: 'tab-1', type: 'note' as const, title: 'Note', closable: true, noteId: 'note-1' };
const layout: WorkspacePanelLayout = {
  root: { type: 'panel', panelId: 'panel-1' },
  panels: { 'panel-1': { id: 'panel-1', tabs: [tab], activeTabId: tab.id } },
  focusedPanelId: 'panel-1',
  canvasWidth: null,
};
const snapshot: LayoutSnapshot = { ...layout, timestamp: 10 };

function workspaceState(history: LayoutSnapshot[] = [snapshot]) {
  return {
    ...emptyWorkspaceState,
    ...layout,
    layoutHistory: history,
    historyIndex: history.length - 1,
  };
}

function storeState(
  activeWorkspaceId: string | null = null,
  activeBackendId: string = LOCAL_CONNECTION_ID,
) {
  return {
    panelLayout: {
      byWorkspaceId: {
        [WS_1]: workspaceState(),
        [WS_2]: workspaceState([{ ...snapshot, timestamp: 20 }]),
      },
    },
    workspace: { activeWorkspaceId },
    connections: { activeId: activeBackendId },
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function startSaga(state = storeState()) {
  const channel = stdChannel();
  const dispatch = vi.fn();
  const task = runSaga({ channel, dispatch, getState: () => state }, panelLayoutSaga);
  return { channel, dispatch, task };
}

async function cancelSaga(task: ReturnType<typeof runSaga>) {
  task.cancel();
  await task.toPromise();
}

const persistActionCreators = [
  initializeLayout,
  openTab,
  openTabInAdjacentOrSplit,
  closeTab,
  closeActiveTab,
  closeTabsByType,
  closeTabsByAgentId,
  reopenClosedTab,
  setActiveTab,
  selectNextTab,
  selectPreviousTab,
  reorderTabs,
  moveTabToPanel,
  moveTabToSplit,
  moveTabToSplitLevel,
  closeOtherTabs,
  closeTabsToRight,
  closeAllTabs,
  closeAllOthersEverywhere,
  focusPanel,
  splitPanel,
  closePanel,
  movePanel,
  movePanelToRootEdge,
  updateSizes,
  updateSplitSizes,
  resizePanelLayoutRightEdge,
  toggleExpandPanel,
  resetLayout,
  goBack,
  goForward,
  goBackInFocusHistory,
  goForwardInFocusHistory,
  setDeferSpecTab,
  reconcileStaleAgentTabs,
  updateTabTitle,
  updateTabBrowserUrl,
  updateTabFavicon,
  updateFileTabPath,
  consumePendingFocus,
];

describe('panelLayoutSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.loadHistory.mockResolvedValue(null);
    mocks.saveHistory.mockResolvedValue(true);
  });

  afterEach(() => vi.useRealTimers());

  it('validates stored tree references, focus, tabs, and active tab ids', () => {
    expect(isStoredLayoutValid(layout)).toBe(true);
    expect(isStoredLayoutValid({ ...layout, canvasWidth: 1080 })).toBe(true);
    expect(isStoredLayoutValid({ ...layout, canvasWidth: 0 })).toBe(false);
    expect(isStoredLayoutValid({ ...layout, canvasWidth: Number.NaN })).toBe(false);
    expect(isStoredLayoutValid(null)).toBe(false);
    expect(isStoredLayoutValid({ ...layout, root: { type: 'panel', panelId: 'missing' } })).toBe(
      false,
    );
    expect(isStoredLayoutValid({ ...layout, focusedPanelId: 'missing' })).toBe(false);
    expect(
      isStoredLayoutValid({
        ...layout,
        panels: { 'panel-1': { ...layout.panels['panel-1'], tabs: [null] } },
      }),
    ).toBe(false);
    expect(
      isStoredLayoutValid({
        ...layout,
        panels: { 'panel-1': { ...layout.panels['panel-1'], activeTabId: 'missing' } },
      }),
    ).toBe(false);
    expect(
      isStoredLayoutValid({
        ...layout,
        root: { type: 'split', direction: 'horizontal', children: [layout.root], sizes: [] },
      }),
    ).toBe(false);
  });

  it('retroactively restores the active workspace with exact status transitions', async () => {
    mocks.getJSON.mockReturnValue(layout);
    const { dispatch, task } = startSaga(storeState(WS_1));
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      setRestoreStatus(WS_1, 'pending'),
      initializeLayout(WS_1, layout),
      setRestoreStatus(WS_1, 'restored'),
    ]);
    await cancelSaga(task);
  });

  it('removes foreign workspace panels while restoring persisted layout state', async () => {
    const foreignTab = { ...tab, id: 'foreign-tab', workspaceId: WS_2 };
    const contaminatedLayout: WorkspacePanelLayout = {
      root: {
        type: 'split',
        direction: 'horizontal',
        children: [layout.root, { type: 'panel', panelId: 'foreign-panel' }],
        sizes: [50, 50],
      },
      panels: {
        ...layout.panels,
        'foreign-panel': {
          id: 'foreign-panel',
          tabs: [foreignTab],
          activeTabId: foreignTab.id,
        },
      },
      focusedPanelId: 'foreign-panel',
    };
    mocks.getJSON.mockReturnValue(contaminatedLayout);
    const { dispatch, task } = startSaga(storeState(WS_1));
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      setRestoreStatus(WS_1, 'pending'),
      initializeLayout(WS_1, layout),
      setRestoreStatus(WS_1, 'restored'),
    ]);
    await cancelSaga(task);
  });

  it('marks missing and malformed mount storage exactly and skips invalid workspace ids', async () => {
    mocks.getJSON.mockImplementation((key: string) =>
      key.endsWith(WS_1) ? undefined : { bad: true },
    );
    const { channel, dispatch, task } = startSaga();
    await settle();
    channel.put(workspaceMounted(WS_1));
    channel.put(workspaceMounted(WS_2));
    channel.put(workspaceMounted('optimistic-new'));
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      setRestoreStatus(WS_1, 'pending'),
      setRestoreStatus(WS_1, 'empty'),
      setRestoreStatus(WS_2, 'pending'),
      setRestoreStatus(WS_2, 'invalid'),
    ]);
    await cancelSaga(task);
  });

  it('restores and cleans up a rendered canonical panel-layout scope', async () => {
    mocks.getJSON.mockReturnValue(layout);
    const { channel, dispatch, task } = startSaga();
    await settle();
    channel.put(panelLayoutScopeMounted(WS_1));
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      setRestoreStatus(WS_1, 'pending'),
      initializeLayout(WS_1, layout),
      setRestoreStatus(WS_1, 'restored'),
    ]);

    channel.put(panelLayoutScopeUnmounted(WS_1));
    await settle();
    expect(mocks.clearAdapter).toHaveBeenCalledWith(WS_1);
    await cancelSaga(task);
  });

  it.each(persistActionCreators)(
    'persists the exact post-reducer layout for $type',
    async (creator) => {
      mocks.getJSON.mockReturnValue(undefined);
      const { channel, task } = startSaga();
      await settle();
      channel.put({ type: creator.type, payload: { wsId: WS_1 } });
      await settle();

      expect(mocks.setJSON.mock.calls).toEqual([[STORAGE_KEY_1, layout]]);
      await cancelSaga(task);
    },
  );

  it('protects a non-empty stored layout from a pre-restore empty-state write', async () => {
    mocks.getJSON.mockReturnValue(layout);
    const state = storeState();
    state.panelLayout.byWorkspaceId[WS_1] = { ...emptyWorkspaceState };
    const { channel, task } = startSaga(state);
    await settle();
    channel.put({ type: focusPanel.type, payload: [WS_1, 'default'] });
    await settle();

    expect(mocks.setJSON.mock.calls).toEqual([]);
    await cancelSaga(task);
  });

  it('survives a local-storage failure and processes the next mutation', async () => {
    mocks.getJSON.mockReturnValue(undefined);
    mocks.setJSON.mockImplementationOnce(() => {
      throw new Error('quota');
    });
    const { channel, task } = startSaga();
    await settle();
    channel.put({ type: focusPanel.type, payload: [WS_1, 'panel-1'] });
    channel.put({ type: focusPanel.type, payload: [WS_2, 'panel-1'] });
    await settle();

    expect(mocks.setJSON.mock.calls).toEqual([
      [STORAGE_KEY_1, layout],
      [`${PANEL_LAYOUT_STORAGE_KEY_PREFIX}${WS_2}`, layout],
    ]);
    await cancelSaga(task);
  });

  it('debounces history independently across workspaces', async () => {
    const { channel, task } = startSaga();
    await settle();
    channel.put({ type: openTab.type, payload: { wsId: WS_1 } });
    channel.put({ type: closeTab.type, payload: { wsId: WS_1 } });
    channel.put({ type: openTab.type, payload: { wsId: WS_2 } });
    await settle();
    await vi.advanceTimersByTimeAsync(HISTORY_PERSIST_DEBOUNCE_MS);
    await vi.runAllTimersAsync();
    await settle();
    const persistedAt = new Date(NOW.getTime() + HISTORY_PERSIST_DEBOUNCE_MS).toISOString();

    expect(mocks.saveHistory.mock.calls).toEqual([
      [
        WS_1,
        {
          version: 1,
          workspaceId: WS_1,
          history: [snapshot],
          historyIndex: 0,
          lastUpdated: persistedAt,
        },
        LOCAL_CONNECTION_ID,
      ],
      [
        WS_2,
        {
          version: 1,
          workspaceId: WS_2,
          history: [{ ...snapshot, timestamp: 20 }],
          historyIndex: 0,
          lastUpdated: persistedAt,
        },
        LOCAL_CONNECTION_ID,
      ],
    ]);
    await cancelSaga(task);
  });

  it('coalesces repeated same-key history updates and reads the latest state', async () => {
    const state = storeState();
    const { channel, task } = startSaga(state);
    await settle();
    channel.put({ type: openTab.type, payload: { wsId: WS_1 } });
    await settle();
    state.panelLayout.byWorkspaceId[WS_1] = workspaceState([{ ...snapshot, timestamp: 30 }]);
    channel.put({ type: closeTab.type, payload: { wsId: WS_1 } });
    await settle();
    await vi.advanceTimersByTimeAsync(HISTORY_PERSIST_DEBOUNCE_MS);
    await settle();

    expect(mocks.saveHistory.mock.calls).toEqual([
      [
        WS_1,
        {
          version: 1,
          workspaceId: WS_1,
          history: [{ ...snapshot, timestamp: 30 }],
          historyIndex: 0,
          lastUpdated: new Date(NOW.getTime() + HISTORY_PERSIST_DEBOUNCE_MS).toISOString(),
        },
        LOCAL_CONNECTION_ID,
      ],
    ]);
    await cancelSaga(task);
  });

  it('loads valid history after initialization and ignores malformed history', async () => {
    mocks.loadHistory
      .mockResolvedValueOnce({
        version: 1,
        workspaceId: WS_1,
        history: [snapshot],
        historyIndex: 0,
        lastUpdated: NOW.toISOString(),
      })
      .mockResolvedValueOnce({ history: 'bad', historyIndex: 0 });
    const { channel, dispatch, task } = startSaga();
    await settle();
    channel.put(initializeLayout(WS_1, layout));
    await settle();
    channel.put(initializeLayout(WS_2, layout));
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      loadLayoutHistory(WS_1, [snapshot], 0),
    ]);
    await cancelSaga(task);
  });

  it('removes foreign workspace panels from loaded layout history', async () => {
    const foreignTab = { ...tab, id: 'foreign-tab', workspaceId: WS_2 };
    const contaminatedSnapshot: LayoutSnapshot = {
      root: {
        type: 'split',
        direction: 'horizontal',
        children: [layout.root, { type: 'panel', panelId: 'foreign-panel' }],
        sizes: [50, 50],
      },
      panels: {
        ...layout.panels,
        'foreign-panel': {
          id: 'foreign-panel',
          tabs: [foreignTab],
          activeTabId: foreignTab.id,
        },
      },
      focusedPanelId: 'foreign-panel',
      timestamp: 20,
    };
    mocks.loadHistory.mockResolvedValue({
      version: 1,
      workspaceId: WS_1,
      history: [contaminatedSnapshot],
      historyIndex: 0,
      lastUpdated: NOW.toISOString(),
    });
    const { channel, dispatch, task } = startSaga();
    await settle();
    channel.put(initializeLayout(WS_1, layout));
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      loadLayoutHistory(WS_1, [{ ...layout, timestamp: 20 }], 0),
    ]);
    await cancelSaga(task);
  });

  it('ignores an empty workspace id when clearing persisted layout', async () => {
    const { channel, task } = startSaga();
    await settle();
    channel.put(clearPanelLayout(''));
    await settle();

    expect(mocks.removeItem.mock.calls).toEqual([]);
    await cancelSaga(task);
  });

  it('survives rejected history loads, history saves, and adapter cleanup', async () => {
    const historyData = {
      version: 1,
      workspaceId: WS_2,
      history: [{ ...snapshot, timestamp: 20 }],
      historyIndex: 0,
      lastUpdated: NOW.toISOString(),
    };
    mocks.loadHistory
      .mockRejectedValueOnce(new Error('history load failed'))
      .mockResolvedValueOnce(historyData);
    mocks.saveHistory
      .mockRejectedValueOnce(new Error('history save failed'))
      .mockResolvedValueOnce(true);
    mocks.clearAdapter
      .mockRejectedValueOnce(new Error('adapter cleanup failed'))
      .mockResolvedValueOnce(undefined);
    const { channel, dispatch, task } = startSaga();
    await settle();

    channel.put(initializeLayout(WS_1, layout));
    await settle();
    channel.put(initializeLayout(WS_2, layout));
    await settle();
    channel.put({ type: openTab.type, payload: { wsId: WS_1 } });
    await settle();
    await vi.advanceTimersByTimeAsync(HISTORY_PERSIST_DEBOUNCE_MS);
    channel.put({ type: openTab.type, payload: { wsId: WS_2 } });
    await settle();
    await vi.advanceTimersByTimeAsync(HISTORY_PERSIST_DEBOUNCE_MS);
    channel.put(workspaceUnmounted(WS_1));
    await settle();
    channel.put(workspaceUnmounted(WS_2));
    await settle();

    expect(mocks.loadHistory.mock.calls).toEqual([
      [WS_1, LOCAL_CONNECTION_ID],
      [WS_2, LOCAL_CONNECTION_ID],
    ]);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      loadLayoutHistory(WS_2, historyData.history, historyData.historyIndex),
    ]);
    expect(mocks.saveHistory.mock.calls).toEqual([
      [
        WS_1,
        {
          version: 1,
          workspaceId: WS_1,
          history: [snapshot],
          historyIndex: 0,
          lastUpdated: new Date(NOW.getTime() + HISTORY_PERSIST_DEBOUNCE_MS).toISOString(),
        },
        LOCAL_CONNECTION_ID,
      ],
      [
        WS_2,
        {
          version: 1,
          workspaceId: WS_2,
          history: historyData.history,
          historyIndex: 0,
          lastUpdated: new Date(NOW.getTime() + HISTORY_PERSIST_DEBOUNCE_MS * 2).toISOString(),
        },
        LOCAL_CONNECTION_ID,
      ],
    ]);
    expect(mocks.clearAdapter.mock.calls).toEqual([[WS_1], [WS_2]]);
    expect(task.isRunning()).toBe(true);
    await cancelSaga(task);
  });

  it('clears persisted state and cancels only matching history on panel scope teardown', async () => {
    const { channel, task } = startSaga();
    await settle();
    channel.put(clearPanelLayout(WS_1));
    channel.put({ type: openTab.type, payload: { wsId: WS_1 } });
    channel.put({ type: openTab.type, payload: { wsId: WS_2 } });
    channel.put(panelLayoutScopeUnmounted(WS_1));
    await settle();
    await vi.advanceTimersByTimeAsync(HISTORY_PERSIST_DEBOUNCE_MS);

    expect(mocks.removeItem.mock.calls).toEqual([[STORAGE_KEY_1]]);
    expect(mocks.clearAdapter.mock.calls).toEqual([[WS_1]]);
    expect(mocks.saveHistory.mock.calls).toEqual([
      [
        WS_2,
        {
          version: 1,
          workspaceId: WS_2,
          history: [{ ...snapshot, timestamp: 20 }],
          historyIndex: 0,
          lastUpdated: new Date(NOW.getTime() + HISTORY_PERSIST_DEBOUNCE_MS).toISOString(),
        },
        LOCAL_CONNECTION_ID,
      ],
    ]);
    await cancelSaga(task);
  });

  it('flushes every pending workspace history with its captured backend when cancelled', async () => {
    const { channel, task } = startSaga();
    await settle();
    channel.put({ type: openTab.type, payload: { wsId: WS_1 } });
    channel.put({ type: openTab.type, payload: { wsId: WS_2 } });
    await settle();
    await cancelSaga(task);

    expect(task.isCancelled()).toBe(true);
    expect(mocks.saveHistory.mock.calls).toEqual([
      [
        WS_1,
        {
          version: 1,
          workspaceId: WS_1,
          history: [snapshot],
          historyIndex: 0,
          lastUpdated: NOW.toISOString(),
        },
        LOCAL_CONNECTION_ID,
      ],
      [
        WS_2,
        {
          version: 1,
          workspaceId: WS_2,
          history: [{ ...snapshot, timestamp: 20 }],
          historyIndex: 0,
          lastUpdated: NOW.toISOString(),
        },
        LOCAL_CONNECTION_ID,
      ],
    ]);
  });

  describe('multi-backend namespacing', () => {
    it('keeps the bare legacy key for the local backend', async () => {
      mocks.getJSON.mockReturnValue(undefined);
      const { channel, task } = startSaga(storeState(null, LOCAL_CONNECTION_ID));
      await settle();
      channel.put({ type: openTab.type, payload: { wsId: WS_1 } });
      await settle();

      expect(mocks.setJSON.mock.calls).toEqual([[STORAGE_KEY_1, layout]]);
      await cancelSaga(task);
    });

    it('namespaces layout reads, writes, clears, and history by remote backend id', async () => {
      mocks.getJSON.mockReturnValue(undefined);
      const { channel, task } = startSaga(storeState(null, REMOTE_ID));
      await settle();
      channel.put(workspaceMounted(WS_1));
      channel.put({ type: openTab.type, payload: { wsId: WS_1 } });
      channel.put(clearPanelLayout(WS_1));
      await settle();
      await vi.advanceTimersByTimeAsync(HISTORY_PERSIST_DEBOUNCE_MS);

      expect(mocks.getJSON.mock.calls).toEqual([[REMOTE_STORAGE_KEY_1]]);
      expect(mocks.setJSON.mock.calls).toEqual([[REMOTE_STORAGE_KEY_1, layout]]);
      expect(mocks.removeItem.mock.calls).toEqual([[REMOTE_STORAGE_KEY_1]]);
      expect(mocks.saveHistory.mock.calls.map(([wsId, , backendId]) => [wsId, backendId])).toEqual([
        [WS_1, REMOTE_ID],
      ]);
      await cancelSaga(task);
    });

    it('re-restores the active workspace from the incoming backend namespace on switch', async () => {
      mocks.getJSON.mockImplementation((key: string) =>
        key === REMOTE_STORAGE_KEY_1 ? layout : undefined,
      );
      let backendId = LOCAL_CONNECTION_ID;
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga(
        { channel, dispatch, getState: () => storeState(WS_1, backendId) },
        panelLayoutSaga,
      );
      await settle();
      dispatch.mockClear();

      backendId = REMOTE_ID;
      channel.put(connectionsListReceived({ connections: [], activeId: REMOTE_ID }));
      await settle();

      expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
        setRestoreStatus(WS_1, 'pending'),
        initializeLayout(WS_1, layout),
        setRestoreStatus(WS_1, 'restored'),
      ]);
      await cancelSaga(task);
    });

    it('resets the layout on switch when the incoming backend has nothing saved', async () => {
      mocks.getJSON.mockReturnValue(undefined);
      let backendId = LOCAL_CONNECTION_ID;
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga(
        { channel, dispatch, getState: () => storeState(WS_1, backendId) },
        panelLayoutSaga,
      );
      await settle();
      dispatch.mockClear();

      backendId = REMOTE_ID;
      channel.put(connectionsListReceived({ connections: [], activeId: REMOTE_ID }));
      await settle();

      const dispatched = dispatch.mock.calls.map(([action]) => action);
      expect(dispatched.map((action) => action.type)).toEqual([
        setRestoreStatus.type,
        resetLayout.type,
        loadLayoutHistory.type,
        setRestoreStatus.type,
      ]);
      expect(dispatched[0]).toEqual(setRestoreStatus(WS_1, 'pending'));
      expect(dispatched[1].payload.wsId).toBe(WS_1);
      expect(dispatched[2]).toEqual(loadLayoutHistory(WS_1, [], 0));
      expect(dispatched[3]).toEqual(setRestoreStatus(WS_1, 'empty'));
      await cancelSaga(task);
    });
  });

  describe('redesigned panel persistence', () => {
    it.each([movePanel, movePanelToRootEdge])(
      'persists whole-panel action $type',
      async (creator) => {
        mocks.getJSON.mockReturnValue(undefined);
        const { channel, task } = startSaga();
        await settle();
        channel.put({ type: creator.type, payload: { wsId: WS_1 } });
        await settle();

        expect(mocks.setJSON.mock.calls).toEqual([[STORAGE_KEY_1, layout]]);
        await cancelSaga(task);
      },
    );

    it('does not save debounced history into a newly selected backend', async () => {
      let backendId = LOCAL_CONNECTION_ID;
      const channel = stdChannel();
      const task = runSaga(
        { channel, dispatch: vi.fn(), getState: () => storeState(WS_1, backendId) },
        panelLayoutSaga,
      );
      await settle();
      mocks.saveHistory.mockClear();

      channel.put({ type: openTab.type, payload: { wsId: WS_1 } });
      await settle();
      backendId = REMOTE_ID;
      channel.put(connectionsListReceived({ connections: [], activeId: REMOTE_ID }));
      await settle();
      await vi.advanceTimersByTimeAsync(HISTORY_PERSIST_DEBOUNCE_MS);
      await settle();

      expect(mocks.saveHistory).not.toHaveBeenCalled();
      await cancelSaga(task);
    });

    it('does not flush stale pending history after a backend switch', async () => {
      let backendId = LOCAL_CONNECTION_ID;
      const channel = stdChannel();
      const task = runSaga(
        { channel, dispatch: vi.fn(), getState: () => storeState(WS_1, backendId) },
        panelLayoutSaga,
      );
      await settle();
      channel.put({ type: openTab.type, payload: { wsId: WS_1 } });
      await settle();

      backendId = REMOTE_ID;
      channel.put(connectionsListReceived({ connections: [], activeId: REMOTE_ID }));
      await settle();
      mocks.saveHistory.mockClear();
      await cancelSaga(task);

      expect(mocks.saveHistory).not.toHaveBeenCalled();
    });

    it('normalizes restored multi-tab panels into focused one-tab panels', async () => {
      const multiTabLayout = {
        root: { type: 'panel' as const, panelId: 'panel-1' },
        panels: {
          'panel-1': {
            id: 'panel-1',
            tabs: [
              {
                id: 'tab-1',
                type: 'note' as const,
                title: 'Note 1',
                closable: true,
                noteId: 'note-1',
              },
              {
                id: 'tab-2',
                type: 'note' as const,
                title: 'Note 2',
                closable: true,
                noteId: 'note-2',
              },
            ],
            activeTabId: 'tab-2',
          },
        },
        focusedPanelId: 'panel-1',
      };
      mocks.getJSON.mockReturnValue(multiTabLayout);
      const { channel, dispatch, task } = startSaga();
      await settle();
      channel.put(workspaceMounted(WS_1));
      await settle();

      const initializeCalls = dispatch.mock.calls.filter(
        ([action]) => action.type === initializeLayout.type,
      );
      expect(initializeCalls).toHaveLength(1);
      const normalized = initializeCalls[0][0].payload.layout;
      expect(normalized.root.type).toBe('split');
      expect(normalized.root.direction).toBe('horizontal');
      expect(normalized.root.children).toHaveLength(2);
      const panel1Id = normalized.root.children[0].panelId;
      const panel2Id = normalized.root.children[1].panelId;
      expect(normalized.panels[panel1Id].tabs.map(({ id }: { id: string }) => id)).toEqual([
        'tab-1',
      ]);
      expect(normalized.panels[panel2Id].tabs.map(({ id }: { id: string }) => id)).toEqual([
        'tab-2',
      ]);
      expect(normalized.focusedPanelId).toBe(panel2Id);
      await cancelSaga(task);
    });
  });
});
