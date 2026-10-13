import type { StoreAction } from '@themislib/themis/types';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackendGitReadRuntime } from '$lib/client/live/backend-git-read-runtime';
import type { GitStatus } from '$shared/types';
import { reserveGitMutation } from '../../../utils/worktree-mutation-queue';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  getGitWorkspaceState,
  gitReducer,
  initialState,
  loadGitStatus,
  setGitStatus,
  setGitStatusLoading,
} from '../git-slice';
import { createGitStatusReadSaga } from './git-status-read-saga-factory';

const status: GitStatus = {
  branch: 'feature',
  ahead: 2,
  behind: 1,
  diverged: true,
  files: [{ path: 'src/changed.ts', status: 'M', staged: false }],
  hasUncommittedChanges: true,
  hasUntrackedFiles: false,
};
const tasks: Task[] = [];
afterEach(async () => {
  for (const task of tasks.splice(0)) {
    task.cancel();
    await task.toPromise();
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function start(
  readStatus: Parameters<typeof createGitStatusReadSaga>[0]['readStatus'],
  options: {
    context?: string | null;
    onDispatch?: (action: StoreAction<unknown>) => void;
    onError?: (error: unknown) => void;
  } = {},
) {
  const channel = stdChannel();
  const actions: StoreAction<unknown>[] = [];
  let state = initialState;
  let context = options.context === undefined ? 'connection-1' : options.context;
  const dispatch = (action: StoreAction<unknown>) => {
    state = gitReducer(state, action);
    actions.push(action);
    options.onDispatch?.(action);
    channel.put(action);
    return action;
  };
  const task = runSaga(
    { channel, dispatch },
    createGitStatusReadSaga({
      readStatus,
      admission: { readCurrentContext: () => context, dispatch },
      reportReadState: true,
      onError: options.onError,
    }),
  );
  tasks.push(task);
  return {
    dispatch,
    actions,
    state: () => state,
    workspace: (workspaceId = 'ws') => getGitWorkspaceState(state, workspaceId),
    changeContext: (next: string | null) => (context = next),
  };
}

describe('createGitStatusReadSaga', () => {
  it('binds the backend status runtime with exact ordinary/forced wire requests and existing state', async () => {
    const first = deferred<GitStatus>();
    const request = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(status);
    const runtime = createBackendGitReadRuntime({ request });
    const owner = start(runtime.status);
    owner.dispatch(loadGitStatus('ws'));
    expect(request).toHaveBeenCalledExactlyOnceWith('git.status', { workspaceId: 'ws' });
    expect(owner.workspace()).toMatchObject({ loading: true, error: null, status: null });
    first.resolve(status);
    await settle();
    expect(owner.workspace()).toMatchObject({ loading: false, error: null, status });

    owner.dispatch(loadGitStatus('ws', true));
    await settle();
    expect(request).toHaveBeenNthCalledWith(2, 'git.status', {
      workspaceId: 'ws',
      forceRefresh: true,
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(owner.workspace()).toMatchObject({ loading: false, error: null, status });
  });

  it('settles a swallowed backend failure as an error and clears it on an explicit retry', async () => {
    const retry = deferred<GitStatus>();
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockReturnValueOnce(retry.promise);
    const owner = start(createBackendGitReadRuntime({ request }).status);
    owner.dispatch(loadGitStatus('ws'));
    await settle();
    expect(owner.workspace()).toMatchObject({ loading: false, status: null });
    expect(owner.workspace().error).toEqual(expect.any(String));
    expect(owner.workspace().error?.length).toBeGreaterThan(0);
    owner.dispatch(loadGitStatus('ws'));
    expect(owner.workspace()).toMatchObject({ loading: true, error: null });
    retry.resolve(status);
    await settle();
    expect(owner.workspace()).toMatchObject({ loading: false, error: null, status });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('retains the last snapshot when the current transport rejects', async () => {
    const owner = start(vi.fn().mockRejectedValue(new Error('read failed')));
    owner.dispatch(setGitStatus('ws', status));
    owner.dispatch(loadGitStatus('ws'));
    await settle();
    expect(owner.workspace()).toMatchObject({ loading: false, error: 'read failed', status });
  });

  it('does not start an unadmitted read or write loading state', async () => {
    const readStatus = vi.fn();
    const owner = start(readStatus, { context: null });
    owner.dispatch(loadGitStatus('ws'));
    await settle();
    expect(readStatus).not.toHaveBeenCalled();
    expect(owner.state()).toBe(initialState);
  });

  it('checks admission again after publishing loading and before starting transport', async () => {
    const readStatus = vi.fn();
    const owner = start(readStatus, {
      onDispatch: (action) => {
        if (action.type === setGitStatusLoading.type) owner.changeContext(null);
      },
    });
    owner.dispatch(loadGitStatus('ws'));
    await settle();
    expect(readStatus).not.toHaveBeenCalled();
    owner.dispatch(workspaceUnmounted('ws'));
    expect(owner.state().byWorkspaceId.ws).toBeUndefined();
  });

  it('does not start transport after admission is replaced while waiting for mutations', async () => {
    const lease = reserveGitMutation('ws');
    const readStatus = vi.fn();
    const owner = start(readStatus);
    try {
      await lease.ready;
      owner.dispatch(loadGitStatus('ws'));
      expect(owner.workspace().loading).toBe(true);
      expect(readStatus).not.toHaveBeenCalled();
      owner.changeContext('connection-2');
      await lease.release();
      await settle();
      expect(readStatus).not.toHaveBeenCalled();
    } finally {
      await lease.release();
    }
  });

  for (const result of ['success', 'failure'] as const) {
    it(`discards an in-flight ${result} after admission is replaced`, async () => {
      const pending = deferred<GitStatus>();
      const onError = vi.fn();
      const owner = start(() => pending.promise, { onError });
      owner.dispatch(loadGitStatus('ws'));
      const admitted = owner.state();
      owner.changeContext('connection-2');
      if (result === 'success') pending.resolve(status);
      else pending.reject(new Error('obsolete error'));
      await settle();
      expect(owner.state()).toBe(admitted);
      expect(onError).not.toHaveBeenCalled();
      owner.dispatch(workspaceUnmounted('ws'));
      expect(owner.state().byWorkspaceId.ws).toBeUndefined();
    });
  }

  it('fences the error dispatch if reporting the failure retires admission', async () => {
    const owner = start(vi.fn().mockRejectedValue(new Error('read failed')), {
      onError: () => owner.changeContext(null),
    });
    owner.dispatch(loadGitStatus('ws'));
    const admitted = owner.state();
    await settle();
    expect(owner.state()).toBe(admitted);
  });

  for (const result of ['success', 'failure'] as const) {
    it(`retries a ${result} overlapping a mutation before publishing`, async () => {
      const first = deferred<GitStatus>();
      const readStatus = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(status);
      const owner = start(readStatus);
      owner.dispatch(loadGitStatus('ws', true));
      const lease = reserveGitMutation('ws');
      try {
        await lease.ready;
        if (result === 'success') first.resolve({ ...status, branch: 'obsolete' });
        else first.reject(new Error('obsolete error'));
        await settle();
        expect(owner.workspace()).toMatchObject({ loading: true, error: null, status: null });
        expect(readStatus).toHaveBeenCalledTimes(1);
        await lease.release();
        await settle();
        expect(readStatus).toHaveBeenCalledTimes(2);
        expect(readStatus).toHaveBeenNthCalledWith(2, 'ws', { forceRefresh: true });
        expect(owner.workspace()).toMatchObject({ loading: false, error: null, status });
      } finally {
        await lease.release();
      }
    });
  }

  it('coalesces a burst, cancels its trailing read on unmount, and admits a fresh mount', async () => {
    const first = deferred<GitStatus>();
    const readStatus = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(status);
    const owner = start(readStatus);
    owner.dispatch(loadGitStatus('ws'));
    owner.dispatch(loadGitStatus('ws'));
    owner.dispatch(loadGitStatus('ws', true));
    expect(readStatus).toHaveBeenCalledTimes(1);
    owner.dispatch(workspaceUnmounted('ws'));
    first.resolve({ ...status, branch: 'obsolete' });
    await settle();
    expect(readStatus).toHaveBeenCalledTimes(1);
    expect(owner.state().byWorkspaceId.ws).toBeUndefined();
    owner.dispatch(loadGitStatus('ws'));
    await settle();
    expect(readStatus).toHaveBeenCalledTimes(2);
    expect(owner.workspace()).toMatchObject({ loading: false, error: null, status });
  });

  it('restarts in the same turn after unmount even when the backend shares the pending transport', async () => {
    const pending = deferred<GitStatus>();
    const request = vi.fn().mockReturnValue(pending.promise);
    const runtime = createBackendGitReadRuntime({ request });
    const readStatus = vi.fn(runtime.status);
    const owner = start(readStatus);
    owner.dispatch(loadGitStatus('ws'));
    owner.dispatch(workspaceUnmounted('ws'));
    expect(owner.state().byWorkspaceId.ws).toBeUndefined();
    owner.dispatch(loadGitStatus('ws'));
    expect(readStatus).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledExactlyOnceWith('git.status', { workspaceId: 'ws' });
    expect(owner.workspace()).toMatchObject({ loading: true, error: null, status: null });

    pending.resolve(status);
    await settle();
    expect(owner.workspace()).toMatchObject({ loading: false, error: null, status });
    expect(owner.actions.filter((action) => action.type === setGitStatus.type)).toHaveLength(1);
  });
});
