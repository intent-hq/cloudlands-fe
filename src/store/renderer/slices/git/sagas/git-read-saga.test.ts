import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
});
