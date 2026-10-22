import { describe, expect, it } from 'vitest';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import type { StoreState } from '../../types';
import {
  acquireBrowserTabMount,
  releaseBrowserTabMount,
  requestBrowserTabRecovery,
  consumeBrowserTabRecovery,
  observeBrowserTabNavigation,
  consumeBrowserTabNavigation,
  tabStateReducer,
  type TabState,
} from './tab-state-slice';
import {
  selectActiveWorkspaceIds,
  selectMountedBrowserTabLeases,
  selectBrowserTabRecoveryRequests,
  selectBrowserTabNavigations,
  selectPersistedWorkspaceTabsState,
  selectWorkspaceTabOrder,
  selectWorkspaceTabsHydrated,
} from './tab-state-selectors';

const tabState: TabState = {
  isDragging: false,
  activeHandleDrop: null,
  scrollPositions: {},
  openTabs: { 'ws-1': true, 'ws-2': true, 'ws-3': true },
  currentTabId: 'ws-1',
  pinnedTabs: {},
  unsavedTabs: {},
  optimisticTabs: {},
  workspaceStacks: [['ws-2', 'ws-1'], ['ws-3']],
  recentlyClosedTabIds: [],
  recentlyClosedTabAt: {},
  version: 1,
  hydratedBackendId: null,
  mountedBrowserTabLeases: {},
  browserTabRecoveryRequests: {},
  browserTabNavigations: {},
};

const state = { tabState } as unknown as StoreState;

describe('tab state selectors', () => {
  it('exposes main navigation observations until the matching URL is consumed', () => {
    const pending = tabStateReducer(
      tabState,
      observeBrowserTabNavigation('tab-a', 'https://a.test/'),
    );
    expect(selectBrowserTabNavigations.select({ ...state, tabState: pending })).toEqual({
      'tab-a': { url: 'https://a.test/', kind: 'observed' },
    });
    const consumed = tabStateReducer(
      pending,
      consumeBrowserTabNavigation('tab-a', pending.browserTabNavigations['tab-a']),
    );
    expect(selectBrowserTabNavigations.select({ ...state, tabState: consumed })).toEqual({});
  });
  it('exposes pending recovery until its matching request is consumed', () => {
    const pending = tabStateReducer(tabState, requestBrowserTabRecovery('tab-a', 'req-1'));
    expect(selectBrowserTabRecoveryRequests.select({ ...state, tabState: pending })).toEqual({
      'tab-a': 'req-1',
    });
    const consumed = tabStateReducer(pending, consumeBrowserTabRecovery('tab-a', 'req-1'));
    expect(selectBrowserTabRecoveryRequests.select({ ...state, tabState: consumed })).toEqual({});
  });

  it('selects only currently leased browser mounts', () => {
    const mounted = tabStateReducer(tabState, acquireBrowserTabMount('browser-a', 'mount-1'));
    expect(selectMountedBrowserTabLeases.select({ ...state, tabState: mounted })).toEqual({
      'browser-a': { 'mount-1': true },
    });
    const released = tabStateReducer(mounted, releaseBrowserTabMount('browser-a', 'mount-1'));
    expect(selectMountedBrowserTabLeases.select({ ...state, tabState: released })).toEqual({});
  });

  it('selects open workspace IDs in openTabs object-key order', () => {
    const stateWithFlags = {
      tabState: {
        ...tabState,
        openTabs: { 'ws-2': true, 'ws-1': false, 'ws-3': true, 'ws-4': false },
        workspaceStacks: [['ws-1'], ['ws-2', 'ws-3']],
      },
    } as unknown as StoreState;

    expect(selectActiveWorkspaceIds.select(stateWithFlags)).toEqual(['ws-2', 'ws-3']);
  });

  it('returns no IDs when openTabs is empty', () => {
    const stateWithNoOpenTabs = {
      tabState: { ...tabState, openTabs: {} },
    } as unknown as StoreState;

    expect(selectActiveWorkspaceIds.select(stateWithNoOpenTabs)).toEqual([]);
  });

  it('derives flat workspace order from workspaceStacks', () => {
    expect(selectWorkspaceTabOrder.select(state)).toEqual(['ws-2', 'ws-1', 'ws-3']);
  });

  it('serializes the compatibility tabOrder from workspaceStacks', () => {
    expect(selectPersistedWorkspaceTabsState.select(state)).toMatchObject({
      tabOrder: ['ws-2', 'ws-1', 'ws-3'],
      workspaceStacks: [['ws-2', 'ws-1'], ['ws-3']],
    });
  });

  describe('selectWorkspaceTabsHydrated', () => {
    const withHydration = (
      hydratedBackendId: string | null,
      activeId: string = LOCAL_CONNECTION_ID,
    ): StoreState =>
      ({
        tabState: { ...tabState, hydratedBackendId },
        connections: { activeId, windowBackendId: activeId },
      }) as unknown as StoreState;

    it('is false before any hydration settles', () => {
      expect(selectWorkspaceTabsHydrated.select(withHydration(null))).toBe(false);
    });

    it('is true once hydration settled for the active backend', () => {
      expect(selectWorkspaceTabsHydrated.select(withHydration(LOCAL_CONNECTION_ID))).toBe(true);
    });

    it('is false when hydration settled for a DIFFERENT backend (switch in flight)', () => {
      expect(
        selectWorkspaceTabsHydrated.select(withHydration(LOCAL_CONNECTION_ID, 'remote-1')),
      ).toBe(false);
    });
  });
});
