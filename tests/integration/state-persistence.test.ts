import {
  loadScrollPositions,
  loadWorkspaceTabsState,
  openWorkspaceTab,
  saveScrollPosition,
  serializeWorkspaceTabsState,
  tabStateReducer,
} from '$store/renderer/slices/tab-state/tab-state-slice';
import { describe, expect, it } from 'vitest';

function initialState() {
  return tabStateReducer(undefined, { type: '@@INIT' });
}

describe('State persistence across navigation', () => {
  it('serializes and restores workspace navigation state', () => {
    let state = tabStateReducer(initialState(), openWorkspaceTab('ws-1'));
    state = tabStateReducer(state, openWorkspaceTab('ws-2'));
    const persisted = serializeWorkspaceTabsState(state);
    const restored = tabStateReducer(initialState(), loadWorkspaceTabsState(persisted));

    expect(persisted).toMatchObject({
      openTabs: ['ws-1', 'ws-2'],
      currentTabId: 'ws-2',
      tabOrder: ['ws-1', 'ws-2'],
    });
    expect(restored).toMatchObject({
      openTabs: { 'ws-1': true, 'ws-2': true },
      currentTabId: 'ws-2',
      workspaceStacks: [['ws-1'], ['ws-2']],
    });
  });

  it('keeps per-tab scroll positions when navigation changes', () => {
    let state = tabStateReducer(initialState(), saveScrollPosition('agent-1', 500));
    state = tabStateReducer(state, saveScrollPosition('agent-2', 200));
    state = tabStateReducer(state, openWorkspaceTab('ws-2'));

    expect(state.scrollPositions).toEqual({ 'agent-1': 500, 'agent-2': 200 });
  });

  it('restores persisted scroll positions without inventing missing entries', () => {
    const restored = tabStateReducer(
      initialState(),
      loadScrollPositions({ 'agent-1': 450, 'agent-2': 125 }),
    );

    expect(restored.scrollPositions).toEqual({ 'agent-1': 450, 'agent-2': 125 });
    expect(restored.scrollPositions['agent-missing']).toBeUndefined();
  });
});
