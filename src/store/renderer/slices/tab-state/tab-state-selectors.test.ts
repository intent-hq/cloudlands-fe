import { describe, expect, it } from 'vitest';
import type { StoreState } from '../../types';
import type { TabState } from './tab-state-slice';
import { selectPersistedWorkspaceTabsState, selectWorkspaceTabOrder } from './tab-state-selectors';

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
  viewMode: 'columns',
  version: 1,
};

const state = { tabState } as unknown as StoreState;

describe('tab state selectors', () => {
  it('derives flat workspace order from workspaceStacks', () => {
    expect(selectWorkspaceTabOrder.select(state)).toEqual(['ws-2', 'ws-1', 'ws-3']);
  });

  it('serializes the compatibility tabOrder from workspaceStacks', () => {
    expect(selectPersistedWorkspaceTabsState.select(state)).toMatchObject({
      tabOrder: ['ws-2', 'ws-1', 'ws-3'],
      workspaceStacks: [['ws-2', 'ws-1'], ['ws-3']],
    });
  });
});
