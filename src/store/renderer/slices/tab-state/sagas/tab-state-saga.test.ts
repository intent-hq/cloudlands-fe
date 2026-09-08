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
  loadScrollPositions,
  loadWorkspaceTabsState,
  openWorkspaceTab,
  saveScrollPosition,
  TAB_SCROLL_POSITIONS_STORAGE_KEY,
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
};

const legacyPersistedTabs = { ...persistedTabs, viewMode: 'columns' as const };

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
  },
  workspace: { hasLoaded: true },
  connections: { activeId: LOCAL_CONNECTION_ID, windowBackendId: LOCAL_CONNECTION_ID },
};

const REMOTE_ID = 'remote-1';
const REMOTE_TABS_KEY = `backend:${REMOTE_ID}:${WORKSPACE_TABS_STORAGE_KEY}`;
const REMOTE_SCROLL_KEY = `backend:${REMOTE_ID}:${TAB_SCROLL_POSITIONS_STORAGE_KEY}`;
const remoteState = { ...state, connections: { activeId: REMOTE_ID, windowBackendId: REMOTE_ID } };

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('tabStateSaga', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hydrates scroll positions before an old persisted workspace-tab snapshot', async () => {
    storage.getJSON.mockImplementation((key: string) =>
      key === TAB_SCROLL_POSITIONS_STORAGE_KEY ? { 'ws-1-note': 42 } : legacyPersistedTabs,
    );
    const dispatch = vi.fn();
    const task = runSaga({ channel: stdChannel(), dispatch, getState: () => state }, tabStateSaga);
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      loadScrollPositions({ 'ws-1-note': 42 }),
      loadWorkspaceTabsState(legacyPersistedTabs),
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
      channel.put(
        connectionsListReceived({
          connections: [],
          activeId: REMOTE_ID,
          windowBackendId: REMOTE_ID,
        }),
      );
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
          getState: () => ({
            ...state,
            connections: { activeId: backendId, windowBackendId: backendId },
          }),
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
      });

      backendId = 'remote-backend';
      dispatch.mockClear();
      channel.put(
        connectionsListReceived({
          connections: [],
          activeId: 'remote-backend',
          windowBackendId: 'remote-backend',
        }),
      );
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
