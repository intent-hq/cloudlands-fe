import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backendRequest } from '$lib/client/live/backend-transport';
import { reserveGitMutation } from '../../../utils/worktree-mutation-queue';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  gitReducer,
  gitReadRequested,
  releaseGitRead,
  gitReadsInvalidated,
  openGitCommitFileRequested,
  openGitPRFileRequested,
} from '../git-slice';
import { selectGitRead } from '../git-selectors';
import { gitConsumerReadSaga } from './git-consumer-read-saga';

vi.mock('$lib/client/live/backend-transport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/client/live/backend-transport')>()),
  backendRequest: vi.fn(),
}));
vi.mock('$lib/client', async () => {
  const { LiveGitClient } = await import('$lib/client/live/live-git-client');
  return { appClient: { git: new LiveGitClient() } };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const details = {
  commitHash: 'sha',
  author: 'Test',
  authorEmail: 'test@example.com',
  date: '2026-09-29T00:00:00Z',
  message: 'change',
  files: ['a.ts'],
  fileDetails: [{ path: 'a.ts', additions: 2, deletions: 1 }],
};
type Action = Parameters<typeof gitReducer>[1];
const tasks: ReturnType<typeof runSaga>[] = [];
function start() {
  const channel = stdChannel();
  let state = { git: gitReducer(undefined, { type: 'test/init' }) };
  const actions: Action[] = [];
  const dispatch = (action: Action) => {
    state = { git: gitReducer(state.git, action) };
    actions.push(action);
    channel.put(action);
  };
  const task = runSaga({ channel, dispatch, getState: () => state }, gitConsumerReadSaga);
  tasks.push(task);
  return {
    dispatch,
    actions,
    read: (ws: string, consumer: string) =>
      selectGitRead.select(state as Parameters<typeof selectGitRead.select>[0], ws, consumer),
  };
}
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('gitConsumerReadSaga', () => {
  beforeEach(() => vi.mocked(backendRequest).mockReset());
  afterEach(async () => {
    for (const task of tasks.splice(0)) {
      task.cancel();
      await task.toPromise();
    }
  });

  it('shares one exact commit-details request and retains the remaining consumer on release', async () => {
    const response = deferred<typeof details>();
    vi.mocked(backendRequest).mockReturnValue(response.promise);
    const owner = start();
    owner.dispatch(
      gitReadRequested('ws', 'sidebar', 'a', { kind: 'commitDetails', commitHash: 'sha' }),
    );
    owner.dispatch(
      gitReadRequested('ws', 'tab', 'b', { kind: 'commitDetails', commitHash: 'sha' }),
    );
    expect(backendRequest).toHaveBeenCalledExactlyOnceWith('git.commitDetails', {
      workspaceId: 'ws',
      commitHash: 'sha',
    });
    owner.dispatch(releaseGitRead('ws', 'sidebar', 'a'));
    response.resolve(details);
    await vi.waitFor(() =>
      expect(owner.read('ws', 'tab')).toMatchObject({
        loading: false,
        requestId: 'b',
        result: { kind: 'commitDetails', details },
      }),
    );
    expect(owner.read('ws', 'sidebar')).toBeUndefined();
    owner.dispatch(releaseGitRead('ws', 'tab', 'b'));
    expect(owner.read('ws', 'tab')).toBeUndefined();
  });

  it('scopes show-file reads by workspace, root, path and ref', async () => {
    vi.mocked(backendRequest).mockImplementation(async (_method, params) => ({
      content: JSON.stringify(params),
    }));
    const owner = start();
    const request = { kind: 'showFile' as const, filePath: 'a.ts', ref: 'HEAD' };
    owner.dispatch(gitReadRequested('ws', 'primary', 'a', request));
    owner.dispatch(gitReadRequested('ws', 'root', 'b', { ...request, gitRootId: 'root' }));
    owner.dispatch(gitReadRequested('ws', 'index', 'c', { ...request, ref: ':0' }));
    owner.dispatch(gitReadRequested('ws', 'path', 'd', { ...request, filePath: 'b.ts' }));
    owner.dispatch(gitReadRequested('other', 'primary', 'e', request));
    await vi.waitFor(() => expect(owner.read('other', 'primary')?.loading).toBe(false));
    expect(vi.mocked(backendRequest).mock.calls).toEqual([
      ['git.showFile', { workspaceId: 'ws', filePath: 'a.ts', ref: 'HEAD' }],
      ['git.showFile', { workspaceId: 'ws', filePath: 'a.ts', ref: 'HEAD', gitRootId: 'root' }],
      ['git.showFile', { workspaceId: 'ws', filePath: 'a.ts', ref: ':0' }],
      ['git.showFile', { workspaceId: 'ws', filePath: 'b.ts', ref: 'HEAD' }],
      ['git.showFile', { workspaceId: 'other', filePath: 'a.ts', ref: 'HEAD' }],
    ]);
    expect(owner.read('ws', 'root')?.result).toEqual({
      kind: 'showFile',
      content: JSON.stringify({
        workspaceId: 'ws',
        filePath: 'a.ts',
        ref: 'HEAD',
        gitRootId: 'root',
      }),
    });
  });

  it('does not publish a late path completion or let an old release remove a replacement request', async () => {
    const old = deferred<{ content: string }>();
    vi.mocked(backendRequest)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue({ content: 'new' });
    const owner = start();
    owner.dispatch(
      gitReadRequested('ws', 'tab', 'old', { kind: 'showFile', ref: 'HEAD', filePath: 'a.ts' }),
    );
    owner.dispatch(
      gitReadRequested('ws', 'tab', 'new', { kind: 'showFile', ref: 'HEAD', filePath: 'b.ts' }),
    );
    owner.dispatch(releaseGitRead('ws', 'tab', 'old'));
    await vi.waitFor(() =>
      expect(owner.read('ws', 'tab')?.result).toEqual({ kind: 'showFile', content: 'new' }),
    );
    old.resolve({ content: 'old' });
    await settle();
    expect(owner.read('ws', 'tab')).toMatchObject({ requestId: 'new', result: { content: 'new' } });
  });

  it('coalesces invalidations before lease release into one fresh read after the mutation tail', async () => {
    const old = deferred<{ content: string }>();
    vi.mocked(backendRequest)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue({ content: 'fresh' });
    const owner = start();
    owner.dispatch(
      gitReadRequested('ws', 'tab', 'request', { kind: 'showFile', ref: 'HEAD', filePath: 'a.ts' }),
    );
    const lease = reserveGitMutation('ws');
    try {
      await lease.ready;
      for (let i = 0; i < 8; i++) owner.dispatch(gitReadsInvalidated('ws'));
      old.resolve({ content: 'obsolete' });
      await settle();
      expect(backendRequest).toHaveBeenCalledTimes(1);
      expect(owner.read('ws', 'tab')?.result).toBeNull();
    } finally {
      await lease.release();
    }
    await vi.waitFor(() =>
      expect(owner.read('ws', 'tab')).toMatchObject({
        loading: false,
        result: { content: 'fresh' },
      }),
    );
    expect(backendRequest).toHaveBeenCalledTimes(2);
  });

  it('retries a read crossing a mutation even without an explicit invalidation', async () => {
    const old = deferred<{ content: string }>();
    vi.mocked(backendRequest)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue({ content: 'fresh' });
    const owner = start();
    owner.dispatch(
      gitReadRequested('ws', 'tab', 'request', { kind: 'showFile', ref: 'HEAD', filePath: 'a.ts' }),
    );
    const lease = reserveGitMutation('ws');
    await lease.ready;
    await lease.release();
    old.resolve({ content: 'obsolete' });
    await vi.waitFor(() =>
      expect(owner.read('ws', 'tab')?.result).toEqual({ kind: 'showFile', content: 'fresh' }),
    );
    expect(backendRequest).toHaveBeenCalledTimes(2);
  });

  it('suppresses read and navigation publication after workspace teardown', async () => {
    const response = deferred<{ content: string }>();
    vi.mocked(backendRequest).mockReturnValue(response.promise);
    const owner = start();
    owner.dispatch(
      gitReadRequested('ws', 'tab', 'request', { kind: 'showFile', ref: 'HEAD', filePath: 'a.ts' }),
    );
    owner.dispatch(openGitPRFileRequested('ws', 'a.ts', 'main'));
    owner.dispatch(workspaceUnmounted('ws'));
    response.resolve({ content: 'late' });
    await settle();
    expect(owner.read('ws', 'tab')).toBeUndefined();
    expect(
      owner.actions.filter((action) => action.type === 'workspaceNavigation/openWorkspaceDiff'),
    ).toEqual([]);
  });

  it('the newest file-navigation intent wins across PR and commit reads', async () => {
    const old = deferred<{ content: string }>();
    vi.mocked(backendRequest)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue({ content: 'new' });
    const owner = start();
    owner.dispatch(openGitCommitFileRequested('ws', 'sha', 'old.ts'));
    owner.dispatch(openGitPRFileRequested('ws', 'new.ts', 'main'));
    await vi.waitFor(() =>
      expect(
        owner.actions.filter((action) => action.type === 'workspaceNavigation/openWorkspaceDiff'),
      ).toHaveLength(1),
    );
    old.resolve({ content: 'old' });
    await settle();
    const opened = owner.actions.filter(
      (action) => action.type === 'workspaceNavigation/openWorkspaceDiff',
    );
    expect(opened).toEqual([
      expect.objectContaining({
        payload: [
          'ws',
          expect.objectContaining({ relativePath: 'new.ts' }),
          expect.objectContaining({ filePath: 'new.ts' }),
        ],
      }),
    ]);
  });
});
