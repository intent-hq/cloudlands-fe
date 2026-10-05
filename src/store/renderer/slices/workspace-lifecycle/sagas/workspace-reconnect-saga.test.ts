import { runSaga, stdChannel } from 'redux-saga';
import { all, call } from 'typed-redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Workspace } from '$shared/types';
import { openWorkspaceTab, tabStateReducer } from '../../tab-state/tab-state-slice';
import { setWorkspaceEntity, workspaceReducer } from '../../workspace/workspace-slice';
import {
  backendReconnected,
  workspaceDeleted,
  workspaceLoadRequested,
  workspaceLifecycleReducer,
} from '../workspace-lifecycle-slice';
import { workspaceLoadSaga } from './workspace-load-saga';
import { workspaceReconnectSaga } from './workspace-reconnect-saga';

const mocks = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    listeners,
    open: vi.fn(),
    get: vi.fn(),
    unregister: vi.fn(),
    emitReconnect: () => {
      for (const listener of [...listeners]) listener();
    },
  };
});
vi.mock('../../workspace/utils/workspace.client', () => ({
  workspaceClient: { open: mocks.open },
}));
vi.mock('$lib/client', () => ({
  appClient: { workspaces: { get: mocks.get } },
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  onBackendReconnected: (listener: () => void) => {
    mocks.listeners.add(listener);
    return () => {
      mocks.listeners.delete(listener);
      mocks.unregister();
    };
  },
}));

const settle = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

function createHarness() {
  let tabState = tabStateReducer(undefined, { type: '@@INIT' });
  let workspaceState = workspaceReducer(undefined, { type: '@@INIT' });
  let lifecycleState = workspaceLifecycleReducer(undefined, { type: '@@INIT' });
  const channel = stdChannel();
  const actions: Array<{ type: string; payload?: unknown[] }> = [];
  const dispatch = (action: { type: string; payload?: unknown[] }) => {
    tabState = tabStateReducer(tabState, action as never);
    workspaceState = workspaceReducer(workspaceState, action as never);
    lifecycleState = workspaceLifecycleReducer(lifecycleState, action as never);
    actions.push(action);
    channel.put(action);
    return action;
  };
  const getState = () => ({
    tabState,
    workspace: workspaceState,
    workspaceLifecycle: lifecycleState,
  });
  const task = runSaga({ channel, dispatch, getState }, function* () {
    yield* all([call(workspaceReconnectSaga), call(workspaceLoadSaga)]);
  });
  return { actions, task, dispatch, getState };
}

function workspace(id: string): Workspace {
  return {
    id,
    title: id,
    branch: 'main',
    repositoryPath: '/repo',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: 'Active',
    createdAt: '2026-09-14T00:00:00.000Z',
    updatedAt: '2026-09-14T00:00:00.000Z',
  } as Workspace;
}

describe('workspaceReconnectSaga', () => {
  beforeEach(() => {
    mocks.listeners.clear();
    mocks.unregister.mockReset();
    mocks.open.mockReset();
    mocks.get.mockReset();
  });

  it.each([false, true])('recovers the selected failed workspace (cached=%s)', async (cached) => {
    const opened = workspace('startup-space');
    mocks.open.mockResolvedValueOnce({ ok: false, error: 'connect ENOENT intentd.sock' });
    mocks.open.mockResolvedValueOnce({ ok: true, data: opened });
    const run = createHarness();
    run.dispatch(openWorkspaceTab(opened.id));
    if (cached) run.dispatch(setWorkspaceEntity(opened));
    run.dispatch(workspaceLoadRequested(opened.id));
    await settle();
    expect(run.getState().workspaceLifecycle.loadByWorkspaceId[opened.id]?.status).toBe(
      cached ? 'cached-ready' : 'error',
    );

    mocks.emitReconnect();
    mocks.emitReconnect();
    await settle();
    expect(mocks.open).toHaveBeenCalledTimes(2);
    expect(run.getState().workspaceLifecycle.loadByWorkspaceId[opened.id]).toEqual({
      status: 'ready',
      error: null,
    });
    mocks.emitReconnect();
    await settle();
    expect(mocks.open).toHaveBeenCalledTimes(2);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('does not reopen a failed workspace after selecting another tab or deleting it', async () => {
    mocks.open.mockResolvedValue({ ok: false, error: 'connect ENOENT intentd.sock' });
    const run = createHarness();
    run.dispatch(openWorkspaceTab('startup-space'));
    run.dispatch(workspaceLoadRequested('startup-space'));
    await settle();
    run.dispatch(openWorkspaceTab('another-space'));
    expect(run.getState().tabState.currentTabId).toBe('another-space');
    mocks.emitReconnect();
    await settle();
    expect(mocks.open).toHaveBeenCalledOnce();

    run.dispatch(openWorkspaceTab('startup-space'));
    run.dispatch(workspaceDeleted('startup-space', []));
    mocks.emitReconnect();
    await settle();
    expect(mocks.open).toHaveBeenCalledOnce();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('dispatches backendReconnected on every transport reconnect', async () => {
    const run = createHarness();
    await settle();
    expect(run.actions).toEqual([]);

    mocks.emitReconnect();
    await settle();
    mocks.emitReconnect();
    await settle();

    expect(run.actions).toEqual([backendReconnected(), backendReconnected()]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('unregisters the transport listener when cancelled', async () => {
    const run = createHarness();
    await settle();
    expect(mocks.listeners.size).toBe(1);

    run.task.cancel();
    await run.task.toPromise();

    expect(mocks.listeners.size).toBe(0);
    expect(mocks.unregister).toHaveBeenCalledOnce();
  });
});
