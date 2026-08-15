import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { describe, expect, it } from 'vitest';
import { resetWorkspaceState } from '../workspace/workspace-slice';
import {
  closeSwitcher,
  confirmSelection,
  cycleNext,
  cyclePrevious,
  initialState,
  openSwitcher,
  workspaceSwitcherReducer,
} from './workspace-switcher-slice';
import {
  selectSelectedWorkspaceId,
  selectSwitcherState,
  selectSwitcherWorkspaceIds,
} from './workspace-switcher-selectors';

describe('workspaceSwitcherReducer', () => {
  it('returns the initial state', () => {
    expect(workspaceSwitcherReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('opens on the next workspace when the active workspace is first', () => {
    const next = workspaceSwitcherReducer(
      initialState,
      openSwitcher(['ws-2', 'ws-3', 'ws-1'], 'ws-2'),
    );

    expect(next).toEqual({ selectedIndex: 1, selectionHandled: false });
    expect(workspaceSwitcherReducer(next, openSwitcher(['ws-2', 'ws-3'], 'ws-2'))).toBe(next);
  });

  it('opens at the first entry when the active workspace is absent and ignores empty lists', () => {
    const next = workspaceSwitcherReducer(initialState, openSwitcher(['ws-3', 'ws-1'], 'ws-2'));
    expect(next).toEqual({ selectedIndex: 0, selectionHandled: false });
    expect(workspaceSwitcherReducer(initialState, openSwitcher([], 'ws-2'))).toBe(initialState);
  });

  it('cycles in both directions with wrapping', () => {
    let state = workspaceSwitcherReducer(
      initialState,
      openSwitcher(['ws-1', 'ws-2', 'ws-3'], 'ws-1'),
    );
    state = workspaceSwitcherReducer(state, cycleNext(3));
    expect(state.selectedIndex).toBe(2);
    state = workspaceSwitcherReducer(state, cycleNext(3));
    expect(state.selectedIndex).toBe(0);
    state = workspaceSwitcherReducer(state, cyclePrevious(3));
    expect(state.selectedIndex).toBe(2);
  });

  it('closes or confirms to the handled state and keeps closed actions as no-ops', () => {
    const open = workspaceSwitcherReducer(initialState, openSwitcher(['ws-1', 'ws-2'], 'ws-1'));
    expect(workspaceSwitcherReducer(open, closeSwitcher())).toEqual(initialState);
    expect(workspaceSwitcherReducer(open, confirmSelection())).toEqual(initialState);
    expect(workspaceSwitcherReducer(initialState, closeSwitcher())).toBe(initialState);
    expect(workspaceSwitcherReducer(initialState, confirmSelection())).toBe(initialState);
    expect(workspaceSwitcherReducer(initialState, cycleNext(2))).toBe(initialState);
    expect(workspaceSwitcherReducer(initialState, cyclePrevious(2))).toBe(initialState);
  });

  it('resets with workspace state', () => {
    const open = workspaceSwitcherReducer(initialState, openSwitcher(['ws-1', 'ws-2'], 'ws-1'));
    expect(workspaceSwitcherReducer(open, resetWorkspaceState())).toEqual(initialState);
  });
});

describe('workspace switcher selectors', () => {
  function stateWith(selectedIndex: number, selectionHandled: boolean) {
    return {
      tabState: { currentTabId: 'ws-1' },
      workspace: {
        recency: { lastViewedAt: { 'ws-2': 20, 'ws-1': 10, 'ws-3': 5 } },
        workspaces: createCollection(
          'id',
          ['ws-1', 'ws-2', 'ws-3'].map((id) => ({
            id,
            title: id,
            path: `/tmp/${id}`,
            branch: 'main',
            changesets: [],
            timeline: [],
            conversationInfo: [],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            status: 'active',
          })),
        ),
      },
      workspaceSwitcher: { selectedIndex, selectionHandled },
    };
  }

  it('selects the ordered workspace ids and current selection while open', () => {
    const state = stateWith(1, false);
    expect(selectSwitcherState.select(state as never)).toEqual(state.workspaceSwitcher);
    expect(
      selectSwitcherWorkspaceIds.select(state as never, state.tabState.currentTabId),
    ).toEqual(['ws-1', 'ws-2', 'ws-3']);
    expect(
      selectSelectedWorkspaceId.select(state as never, state.tabState.currentTabId),
    ).toBe('ws-2');
  });

  it('returns no ids while closed and null for an out-of-range selection', () => {
    const closed = stateWith(0, true);
    expect(
      selectSwitcherWorkspaceIds.select(closed as never, closed.tabState.currentTabId),
    ).toEqual([]);
    const outOfRange = stateWith(3, false);
    expect(
      selectSelectedWorkspaceId.select(outOfRange as never, outOfRange.tabState.currentTabId),
    ).toBeNull();
  });
});
