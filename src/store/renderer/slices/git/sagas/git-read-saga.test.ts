import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appClient } from '$lib/client';
import type { GitStatus } from '$shared/types';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { loadGitStatus, setGitStatus } from '../git-slice';
import { gitReadSaga } from './git-read-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('gitReadSaga', () => {
  // `gitReadSaga` always forks a `git.subscribe` watcher. Default it to a
  // no-op subscription so tests that don't exercise that path never touch the
  // real `LiveGitClient` (which fires actual daemon requests and shares
  // module-level state across tests); individual tests override this spy.
  beforeEach(() => {
    vi.spyOn(appClient.git, 'subscribe').mockReturnValue(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('maps the protocol response field by field', async () => {
    const wire = {
      branch: 'main',
      ahead: 2,
      behind: 1,
      diverged: true,
      files: [{ path: 'src/a.ts', status: 'modified', staged: false, wireOnly: 'drop' }],
      hasUncommittedChanges: true,
      hasUntrackedFiles: false,
      wireOnly: 'drop',
    } as unknown as GitStatus;
    vi.spyOn(appClient.git, 'status').mockResolvedValue(wire);
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, gitReadSaga);

    channel.put(loadGitStatus('ws-1'));
    await settle();

    expect(appClient.git.status).toHaveBeenCalledWith('ws-1');
    expect(actions).toEqual([
      setGitStatus('ws-1', {
        branch: 'main',
        ahead: 2,
        behind: 1,
        diverged: true,
        files: [{ path: 'src/a.ts', status: 'modified', staged: false }],
        hasUncommittedChanges: true,
        hasUntrackedFiles: false,
      }),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('coalesces reads and suppresses a late result after workspace cleanup', async () => {
    let resolve!: (status: GitStatus) => void;
    vi.spyOn(appClient.git, 'status').mockReturnValue(
      new Promise<GitStatus>((done) => {
        resolve = done;
      }),
    );
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, gitReadSaga);

    channel.put(loadGitStatus('ws-1'));
    channel.put(loadGitStatus('ws-1'));
    await settle();
    channel.put(workspaceUnmounted('ws-1'));
    resolve({
      branch: 'main',
      ahead: 0,
      behind: 0,
      diverged: false,
      files: [],
      hasUncommittedChanges: false,
      hasUntrackedFiles: false,
    });
    await settle();

    expect(appClient.git.status).toHaveBeenCalledTimes(1);
    expect(actions).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('refreshes the active workspace when a daemon git-change signal arrives', async () => {
    let notify: (() => void) | undefined;
    vi.spyOn(appClient.git, 'subscribe').mockImplementation((handler) => {
      notify = () => handler(null);
      return () => {};
    });
    const status: GitStatus = {
      branch: 'main',
      ahead: 0,
      behind: 0,
      diverged: false,
      files: [],
      hasUncommittedChanges: false,
      hasUntrackedFiles: false,
    };
    vi.spyOn(appClient.git, 'status').mockResolvedValue(status);
    const channel = stdChannel();
    const actions: unknown[] = [];
    // Mirrors production: the saga middleware feeds every dispatched action
    // back into the same channel, which is how `watchGitStatusSubscription`'s
    // `put(loadGitStatus(...))` reaches the sibling `take([loadGitStatus, ...])`
    // loop in the same saga.
    const dispatch = (action: { type: string }) => {
      actions.push(action);
      channel.put(action);
    };
    const task = runSaga(
      {
        channel,
        dispatch,
        getState: () => ({ workspace: { activeWorkspaceId: 'ws-active' } }),
      },
      gitReadSaga,
    );
    await settle();

    expect(notify).toBeDefined();
    notify!();
    await settle();

    expect(appClient.git.status).toHaveBeenCalledWith('ws-active');
    expect(actions).toEqual([loadGitStatus('ws-active', true), setGitStatus('ws-active', status)]);
    task.cancel();
    await task.toPromise();
  });

  it('does nothing on a git-change signal when no workspace is active', async () => {
    let notify: (() => void) | undefined;
    vi.spyOn(appClient.git, 'subscribe').mockImplementation((handler) => {
      notify = () => handler(null);
      return () => {};
    });
    vi.spyOn(appClient.git, 'status');
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga(
      {
        channel,
        dispatch: (action) => actions.push(action),
        getState: () => ({ workspace: { activeWorkspaceId: null } }),
      },
      gitReadSaga,
    );
    await settle();

    notify!();
    await settle();

    expect(appClient.git.status).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
    task.cancel();
    await task.toPromise();
  });
});
