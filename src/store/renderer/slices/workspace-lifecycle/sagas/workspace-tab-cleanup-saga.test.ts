import { describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

import {
  closeWorkspaceTab,
  openWorkspaceTab,
  tabStateReducer,
} from '../../tab-state/tab-state-slice';
import {
  workspaceDeleted,
  workspaceHydrationRequested,
  workspaceUnmounted,
} from '../workspace-lifecycle-slice';
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

function lifecycleActions(harness: ReturnType<typeof createHarness>) {
  return harness.dispatch.mock.calls
    .map(([action]) => action)
    .filter(
      (action) =>
        action.type === workspaceUnmounted.type || action.type === workspaceHydrationRequested.type,
    );
}

describe('workspaceTabCleanupSaga', () => {
  it('hydrates the initially focused workspace', async () => {
    const harness = createHarness(['ws-A', 'ws-B']);
    await settle();

    expect(lifecycleActions(harness)).toEqual([workspaceHydrationRequested('ws-B')]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('emits exact lifecycle actions for A → B → A focus changes', async () => {
    const harness = createHarness(['ws-B', 'ws-A']);
    await settle();

    harness.dispatch(openWorkspaceTab('ws-B'));
    await settle();
    harness.dispatch(openWorkspaceTab('ws-A'));
    await settle();

    expect(lifecycleActions(harness)).toEqual([
      workspaceHydrationRequested('ws-A'),
      workspaceUnmounted('ws-A'),
      workspaceHydrationRequested('ws-B'),
      workspaceUnmounted('ws-B'),
      workspaceHydrationRequested('ws-A'),
    ]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('does not emit another lifecycle action for same-tab selection', async () => {
    const harness = createHarness(['ws-A']);
    await settle();
    harness.dispatch(openWorkspaceTab('ws-A'));
    await settle();

    expect(lifecycleActions(harness)).toEqual([workspaceHydrationRequested('ws-A')]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('unmounts an actively closed workspace once before hydrating the next focus', async () => {
    const harness = createHarness(['ws-A', 'ws-B']);
    await settle();
    harness.dispatch(closeWorkspaceTab('ws-B', 1));
    await settle();

    expect(lifecycleActions(harness)).toEqual([
      workspaceHydrationRequested('ws-B'),
      workspaceUnmounted('ws-B'),
      workspaceHydrationRequested('ws-A'),
    ]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('unmounts a background workspace when its tab closes', async () => {
    const harness = createHarness(['ws-A', 'ws-B']);
    await settle();
    harness.dispatch(closeWorkspaceTab('ws-A', 1));
    await settle();

    expect(lifecycleActions(harness)).toEqual([
      workspaceHydrationRequested('ws-B'),
      workspaceUnmounted('ws-A'),
    ]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('unmounts a background workspace when it is deleted', async () => {
    const harness = createHarness(['ws-A', 'ws-B']);
    await settle();
    harness.dispatch(workspaceDeleted('ws-A', []));
    await settle();

    expect(lifecycleActions(harness)).toEqual([
      workspaceHydrationRequested('ws-B'),
      workspaceUnmounted('ws-A'),
    ]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('hydrates a recreated same-ID workspace after background deletion', async () => {
    const harness = createHarness(['ws-A', 'ws-B']);
    await settle();
    harness.dispatch(workspaceDeleted('ws-A', []));
    await settle();
    harness.dispatch(openWorkspaceTab('ws-A'));
    await settle();

    expect(lifecycleActions(harness)).toEqual([
      workspaceHydrationRequested('ws-B'),
      workspaceUnmounted('ws-A'),
      workspaceUnmounted('ws-B'),
      workspaceHydrationRequested('ws-A'),
    ]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('does not unmount twice when active deletion is followed by tab removal', async () => {
    const harness = createHarness(['ws-A', 'ws-B']);
    await settle();
    harness.dispatch(workspaceDeleted('ws-B', []));
    await settle();
    harness.dispatch(closeWorkspaceTab('ws-B', 1));
    await settle();

    expect(lifecycleActions(harness)).toEqual([
      workspaceHydrationRequested('ws-B'),
      workspaceUnmounted('ws-B'),
      workspaceHydrationRequested('ws-A'),
    ]);
    harness.task.cancel();
    await harness.task.toPromise();
  });
});
