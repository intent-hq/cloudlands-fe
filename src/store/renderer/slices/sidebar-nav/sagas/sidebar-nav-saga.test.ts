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
  COMBINED_PANEL_SPLIT_KEY,
  closeAll,
  closeHoverCards,
  closePanel,
  hydrateSidebarNav,
  LEGACY_HOME_PANEL_SPLIT_KEY,
  MULTISELECT_SIDEBAR_TAB_ORDER_KEY,
  openPanel,
  PANEL_ITEM_KEY,
  PANEL_WIDTH_KEY,
  pinWorkspace,
  PINNED_WORKSPACES_KEY,
  setAllSpacesViewMode,
  setCardPinned,
  setChiefActiveAgentId,
  setCombinedPanelSplit,
  setMultiSelectSidebarTabOrder,
  setPanelWidth,
  setPinnedWorkspaceIds,
  setShowArchivedWorkspaces,
  SHOW_ARCHIVED_KEY,
  toggleCardPinned,
  togglePanel,
  togglePinWorkspace,
  unpinWorkspace,
  VIEW_MODE_KEY,
} from '../sidebar-nav-slice';
import { initialState } from '../sidebar-nav-slice';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import { connectionsListReceived } from '../../connections/connections-slice';
import { sidebarNavSaga } from './sidebar-nav-saga';

const current = {
  sidebarNav: {
    ...initialState,
    pinnedWorkspaceIds: ['ws-1'],
    allSpacesViewMode: 'repo' as const,
    showArchivedWorkspaces: true,
    panelWidth: 320,
    combinedPanelSplit: 0.4,
    panelItem: 'chief' as const,
    isCardPinned: true,
    chiefActiveAgentId: 'agent-1',
    multiSelectTabOrder: ['context', 'overview'],
  },
  connections: { activeId: LOCAL_CONNECTION_ID },
};

const REMOTE_ID = 'remote-1';
const REMOTE_PINNED_KEY = `backend:${REMOTE_ID}:${PINNED_WORKSPACES_KEY}`;
const REMOTE_CHIEF_KEY = `backend:${REMOTE_ID}:${CHIEF_ACTIVE_AGENT_ID_KEY}`;
const REMOTE_TAB_ORDER_KEY = `backend:${REMOTE_ID}:${MULTISELECT_SIDEBAR_TAB_ORDER_KEY}`;
const remoteCurrent = { ...current, connections: { activeId: REMOTE_ID } };

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

  it.each([
    [setPinnedWorkspaceIds(['ws-1']), [[PINNED_WORKSPACES_KEY, ['ws-1']]]],
    [pinWorkspace('ws-1'), [[PINNED_WORKSPACES_KEY, ['ws-1']]]],
    [unpinWorkspace('ws-1'), [[PINNED_WORKSPACES_KEY, ['ws-1']]]],
    [togglePinWorkspace('ws-1'), [[PINNED_WORKSPACES_KEY, ['ws-1']]]],
    [setAllSpacesViewMode('repo'), [[VIEW_MODE_KEY, 'repo']]],
    [setShowArchivedWorkspaces(true), [[SHOW_ARCHIVED_KEY, true]]],
    [setPanelWidth(320), [[PANEL_WIDTH_KEY, 320]]],
    [setCombinedPanelSplit(0.4), [[COMBINED_PANEL_SPLIT_KEY, 0.4]]],
    [
      openPanel('chief'),
      [
        [PANEL_ITEM_KEY, 'chief'],
        [CARD_PINNED_KEY, true],
      ],
    ],
    [
      closePanel(),
      [
        [PANEL_ITEM_KEY, 'chief'],
        [CARD_PINNED_KEY, true],
      ],
    ],
    [
      togglePanel('chief'),
      [
        [PANEL_ITEM_KEY, 'chief'],
        [CARD_PINNED_KEY, true],
      ],
    ],
    [
      closeAll(false),
      [
        [PANEL_ITEM_KEY, 'chief'],
        [CARD_PINNED_KEY, true],
      ],
    ],
    [closeHoverCards(), [[CARD_PINNED_KEY, true]]],
    [setCardPinned(true), [[CARD_PINNED_KEY, true]]],
    [toggleCardPinned(), [[CARD_PINNED_KEY, true]]],
    [setChiefActiveAgentId('agent-1'), [[CHIEF_ACTIVE_AGENT_ID_KEY, 'agent-1']]],
    [
      setMultiSelectSidebarTabOrder(['context']),
      [[MULTISELECT_SIDEBAR_TAB_ORDER_KEY, ['context', 'overview']]],
    ],
  ] as const)('persists an audited mutation trigger', async (action, expected) => {
    storage.getItem.mockReturnValue(null);
    storage.getJSON.mockReturnValue(undefined);
    const channel = stdChannel();
    const task = runSaga({ channel, dispatch: vi.fn(), getState: () => current }, sidebarNavSaga);
    await settle();
    channel.put(action);
    await settle();

    expect(storage.setJSON.mock.calls).toEqual(expected);
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

  describe('multi-backend namespacing', () => {
    it('namespaces only the backend-specific keys for a remote backend', async () => {
      storage.getItem.mockReturnValue(null);
      storage.getJSON.mockReturnValue(undefined);
      const channel = stdChannel();
      const task = runSaga(
        { channel, dispatch: vi.fn(), getState: () => remoteCurrent },
        sidebarNavSaga,
      );
      await settle();
      channel.put(setPinnedWorkspaceIds(['ws-1']));
      channel.put(setChiefActiveAgentId('agent-1'));
      channel.put(setMultiSelectSidebarTabOrder(['context']));
      channel.put(setPanelWidth(320));
      channel.put(setAllSpacesViewMode('repo'));
      channel.put(setCardPinned(true));
      await settle();

      expect(storage.getJSON.mock.calls).toEqual([
        [REMOTE_PINNED_KEY],
        [SHOW_ARCHIVED_KEY],
        [PANEL_WIDTH_KEY],
        [COMBINED_PANEL_SPLIT_KEY],
        [LEGACY_HOME_PANEL_SPLIT_KEY],
        [PANEL_ITEM_KEY],
        [CARD_PINNED_KEY],
        [REMOTE_CHIEF_KEY],
        [REMOTE_TAB_ORDER_KEY],
      ]);
      expect(storage.setJSON.mock.calls).toEqual([
        [REMOTE_PINNED_KEY, ['ws-1']],
        [REMOTE_CHIEF_KEY, 'agent-1'],
        [REMOTE_TAB_ORDER_KEY, ['context', 'overview']],
        [PANEL_WIDTH_KEY, 320],
        [VIEW_MODE_KEY, 'repo'],
        [CARD_PINNED_KEY, true],
      ]);
      task.cancel();
      await task.toPromise();
    });

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
      channel.put(connectionsListReceived({ connections: [], activeId: REMOTE_ID }));
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
});
