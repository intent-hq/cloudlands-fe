import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const storage = vi.hoisted(() => ({ getJSON: vi.fn(), setJSON: vi.fn() }));
vi.mock('../../../utils/safe-local-storage-saga', () => ({
  getLocalStorageJSON: function* (key: string) {
    return storage.getJSON(key);
  },
  setLocalStorageJSON: function* (key: string, value: unknown) {
    storage.setJSON(key, value);
  },
}));

import {
  cleanupInvalidWorkspaceTabs,
  clearCurrentWorkspaceTab,
  clearForWorkspace,
  closeWorkspaceTab,
  handleOptimisticWorkspaceTabTransition,
  loadScrollPositions,
  loadWorkspaceTabsState,
  markWorkspaceTabOptimistic,
  markWorkspaceTabUnsaved,
  moveWorkspace,
  openWorkspaceTab,
  removeScrollPosition,
  reorderWorkspaceTabs,
  reopenLastClosedWorkspaceTab,
  restoreWorkspaceTab,
  saveScrollPosition,
  setWorkspaceViewMode,
  switchToNextWorkspaceTab,
  switchToPreviousWorkspaceTab,
  switchToWorkspaceTabByIndex,
  TAB_SCROLL_POSITIONS_STORAGE_KEY,
  toggleWorkspaceTabPin,
  unmarkWorkspaceTabOptimistic,
  WORKSPACE_TABS_STORAGE_KEY,
  workspaceTabsHydrated,
} from '../tab-state-slice';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import { connectionsListReceived } from '../../connections/connections-slice';
import { tabStateSaga } from './tab-state-saga';

const persistedTabs = {
  openTabs: ['ws-1'],
  currentTabId: 'ws-1',
  pinnedTabs: ['ws-1'],
  unsavedTabs: [],
  optimisticTabs: ['optimistic-1'],
  tabOrder: ['ws-1'],
  workspaceStacks: [['ws-1']],
  viewMode: 'columns' as const,
};

const state = {
  tabState: {
    scrollPositions: { 'ws-1-note': 42 },
    openTabs: { 'ws-1': true },
    currentTabId: 'ws-1',
    pinnedTabs: { 'ws-1': true },
    unsavedTabs: {},
    optimisticTabs: { 'optimistic-1': true },
    tabOrder: ['ws-1'],
    workspaceStacks: [['ws-1']],
    viewMode: 'columns' as const,
  },
  workspace: { hasLoaded: true },
  connections: { activeId: LOCAL_CONNECTION_ID },
};

