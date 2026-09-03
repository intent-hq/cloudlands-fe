import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const storage = vi.hoisted(() => ({ getItem: vi.fn(), getJSON: vi.fn(), setJSON: vi.fn() }));
vi.mock('../../../utils/safe-local-storage-saga', () => ({
  getLocalStorageItem: function* (key: string) {
    return storage.getItem(key);
  },
  getLocalStorageJSON: function* (key: string) {
    return storage.getJSON(key);
  },
  setLocalStorageJSON: function* (key: string, value: unknown) {
    storage.setJSON(key, value);
  },
}));

import {
  CARD_PINNED_KEY,
  CHIEF_ACTIVE_AGENT_ID_KEY,
  CHIEF_COLLAPSED_KEY,
  COLLAPSED_STATUS_GROUPS_KEY,
  COMBINED_PANEL_SPLIT_KEY,
  hydrateSidebarNav,
  hydrateWorkspaceSidebarUi,
  LEGACY_HOME_PANEL_SPLIT_KEY,
  MULTISELECT_SIDEBAR_SELECTED_TABS_PREFIX,
  MULTISELECT_SIDEBAR_TAB_ORDER_KEY,
  PANEL_ITEM_KEY,
  PANEL_WIDTH_KEY,
  PINNED_WORKSPACES_KEY,
  setAllSpacesViewMode,
  setChiefCollapsed,
  setMultiSelectSidebarSelectedTabs,
  setPanelWidth,
  setWorkspaceNoteOrder,
  SHOW_ARCHIVED_KEY,
  toggleWorkspaceCollapsedNote,
  toggleStatusGroupCollapsed,
  VIEW_MODE_KEY,
  WORKSPACE_COLLAPSED_NOTES_PREFIX,
  WORKSPACE_NOTE_ORDER_PREFIX,
} from '../sidebar-nav-slice';
import { initialState } from '../sidebar-nav-slice';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import { connectionsListReceived } from '../../connections/connections-slice';
import { workspaceMounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { sidebarNavSaga } from './sidebar-nav-saga';

const current = {
  sidebarNav: {
    ...initialState,
    pinnedWorkspaceIds: ['ws-1'],
    allSpacesViewMode: 'repo' as const,
    showArchivedWorkspaces: true,
    collapsedStatusGroupIds: ['idle'],
    isChiefCollapsed: true,
    panelWidth: 320,
    combinedPanelSplit: 0.4,
    panelItem: 'chief' as const,
    isCardPinned: true,
    chiefActiveAgentId: 'agent-1',
    multiSelectTabOrder: ['context', 'overview'],
  },
  connections: { activeId: LOCAL_CONNECTION_ID, windowBackendId: LOCAL_CONNECTION_ID },
};

const REMOTE_ID = 'remote-1';
const REMOTE_PINNED_KEY = `backend:${REMOTE_ID}:${PINNED_WORKSPACES_KEY}`;
const remoteCurrent = {
  ...current,
  connections: { activeId: REMOTE_ID, windowBackendId: REMOTE_ID },
};

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('sidebarNavSaga', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hydrates every valid field, filters ids, and migrates a legacy raw view mode', async () => {
    storage.getItem.mockImplementation((key: string) => (key === VIEW_MODE_KEY ? 'repo' : null));
    storage.getJSON.mockImplementation((key: string) => {
      if (key === PINNED_WORKSPACES_KEY) return ['ws-1', 2, 'ws-2'];
      if (key === SHOW_ARCHIVED_KEY) return true;
      if (key === COLLAPSED_STATUS_GROUPS_KEY) return ['idle', 2];
      if (key === CHIEF_COLLAPSED_KEY) return true;
      if (key === PANEL_WIDTH_KEY) return 320;
      if (key === COMBINED_PANEL_SPLIT_KEY) return 0.4;
      if (key === PANEL_ITEM_KEY) return 'chief';
      if (key === CARD_PINNED_KEY) return true;
      if (key === CHIEF_ACTIVE_AGENT_ID_KEY) return 'agent-1';
      if (key === MULTISELECT_SIDEBAR_TAB_ORDER_KEY) return ['context', null, 'overview'];
      return undefined;
    });
    const dispatch = vi.fn();
    const task = runSaga(
      { channel: stdChannel(), dispatch, getState: () => current },
      sidebarNavSaga,
    );
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      hydrateSidebarNav({
        pinnedWorkspaceIds: ['ws-1', 'ws-2'],
        allSpacesViewMode: 'repo',
        showArchivedWorkspaces: true,
        collapsedStatusGroupIds: ['idle'],
        isChiefCollapsed: true,
        panelWidth: 320,
        combinedPanelSplit: 0.4,
        panelItem: 'chief',
        isCardPinned: true,
        chiefActiveAgentId: 'agent-1',
        multiSelectTabOrder: ['context', 'overview'],
      }),
    ]);
    expect(storage.setJSON.mock.calls).toEqual([[VIEW_MODE_KEY, 'repo']]);
    task.cancel();
    await task.toPromise();
  });

  it('ignores malformed storage and does not rewrite a JSON view mode', async () => {
    storage.getItem.mockReturnValue(JSON.stringify('status'));
    storage.getJSON.mockImplementation((key: string) => {
      if (key === PINNED_WORKSPACES_KEY) return 'bad';
      if (key === SHOW_ARCHIVED_KEY) return 'yes';
      if (key === PANEL_WIDTH_KEY) return Number.NaN;
      if (key === COMBINED_PANEL_SPLIT_KEY) return Number.NaN;
      if (key === LEGACY_HOME_PANEL_SPLIT_KEY) return Number.NaN;
      if (key === PANEL_ITEM_KEY) return 'not-a-panel';
      if (key === CARD_PINNED_KEY) return 'yes';
      if (key === CHIEF_ACTIVE_AGENT_ID_KEY) return 4;
      if (key === MULTISELECT_SIDEBAR_TAB_ORDER_KEY) return 'bad';
      return undefined;
    });
    const dispatch = vi.fn();
    const task = runSaga(
      { channel: stdChannel(), dispatch, getState: () => current },
      sidebarNavSaga,
    );
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      hydrateSidebarNav({ allSpacesViewMode: 'status' }),
    ]);
    expect(storage.setJSON.mock.calls).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('migrates the legacy combined-panel split storage key', async () => {
    storage.getItem.mockReturnValue(null);
    storage.getJSON.mockImplementation((key: string) =>
      key === LEGACY_HOME_PANEL_SPLIT_KEY ? 0.35 : undefined,
    );
    const dispatch = vi.fn();
    const task = runSaga(
      { channel: stdChannel(), dispatch, getState: () => current },
      sidebarNavSaga,
    );
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      hydrateSidebarNav({ combinedPanelSplit: 0.35 }),
    ]);
    expect(storage.setJSON.mock.calls).toEqual([[COMBINED_PANEL_SPLIT_KEY, 0.35]]);
    task.cancel();
    await task.toPromise();
  });

  it('survives a storage failure, ignores unrelated actions, and cancels cleanly', async () => {
    storage.getItem.mockReturnValue(null);
    storage.getJSON.mockReturnValue(undefined);
    storage.setJSON.mockImplementationOnce(() => {
      throw new Error('quota');
    });
    const channel = stdChannel();
    const task = runSaga({ channel, dispatch: vi.fn(), getState: () => current }, sidebarNavSaga);
    await settle();
    channel.put(setPanelWidth(320));
    channel.put({ type: 'unrelated/action' });
    channel.put(setAllSpacesViewMode('repo'));
    await settle();

    expect(storage.setJSON.mock.calls).toEqual([
      [PANEL_WIDTH_KEY, 320],
      [VIEW_MODE_KEY, 'repo'],
    ]);
    task.cancel();
    await task.toPromise();
    expect(task.isCancelled()).toBe(true);
  });

  it('persists status-group and Chief collapse preferences as global sidebar UI state', async () => {
    storage.getItem.mockReturnValue(null);
    storage.getJSON.mockReturnValue(undefined);
    const channel = stdChannel();
    const task = runSaga({ channel, dispatch: vi.fn(), getState: () => current }, sidebarNavSaga);
    await settle();

    channel.put(toggleStatusGroupCollapsed('idle'));
    channel.put(setChiefCollapsed(true));
    await settle();

    expect(storage.setJSON.mock.calls).toEqual([
      [COLLAPSED_STATUS_GROUPS_KEY, ['idle']],
      [CHIEF_COLLAPSED_KEY, true],
    ]);
    task.cancel();
    await task.toPromise();
  });

  describe('multi-backend namespacing', () => {
    it('re-hydrates per-backend keys on switch, resetting the ones the backend lacks', async () => {
      storage.getItem.mockReturnValue(null);
      storage.getJSON.mockImplementation((key: string) =>
        key === REMOTE_PINNED_KEY ? ['ws-9'] : undefined,
      );
      let state = current;
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga({ channel, dispatch, getState: () => state }, sidebarNavSaga);
      await settle();
      dispatch.mockClear();

      state = remoteCurrent;
      channel.put(
        connectionsListReceived({
          connections: [],
          activeId: REMOTE_ID,
          windowBackendId: REMOTE_ID,
        }),
      );
      await settle();

      expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
        hydrateSidebarNav({
          pinnedWorkspaceIds: ['ws-9'],
          chiefActiveAgentId: null,
          multiSelectTabOrder: [],
        }),
      ]);
      task.cancel();
      await task.toPromise();
    });
  });

  describe('per-workspace sidebar UI persistence', () => {
    const SELECTED_TABS_KEY = `${MULTISELECT_SIDEBAR_SELECTED_TABS_PREFIX}ws-1`;
    const NOTE_ORDER_KEY = `${WORKSPACE_NOTE_ORDER_PREFIX}ws-1`;
    const COLLAPSED_NOTES_KEY = `${WORKSPACE_COLLAPSED_NOTES_PREFIX}ws-1`;

    it('hydrates stored selected tabs, note order, and collapsed notes on workspaceMounted', async () => {
      storage.getItem.mockReturnValue(null);
      storage.getJSON.mockImplementation((key: string) => {
        if (key === SELECTED_TABS_KEY) return ['context', 7, 'overview'];
        if (key === NOTE_ORDER_KEY) return ['note-2', 'note-1'];
        if (key === COLLAPSED_NOTES_KEY) return ['note-1'];
        return undefined;
      });
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga({ channel, dispatch, getState: () => current }, sidebarNavSaga);
      await settle();
      dispatch.mockClear();

      channel.put(workspaceMounted('ws-1'));
      await settle();

      expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
        hydrateWorkspaceSidebarUi('ws-1', {
          selectedTabIds: ['context', 'overview'],
          noteOrder: ['note-2', 'note-1'],
          collapsedNoteIds: ['note-1'],
        }),
      ]);
      task.cancel();
      await task.toPromise();
    });

    it('does not dispatch when the workspace has nothing stored', async () => {
      storage.getItem.mockReturnValue(null);
      storage.getJSON.mockReturnValue(undefined);
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga({ channel, dispatch, getState: () => current }, sidebarNavSaga);
      await settle();
      dispatch.mockClear();

      channel.put(workspaceMounted('ws-1'));
      await settle();

      expect(dispatch).not.toHaveBeenCalled();
      task.cancel();
      await task.toPromise();
    });

    it('persists selected tabs, note order, and collapsed notes under workspace-scoped keys', async () => {
      storage.getItem.mockReturnValue(null);
      storage.getJSON.mockReturnValue(undefined);
      const state = {
        ...current,
        sidebarNav: {
          ...current.sidebarNav,
          multiSelectSelectedTabIdsByWorkspaceId: { 'ws-1': ['context', 'overview'] },
          noteOrderByWorkspaceId: { 'ws-1': ['note-2', 'note-1'] },
          collapsedNoteIdsByWorkspaceId: { 'ws-1': ['note-1'] },
        },
      };
      const channel = stdChannel();
      const task = runSaga({ channel, dispatch: vi.fn(), getState: () => state }, sidebarNavSaga);
      await settle();

      channel.put(setMultiSelectSidebarSelectedTabs('ws-1', ['context', 'overview']));
      channel.put(setWorkspaceNoteOrder('ws-1', ['note-2', 'note-1']));
      channel.put(toggleWorkspaceCollapsedNote('ws-1', 'note-1'));
      await settle();

      expect(storage.setJSON.mock.calls).toEqual([
        [SELECTED_TABS_KEY, ['context', 'overview']],
        [NOTE_ORDER_KEY, ['note-2', 'note-1']],
        [COLLAPSED_NOTES_KEY, ['note-1']],
      ]);
      task.cancel();
      await task.toPromise();
    });

    it('namespaces per-workspace keys for a remote backend', async () => {
      storage.getItem.mockReturnValue(null);
      storage.getJSON.mockReturnValue(undefined);
      const state = {
        ...remoteCurrent,
        sidebarNav: {
          ...remoteCurrent.sidebarNav,
          multiSelectSelectedTabIdsByWorkspaceId: { 'ws-1': ['context'] },
        },
      };
      const channel = stdChannel();
      const task = runSaga({ channel, dispatch: vi.fn(), getState: () => state }, sidebarNavSaga);
      await settle();

      channel.put(setMultiSelectSidebarSelectedTabs('ws-1', ['context']));
      await settle();

      expect(storage.setJSON.mock.calls).toEqual([
        [`backend:${REMOTE_ID}:${SELECTED_TABS_KEY}`, ['context']],
      ]);
      task.cancel();
      await task.toPromise();
    });
  });
});
