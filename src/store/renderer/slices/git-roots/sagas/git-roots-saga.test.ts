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
  clearActiveWorkspace,
  initialState as workspaceInitialState,
  setActiveWorkspaceId,
  workspaceReducer,
} from '../../workspace/workspace-slice';
import { gitRootsSaga } from './git-roots-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function createHarness(activeWorkspaceId: string | null = null) {
  const initialWorkspaceState = activeWorkspaceId
    ? workspaceReducer(workspaceInitialState, setActiveWorkspaceId(activeWorkspaceId))
    : workspaceInitialState;
  let state = { workspace: initialWorkspaceState, gitRoots: initialState };
  const channel = stdChannel();
  const listeners = new Set<() => void>();
  const dispatch = vi.fn((action: Parameters<typeof gitRootsReducer>[1]) => {
    state = {
      workspace: workspaceReducer(state.workspace, action),
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

  it('subscribes to the initial active workspace after 100 ms and forwards rows', async () => {
    const harness = createHarness('ws-A');
    await settle();

    await vi.advanceTimersByTimeAsync(99);
    expect(mocks.subscribeGitRoots).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(mocks.subscribeGitRoots).toHaveBeenCalledTimes(1);
    expect(mocks.subscribeGitRoots.mock.calls[0][0]).toBe('ws-A');

    const root = { id: 'root-1', workspaceId: 'ws-A', path: '/x', source: 'agent' } as GitRootRow;
    const emit = mocks.subscribeGitRoots.mock.calls[0][1] as (rows: GitRootRow[]) => void;
    emit([root]);
    await settle();
    expect(harness.getState().gitRoots.byWorkspaceId['ws-A'].gitRoots.map['root-1']).toBe(root);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('switches A to B exactly once after the trailing delay', async () => {
    const harness = createHarness('ws-A');
    await settle();
    await advanceReconciliation();
    const disposeA = mocks.subscribeGitRoots.mock.results[0].value.dispose as ReturnType<
      typeof vi.fn
    >;

    harness.dispatch(setActiveWorkspaceId('ws-B'));
    await settle();
    await vi.advanceTimersByTimeAsync(99);
    expect(disposeA).not.toHaveBeenCalled();
    expect(mocks.subscribeGitRoots).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();

    expect(disposeA).toHaveBeenCalledOnce();
    expect(mocks.subscribeGitRoots.mock.calls.map(([workspaceId]) => workspaceId)).toEqual([
      'ws-A',
      'ws-B',
    ]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('avoids churn when an A to B to A burst restores the live workspace', async () => {
    const harness = createHarness('ws-A');
    await settle();
    await advanceReconciliation();
    const disposeA = mocks.subscribeGitRoots.mock.results[0].value.dispose as ReturnType<
      typeof vi.fn
    >;

    harness.dispatch(setActiveWorkspaceId('ws-B'));
    await settle();
    await vi.advanceTimersByTimeAsync(50);
    harness.dispatch(setActiveWorkspaceId('ws-A'));
    await settle();
    await advanceReconciliation();

    expect(mocks.subscribeGitRoots).toHaveBeenCalledTimes(1);
    expect(disposeA).not.toHaveBeenCalled();
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('disposes the live subscription when the active workspace is cleared', async () => {
    const harness = createHarness('ws-A');
    await settle();
    await advanceReconciliation();
    const disposeA = mocks.subscribeGitRoots.mock.results[0].value.dispose as ReturnType<
      typeof vi.fn
    >;

    harness.dispatch(clearActiveWorkspace());
    await settle();
    await advanceReconciliation();

    expect(disposeA).toHaveBeenCalledOnce();
    expect(mocks.subscribeGitRoots).toHaveBeenCalledTimes(1);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('closes the live subscription and selector listener on root cancellation', async () => {
    const harness = createHarness('ws-A');
    await settle();
    await advanceReconciliation();

    harness.task.cancel();
    await harness.task.toPromise();

    expect(mocks.subscribeGitRoots.mock.results[0].value.dispose).toHaveBeenCalledOnce();
    expect(harness.listeners.size).toBe(0);
  });
});
