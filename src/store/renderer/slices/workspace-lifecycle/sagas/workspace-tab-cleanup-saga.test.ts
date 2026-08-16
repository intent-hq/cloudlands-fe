import { describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

import {
  closeWorkspaceTab,
  cleanupInvalidWorkspaceTabs,
  openWorkspaceTab,
  reorderWorkspaceTabs,
  switchToNextWorkspaceTab,
  tabStateReducer,
  toggleWorkspaceTabPin,
} from '../../tab-state/tab-state-slice';
import { workspaceUnmounted } from '../workspace-lifecycle-slice';
import { workspaceTabCleanupSaga } from './workspace-tab-cleanup-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function createHarness(openWorkspaceIds: string[] = []) {
  const initialTabState = openWorkspaceIds.reduce(
    (state, workspaceId) => tabStateReducer(state, openWorkspaceTab(workspaceId)),
    tabStateReducer(undefined, { type: '@@INIT' }),
  );
  let state = { tabState: initialTabState };
  const channel = stdChannel();
  const listeners = new Set<() => void>();
  const dispatch = vi.fn((action: Parameters<typeof tabStateReducer>[1]) => {
    state = { tabState: tabStateReducer(state.tabState, action) };
    channel.put(action);
    for (const listener of listeners) listener();
    return action;
  });
  const reduxStore = {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const task = runSaga(
    { channel, dispatch, getState: reduxStore.getState, context: { reduxStore } },
    workspaceTabCleanupSaga,
  );
  return { dispatch, getState: reduxStore.getState, task };
}

function cleanupActions(harness: ReturnType<typeof createHarness>) {
  return harness.dispatch.mock.calls
    .map(([action]) => action)
    .filter((action) => action.type === workspaceUnmounted.type);
}

describe('workspaceTabCleanupSaga', () => {
  it('does not clean up during initial selector observation', async () => {
    const harness = createHarness(['ws-A', 'ws-B']);
    await settle();

    expect(cleanupActions(harness)).toEqual([]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('does not clean up when tabs are added, reordered, or pinned', async () => {
    const harness = createHarness(['ws-A', 'ws-B']);
    await settle();
    harness.dispatch(openWorkspaceTab('ws-C'));
    harness.dispatch(reorderWorkspaceTabs('ws-A', 'ws-B'));
    harness.dispatch(toggleWorkspaceTabPin('ws-A'));
    await settle();

    expect(cleanupActions(harness)).toEqual([]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('does not clean up when the active tab changes among open workspaces', async () => {
    const harness = createHarness(['ws-A', 'ws-B']);
    await settle();

    expect(harness.getState().tabState.currentTabId).toBe('ws-B');
    expect(Object.keys(harness.getState().tabState.openTabs)).toEqual(['ws-A', 'ws-B']);
    harness.dispatch(switchToNextWorkspaceTab());
    await settle();

    expect(harness.getState().tabState.currentTabId).toBe('ws-A');
    expect(Object.keys(harness.getState().tabState.openTabs)).toEqual(['ws-A', 'ws-B']);
    expect(cleanupActions(harness)).toEqual([]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('cleans up each workspace ID removed from the tab set once', async () => {
    const harness = createHarness(['ws-A', 'ws-B']);
    await settle();
    harness.dispatch(closeWorkspaceTab('ws-A', 1));
    await settle();

    expect(cleanupActions(harness)).toEqual([workspaceUnmounted('ws-A')]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('cleans up all workspace IDs removed in one transition', async () => {
    const harness = createHarness(['ws-A', 'ws-B', 'ws-C']);
    await settle();
    harness.dispatch(cleanupInvalidWorkspaceTabs(['ws-C']));
    await settle();

    expect(cleanupActions(harness)).toEqual([
      workspaceUnmounted('ws-A'),
      workspaceUnmounted('ws-B'),
    ]);
    harness.task.cancel();
    await harness.task.toPromise();
  });
});