const REMOTE_ID = 'remote-1';
const REMOTE_TABS_KEY = `backend:${REMOTE_ID}:${WORKSPACE_TABS_STORAGE_KEY}`;
const REMOTE_SCROLL_KEY = `backend:${REMOTE_ID}:${TAB_SCROLL_POSITIONS_STORAGE_KEY}`;
const remoteState = { ...state, connections: { activeId: REMOTE_ID } };

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('tabStateSaga', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hydrates scroll positions before the exact persisted workspace-tab snapshot', async () => {
    storage.getJSON.mockImplementation((key: string) =>
      key === TAB_SCROLL_POSITIONS_STORAGE_KEY ? { 'ws-1-note': 42 } : persistedTabs,
    );
    const dispatch = vi.fn();
    const task = runSaga({ channel: stdChannel(), dispatch, getState: () => state }, tabStateSaga);
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      loadScrollPositions({ 'ws-1-note': 42 }),
      loadWorkspaceTabsState(persistedTabs),
      workspaceTabsHydrated(LOCAL_CONNECTION_ID),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('ignores missing and malformed storage but still marks hydration settled', async () => {
    storage.getJSON.mockImplementation((key: string) =>
      key === TAB_SCROLL_POSITIONS_STORAGE_KEY ? { tab: Number.NaN } : { openTabs: 'bad' },
    );
    const dispatch = vi.fn();
    const task = runSaga({ channel: stdChannel(), dispatch, getState: () => state }, tabStateSaga);
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      workspaceTabsHydrated(LOCAL_CONNECTION_ID),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it.each([
    openWorkspaceTab('ws-1'),
    closeWorkspaceTab('ws-1'),
    reopenLastClosedWorkspaceTab(),
    restoreWorkspaceTab('ws-1'),
    clearCurrentWorkspaceTab(),
    cleanupInvalidWorkspaceTabs(['ws-1']),
    toggleWorkspaceTabPin('ws-1'),
    markWorkspaceTabUnsaved('ws-1', true),
    reorderWorkspaceTabs('ws-1', 'ws-2'),
    moveWorkspace('ws-1', 'ws-2', 'above'),
    markWorkspaceTabOptimistic('optimistic-1'),
    unmarkWorkspaceTabOptimistic('optimistic-1'),
    handleOptimisticWorkspaceTabTransition('optimistic-1', 'ws-1'),
    switchToNextWorkspaceTab(),
    switchToPreviousWorkspaceTab(),
    switchToWorkspaceTabByIndex(0),
    setWorkspaceViewMode('columns'),
  ])('persists the exact post-reducer tab snapshot for $type', async (action) => {
    storage.getJSON.mockReturnValue(undefined);
    const channel = stdChannel();
    const task = runSaga({ channel, dispatch: vi.fn(), getState: () => state }, tabStateSaga);
    await settle();
    channel.put(action);
    await settle();

    expect(storage.setJSON.mock.calls).toEqual([[WORKSPACE_TABS_STORAGE_KEY, persistedTabs]]);
    task.cancel();
    await task.toPromise();
  });

  it.each([
    saveScrollPosition('ws-1-note', 42),
    removeScrollPosition('ws-1-note'),
    clearForWorkspace('ws-1'),
  ])('persists the exact scroll map for $type', async (action) => {
    storage.getJSON.mockReturnValue(undefined);
    const channel = stdChannel();
    const task = runSaga({ channel, dispatch: vi.fn(), getState: () => state }, tabStateSaga);
    await settle();
    channel.put(action);
    await settle();

    expect(storage.setJSON.mock.calls).toEqual([
      [TAB_SCROLL_POSITIONS_STORAGE_KEY, { 'ws-1-note': 42 }],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('skips early cleanup persistence, survives a later write failure, and cancels cleanly', async () => {
    storage.getJSON.mockReturnValue(undefined);
    storage.setJSON.mockImplementationOnce(() => {
      throw new Error('quota');
    });
    const current = { ...state, workspace: { hasLoaded: false } };
    const channel = stdChannel();
    const task = runSaga({ channel, dispatch: vi.fn(), getState: () => current }, tabStateSaga);
    await settle();
    channel.put(cleanupInvalidWorkspaceTabs([]));
    channel.put(openWorkspaceTab('ws-1'));
    channel.put(saveScrollPosition('ws-1-note', 42));
    await settle();

    expect(storage.setJSON.mock.calls).toEqual([
      [WORKSPACE_TABS_STORAGE_KEY, persistedTabs],
      [TAB_SCROLL_POSITIONS_STORAGE_KEY, { 'ws-1-note': 42 }],
    ]);
    task.cancel();
    await task.toPromise();
    expect(task.isCancelled()).toBe(true);
  });

  describe('multi-backend namespacing', () => {
    it('namespaces hydration and persistence reads/writes for a remote backend', async () => {
      storage.getJSON.mockImplementation((key: string) =>
        key === REMOTE_SCROLL_KEY ? { 'ws-1-note': 42 } : persistedTabs,
      );
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga({ channel, dispatch, getState: () => remoteState }, tabStateSaga);
      await settle();
      channel.put(openWorkspaceTab('ws-1'));
      channel.put(saveScrollPosition('ws-1-note', 42));
      await settle();

      expect(storage.getJSON.mock.calls).toEqual([[REMOTE_SCROLL_KEY], [REMOTE_TABS_KEY]]);
      expect(storage.setJSON.mock.calls).toEqual([
        [REMOTE_TABS_KEY, persistedTabs],
        [REMOTE_SCROLL_KEY, { 'ws-1-note': 42 }],
      ]);
      task.cancel();
      await task.toPromise();
    });

    it('re-hydrates from the incoming backend namespace on switch, resetting when empty', async () => {
      storage.getJSON.mockImplementation((key: string) =>
        key === REMOTE_TABS_KEY ? persistedTabs : undefined,
      );
      let current = state;
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga({ channel, dispatch, getState: () => current }, tabStateSaga);
      await settle();
      dispatch.mockClear();

      current = remoteState;
      channel.put(connectionsListReceived({ connections: [], activeId: REMOTE_ID }));
      await settle();

      expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
        loadScrollPositions({}),
        loadWorkspaceTabsState(persistedTabs),
        workspaceTabsHydrated(REMOTE_ID),
      ]);
      task.cancel();
      await task.toPromise();
    });
  });

  describe('regression: clear recently-closed tabs on backend switch', () => {
    it('loads workspace tabs state on backend switch', async () => {
      const channel = stdChannel();
      const dispatch = vi.fn();
      let backendId = LOCAL_CONNECTION_ID;
      const task = runSaga(
        {
          channel,
          dispatch,
          getState: () => ({ ...state, connections: { activeId: backendId } }),
        },
        tabStateSaga,
      );
      await new Promise(setImmediate);

      storage.getJSON.mockReturnValue({
        openTabs: ['ws-2'],
        currentTabId: 'ws-2',
        pinnedTabs: [],
        unsavedTabs: [],
        optimisticTabs: [],
        tabOrder: ['ws-2'],
        workspaceStacks: [['ws-2']],
        viewMode: 'single',
      });

      backendId = 'remote-backend';
      dispatch.mockClear();
      channel.put(connectionsListReceived({ connections: [], activeId: 'remote-backend' }));
      await new Promise(setImmediate);

      const loadActions = dispatch.mock.calls.filter(
        ([action]) => action.type === loadWorkspaceTabsState.type,
      );
      expect(loadActions.length).toBeGreaterThan(0);

      task.cancel();
      await task.toPromise();
    });
  });
});
