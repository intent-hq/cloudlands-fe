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
  closeAll,
  closeHoverCards,
  closePanel,
  hydrateSidebarNav,
  MULTISELECT_SIDEBAR_TAB_ORDER_KEY,
  openPanel,
  PANEL_ITEM_KEY,
  PANEL_WIDTH_KEY,
  pinWorkspace,
  PINNED_WORKSPACES_KEY,
  setAllSpacesViewMode,
  setCardPinned,
  setChiefActiveAgentId,
  setMultiSelectSidebarTabOrder,
  setPanelWidth,
  setPinnedWorkspaceIds,
  toggleCardPinned,
  togglePanel,
  togglePinWorkspace,
  unpinWorkspace,
  VIEW_MODE_KEY,
} from '../sidebar-nav-slice';
import { initialState } from '../sidebar-nav-slice';
import { sidebarNavSaga } from './sidebar-nav-saga';

const current = {
  sidebarNav: {
    ...initialState,
    pinnedWorkspaceIds: ['ws-1'],
    allSpacesViewMode: 'repo' as const,
    panelWidth: 320,
    panelItem: 'chief' as const,
    isCardPinned: true,
    chiefActiveAgentId: 'agent-1',
    multiSelectTabOrder: ['context', 'overview'],
  },
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
      if (key === PANEL_WIDTH_KEY) return 320;
      if (key === PANEL_ITEM_KEY) return 'chief';
      if (key === CARD_PINNED_KEY) return true;
      if (key === CHIEF_ACTIVE_AGENT_ID_KEY) return 'agent-1';
      if (key === MULTISELECT_SIDEBAR_TAB_ORDER_KEY) return ['context', null, 'overview'];
      return undefined;
    });
    const dispatch = vi.fn();
    const task = runSaga({ channel: stdChannel(), dispatch, getState: () => current }, sidebarNavSaga);
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      hydrateSidebarNav({
        pinnedWorkspaceIds: ['ws-1', 'ws-2'],
        allSpacesViewMode: 'repo',
        panelWidth: 320,
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
      if (key === PANEL_WIDTH_KEY) return Number.NaN;
      if (key === PANEL_ITEM_KEY) return 'not-a-panel';
      if (key === CARD_PINNED_KEY) return 'yes';
      if (key === CHIEF_ACTIVE_AGENT_ID_KEY) return 4;
      if (key === MULTISELECT_SIDEBAR_TAB_ORDER_KEY) return 'bad';
      return undefined;
    });
    const dispatch = vi.fn();
    const task = runSaga({ channel: stdChannel(), dispatch, getState: () => current }, sidebarNavSaga);
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
    [setPanelWidth(320), [[PANEL_WIDTH_KEY, 320]]],
    [openPanel('chief'), [[PANEL_ITEM_KEY, 'chief'], [CARD_PINNED_KEY, true]]],
    [closePanel(), [[PANEL_ITEM_KEY, 'chief'], [CARD_PINNED_KEY, true]]],
    [togglePanel('chief'), [[PANEL_ITEM_KEY, 'chief'], [CARD_PINNED_KEY, true]]],
    [closeAll(false), [[PANEL_ITEM_KEY, 'chief'], [CARD_PINNED_KEY, true]]],
    [closeHoverCards(), [[CARD_PINNED_KEY, true]]],
    [setCardPinned(true), [[CARD_PINNED_KEY, true]]],
    [toggleCardPinned(), [[CARD_PINNED_KEY, true]]],
    [setChiefActiveAgentId('agent-1'), [[CHIEF_ACTIVE_AGENT_ID_KEY, 'agent-1']]],
    [setMultiSelectSidebarTabOrder(['context']), [[MULTISELECT_SIDEBAR_TAB_ORDER_KEY, ['context', 'overview']]]],
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
});