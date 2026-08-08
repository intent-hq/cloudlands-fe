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
  openWorkspaceTab,
  removeScrollPosition,
  reorderWorkspaceTabs,
  saveScrollPosition,
  switchToNextWorkspaceTab,
  switchToPreviousWorkspaceTab,
  switchToWorkspaceTabByIndex,
  TAB_SCROLL_POSITIONS_STORAGE_KEY,
  toggleWorkspaceTabPin,
  unmarkWorkspaceTabOptimistic,
  WORKSPACE_TABS_STORAGE_KEY,
} from '../tab-state-slice';
import { tabStateSaga } from './tab-state-saga';

const persistedTabs = {
  openTabs: ['ws-1'],
  currentTabId: 'ws-1',
  pinnedTabs: ['ws-1'],
  unsavedTabs: [],
  optimisticTabs: ['optimistic-1'],
  tabOrder: ['ws-1'],
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
  },
  workspace: { hasLoaded: true },
};

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
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('ignores missing and malformed storage without dispatching hydration', async () => {
    storage.getJSON.mockImplementation((key: string) =>
      key === TAB_SCROLL_POSITIONS_STORAGE_KEY ? { tab: Number.NaN } : { openTabs: 'bad' },
    );
    const dispatch = vi.fn();
    const task = runSaga({ channel: stdChannel(), dispatch, getState: () => state }, tabStateSaga);
    await settle();

    expect(dispatch.mock.calls).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it.each([
    openWorkspaceTab('ws-1'),
    closeWorkspaceTab('ws-1'),
    clearCurrentWorkspaceTab(),
    cleanupInvalidWorkspaceTabs(['ws-1']),
    toggleWorkspaceTabPin('ws-1'),
    markWorkspaceTabUnsaved('ws-1', true),
    reorderWorkspaceTabs('ws-1', 'ws-2'),
    markWorkspaceTabOptimistic('optimistic-1'),
    unmarkWorkspaceTabOptimistic('optimistic-1'),
    handleOptimisticWorkspaceTabTransition('optimistic-1', 'ws-1'),
    switchToNextWorkspaceTab(),
    switchToPreviousWorkspaceTab(),
    switchToWorkspaceTabByIndex(0),
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
});