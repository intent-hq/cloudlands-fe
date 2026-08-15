import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({ subscribeGitRoots: vi.fn() }));
vi.mock('$features/git-roots/git-roots-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$features/git-roots/git-roots-service')>();
  return { ...actual, subscribeGitRoots: mocks.subscribeGitRoots };
});

import type { GitRootRow } from '$features/git-roots/git-roots-service';
import { gitRootsReducer, initialState } from '../git-roots-slice';
import {
  closeWorkspaceTab,
  openWorkspaceTab,
  tabStateReducer,
} from '../../tab-state/tab-state-slice';
import { gitRootsSaga } from './git-roots-saga';

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
  let state = { tabState: initialTabState, gitRoots: initialState };
  const channel = stdChannel();
  const listeners = new Set<() => void>();
  const dispatch = vi.fn((action: Parameters<typeof tabStateReducer>[1]) => {
    state = {
      tabState: tabStateReducer(state.tabState, action),
      gitRoots: gitRootsReducer(state.gitRoots, action),
    };
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
    gitRootsSaga,
  );
  return { dispatch, getState: reduxStore.getState, listeners, task };
}

async function advanceReconciliation() {
  await vi.advanceTimersByTimeAsync(100);
  await settle();
}

describe('gitRootsSaga', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.subscribeGitRoots.mockImplementation(() => ({ dispose: vi.fn() }));
  });

  afterEach(() => vi.useRealTimers());

  it('subscribes to every initially open workspace after 100 ms', async () => {
    const harness = createHarness(['ws-A', 'ws-B']);
    await settle();

    await vi.advanceTimersByTimeAsync(99);
    expect(mocks.subscribeGitRoots).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(mocks.subscribeGitRoots.mock.calls.map(([workspaceId]) => workspaceId)).toEqual([
      'ws-A',
      'ws-B',
    ]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('adds and removes subscriptions without churning retained workspaces', async () => {
    const harness = createHarness(['ws-A', 'ws-B']);
    await settle();
    await advanceReconciliation();
    const disposeA = mocks.subscribeGitRoots.mock.results[0].value.dispose as ReturnType<
      typeof vi.fn
    >;
    const disposeB = mocks.subscribeGitRoots.mock.results[1].value.dispose as ReturnType<
      typeof vi.fn
    >;

    harness.dispatch(openWorkspaceTab('ws-C'));
    await settle();
    await vi.advanceTimersByTimeAsync(99);
    expect(mocks.subscribeGitRoots).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await settle();

    expect(mocks.subscribeGitRoots.mock.calls.map(([workspaceId]) => workspaceId)).toEqual([
      'ws-A',
      'ws-B',
      'ws-C',
    ]);
    const disposeC = mocks.subscribeGitRoots.mock.results[2].value.dispose as ReturnType<
      typeof vi.fn
    >;
    expect(disposeA).not.toHaveBeenCalled();
    expect(disposeB).not.toHaveBeenCalled();

    harness.dispatch(closeWorkspaceTab('ws-B', 1));
    await settle();
    await advanceReconciliation();

    expect(disposeA).not.toHaveBeenCalled();
    expect(disposeB).toHaveBeenCalledOnce();
    expect(disposeC).not.toHaveBeenCalled();
    expect(mocks.subscribeGitRoots).toHaveBeenCalledTimes(3);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('trails a burst of tab changes and reconciles only the final open set', async () => {
    const harness = createHarness(['ws-A']);
    await settle();
    await advanceReconciliation();
    const disposeA = mocks.subscribeGitRoots.mock.results[0].value.dispose as ReturnType<
      typeof vi.fn
    >;

    harness.dispatch(openWorkspaceTab('ws-B'));
    await settle();
    await vi.advanceTimersByTimeAsync(50);
    harness.dispatch(openWorkspaceTab('ws-C'));
    await settle();
    await vi.advanceTimersByTimeAsync(99);

    expect(mocks.subscribeGitRoots).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();

    expect(mocks.subscribeGitRoots.mock.calls.map(([workspaceId]) => workspaceId)).toEqual([
      'ws-A',
      'ws-B',
      'ws-C',
    ]);
    expect(disposeA).not.toHaveBeenCalled();
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('disposes every subscription when no workspace tabs remain open', async () => {
    const harness = createHarness(['ws-A', 'ws-B']);
    await settle();
    await advanceReconciliation();
    const disposeA = mocks.subscribeGitRoots.mock.results[0].value.dispose as ReturnType<
      typeof vi.fn
    >;
    const disposeB = mocks.subscribeGitRoots.mock.results[1].value.dispose as ReturnType<
      typeof vi.fn
    >;

    harness.dispatch(closeWorkspaceTab('ws-A', 1));
    harness.dispatch(closeWorkspaceTab('ws-B', 2));
    await settle();
    await advanceReconciliation();

    expect(disposeA).toHaveBeenCalledOnce();
    expect(disposeB).toHaveBeenCalledOnce();
    expect(mocks.subscribeGitRoots).toHaveBeenCalledTimes(2);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('forwards subscription rows to the matching workspace state', async () => {
    const harness = createHarness(['ws-A', 'ws-B']);
    await settle();
    await advanceReconciliation();
    const root = { id: 'root-1', workspaceId: 'ws-B', path: '/x', source: 'agent' } as GitRootRow;
    const emitB = mocks.subscribeGitRoots.mock.calls[1][1] as (rows: GitRootRow[]) => void;

    emitB([root]);
    await settle();

    expect(harness.getState().gitRoots.byWorkspaceId['ws-B'].gitRoots.map['root-1']).toBe(root);
    expect(harness.getState().gitRoots.byWorkspaceId['ws-A']).toBeUndefined();
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('closes all live subscriptions and the selector listener on root cancellation', async () => {
    const harness = createHarness(['ws-A', 'ws-B']);
    await settle();
    await advanceReconciliation();

    harness.task.cancel();
    await harness.task.toPromise();

    expect(mocks.subscribeGitRoots.mock.results[0].value.dispose).toHaveBeenCalledOnce();
    expect(mocks.subscribeGitRoots.mock.results[1].value.dispose).toHaveBeenCalledOnce();
    expect(harness.listeners.size).toBe(0);
  });
});
