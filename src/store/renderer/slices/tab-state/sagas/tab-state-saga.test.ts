import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const storage = vi.hoisted(() => ({ getJSON: vi.fn(), setJSON: vi.fn() }));
const embedded = vi.hoisted(() => ({ value: false }));
vi.mock('$lib/unified-embedded', () => ({ isUnifiedEmbedded: () => embedded.value }));
vi.mock('../../../utils/safe-local-storage-saga', () => ({
  getLocalStorageJSON: function* (key: string) {
    return storage.getJSON(key);
  },
  setLocalStorageJSON: function* (key: string, value: unknown) {
    storage.setJSON(key, value);
  },
}));

import {
  addWorkspaceTabToGroup,
  createWorkspaceTabGroup,
  getWorkspaceTabGroupList,
  loadScrollPositions,
  loadWorkspaceTabsState,
  openWorkspaceTab,
  removeWorkspaceTabFromGroup,
  saveScrollPosition,
  setOpenWorkspaceTabGroup,
  TAB_SCROLL_POSITIONS_STORAGE_KEY,
  tabStateReducer,
  type PersistedWorkspaceTabsState,
  ungroupWorkspaceTabGroup,
  updateWorkspaceTabGroup,
  WORKSPACE_TABS_STORAGE_KEY,
  workspaceTabsHydrated,
} from '../tab-state-slice';
import type { WorkspaceTabGroup } from '../tab-groups';
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
  beforeEach(() => {
    vi.clearAllMocks();
    embedded.value = false;
  });

  it("in a Unified window machine view, never restores or saves that machine's workspace tabs", async () => {
    embedded.value = true;
    storage.getJSON.mockReturnValue(persistedTabs);
    const channel = stdChannel();
    const dispatch = vi.fn((action) => channel.put(action));
    const task = runSaga({ channel, dispatch, getState: () => remoteState }, tabStateSaga);
    await settle();
    dispatch(openWorkspaceTab('ws-2'));
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      workspaceTabsHydrated(REMOTE_ID),
      openWorkspaceTab('ws-2'),
    ]);
    expect(storage.getJSON).not.toHaveBeenCalledWith(REMOTE_TABS_KEY);
    expect(storage.setJSON).not.toHaveBeenCalledWith(REMOTE_TABS_KEY, expect.anything());
    task.cancel();
    await task.toPromise();
  });

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

  describe.each([
    { backend: 'local', backendId: LOCAL_CONNECTION_ID, tabsKey: WORKSPACE_TABS_STORAGE_KEY },
    { backend: 'remote', backendId: REMOTE_ID, tabsKey: REMOTE_TABS_KEY },
  ])('tab-group persistence in the $backend namespace', ({ backendId, tabsKey }) => {
    const ungroupedTabs: PersistedWorkspaceTabsState = {
      openTabs: ['ws-1', 'ws-2', 'ws-3'],
      currentTabId: 'ws-1',
      pinnedTabs: [],
      unsavedTabs: [],
      optimisticTabs: [],
      tabOrder: ['ws-1', 'ws-2', 'ws-3'],
      workspaceStacks: [['ws-1'], ['ws-2'], ['ws-3']],
    };
    const group: WorkspaceTabGroup = {
      id: 'group-1',
      name: 'Planning',
      color: 'blue',
      workspaceIds: ['ws-1', 'ws-2'],
      lastActiveWorkspaceId: 'ws-1',
    };
    const groupedTabs: PersistedWorkspaceTabsState = {
      ...ungroupedTabs,
      tabGroups: [group],
      openTabGroupId: 'group-1',
    };
    // A selected group's tabs stay visible; isolate chip state with an outside selection.
    const outsideSelectedTabs = { ...groupedTabs, currentTabId: 'ws-3' };

    it.each([
      {
        edit: 'creating a group',
        before: ungroupedTabs,
        action: createWorkspaceTabGroup('ws-1', 'group-1', 'blue'),
        after: {
          ...groupedTabs,
          tabGroups: [{ ...group, name: '', workspaceIds: ['ws-1'] }],
        },
      },
      {
        edit: 'renaming and recoloring a group',
        before: groupedTabs,
        action: updateWorkspaceTabGroup('group-1', { name: 'Review', color: 'purple' }),
        after: {
          ...groupedTabs,
          tabGroups: [{ ...group, name: 'Review', color: 'purple' as const }],
        },
      },
      {
        edit: 'adding a member',
        before: groupedTabs,
        action: addWorkspaceTabToGroup('ws-3', 'group-1'),
        after: {
          ...groupedTabs,
          tabGroups: [{ ...group, workspaceIds: ['ws-1', 'ws-2', 'ws-3'] }],
        },
      },
      {
        edit: 'removing a member',
        before: groupedTabs,
        action: removeWorkspaceTabFromGroup('ws-2'),
        after: { ...groupedTabs, tabGroups: [{ ...group, workspaceIds: ['ws-1'] }] },
      },
      {
        edit: 'removing the last member',
        before: { ...groupedTabs, tabGroups: [{ ...group, workspaceIds: ['ws-1'] }] },
        action: removeWorkspaceTabFromGroup('ws-1'),
        after: ungroupedTabs,
      },
      {
        edit: 'ungrouping',
        before: groupedTabs,
        action: ungroupWorkspaceTabGroup('group-1'),
        after: ungroupedTabs,
      },
      {
        edit: 'collapsing a group',
        before: outsideSelectedTabs,
        action: setOpenWorkspaceTabGroup(null),
        after: { ...outsideSelectedTabs, openTabGroupId: null },
      },
      {
        edit: 'expanding a group',
        before: { ...outsideSelectedTabs, openTabGroupId: null },
        action: setOpenWorkspaceTabGroup('group-1'),
        after: outsideSelectedTabs,
      },
    ])('saves and restores $edit without another tab action', async ({ before, action, after }) => {
      const saved = new Map([[tabsKey, JSON.stringify(before)]]);
      storage.getJSON.mockImplementation((key: string) => JSON.parse(saved.get(key) ?? 'null'));
      storage.setJSON.mockImplementation((key: string, value: unknown) => {
        saved.set(key, JSON.stringify(value));
      });
      let current = tabStateReducer(undefined, { type: '@@INIT' });
      const channel = stdChannel();
      const dispatch = (nextAction: Parameters<typeof tabStateReducer>[1]) => {
        current = tabStateReducer(current, nextAction);
        channel.put(nextAction);
      };
      const io = {
        channel,
        dispatch,
        getState: () => ({
          ...state,
          tabState: current,
          connections: { activeId: backendId, windowBackendId: backendId },
        }),
      };
      let task = runSaga(io, tabStateSaga);
      try {
        await settle();
        dispatch(action);
        await settle();

        expect(storage.setJSON.mock.calls).toEqual([[tabsKey, after]]);

        task.cancel();
        await task.toPromise();
        current = tabStateReducer(undefined, { type: '@@INIT' });
        task = runSaga(io, tabStateSaga);
        await settle();

        expect(getWorkspaceTabGroupList(current)).toEqual(after.tabGroups ?? []);
        expect(current.openTabGroupId).toBe(after.openTabGroupId ?? null);
        expect(current.workspaceStacks).toEqual(after.workspaceStacks);
        expect(current.currentTabId).toBe(after.currentTabId);
        expect(current.hydratedBackendId).toBe(backendId);
        expect(storage.setJSON).toHaveBeenCalledTimes(1);
      } finally {
        task.cancel();
        await task.toPromise();
        channel.close();
      }
    });
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
