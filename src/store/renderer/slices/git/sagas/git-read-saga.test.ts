import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appClient } from '$lib/client';
import { gitClient } from '$features/git/git.client';
import type { CommitInfo, GitStatus } from '$shared/types';
import { refreshRequested } from '../../changes/changes-slice';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  loadGitStatus,
  loadSecondaryRootCommitFiles,
  loadSecondaryRootGit,
  setGitStatus,
  setSecondaryRootGit,
  setSecondaryRootGitError,
  setSecondaryRootCommitFiles,
} from '../git-slice';
import { gitReadSaga } from './git-read-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('gitReadSaga', () => {
  beforeEach(() => {
    vi.spyOn(appClient.git, 'diffs').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not paginate history when the registration boundary is unknown', async () => {
    vi.spyOn(gitClient, 'getStatus').mockResolvedValue({
      ok: true,
      data: {
        branch: 'feature',
        ahead: 0,
        behind: 0,
        diverged: false,
        files: [],
        hasUncommittedChanges: false,
        hasUntrackedFiles: false,
      },
    });
    vi.spyOn(gitClient, 'getHistory').mockResolvedValue({
      ok: true,
      data: { items: [{ hash: 'new', message: 'new' } as CommitInfo], nextToken: 'page-2' },
    });
    vi.spyOn(appClient.git, 'commitDetails').mockResolvedValue({ files: [], fileDetails: [] });
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, gitReadSaga);

    channel.put(loadSecondaryRootGit('ws-1', 'root-1', undefined, 30));
    await vi.waitFor(() =>
      expect(actions).toContainEqual(expect.objectContaining({ type: setSecondaryRootGit.type })),
    );
    expect(gitClient.getHistory).toHaveBeenCalledTimes(1);
    task.cancel();
    await task.toPromise();
  });

  it('derives secondary-root working-tree line counts from scoped diffs', async () => {
    vi.spyOn(gitClient, 'getStatus').mockResolvedValue({
      ok: true,
      data: {
        branch: 'feature',
        ahead: 0,
        behind: 0,
        diverged: false,
        files: [{ path: 'working.ts', status: 'M', staged: false }],
        hasUncommittedChanges: true,
        hasUntrackedFiles: false,
      },
    });
    vi.spyOn(gitClient, 'getHistory').mockResolvedValue({ ok: true, data: { items: [] } });
    vi.mocked(appClient.git.diffs)
      .mockResolvedValueOnce([
        {
          file: 'working.ts',
          content: '',
          chunks: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 2,
              lines: [
                { type: 'Addition', content: 'a' },
                { type: 'Addition', content: 'b' },
                { type: 'Deletion', content: 'c' },
              ],
            },
          ],
        },
      ] as never)
      .mockResolvedValueOnce([]);
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, gitReadSaga);

    channel.put(loadSecondaryRootGit('ws-1', 'root-1'));
    await vi.waitFor(() =>
      expect(actions).toContainEqual(expect.objectContaining({ type: setSecondaryRootGit.type })),
    );
    const completed = actions.find(
      (action) => (action as { type?: string }).type === setSecondaryRootGit.type,
    ) as ReturnType<typeof setSecondaryRootGit>;
    expect(completed.payload.data.status?.files[0]).toMatchObject({
      path: 'working.ts',
      additions: 2,
      deletions: 1,
    });
    expect(appClient.git.diffs).toHaveBeenCalledWith('ws-1', {
      paths: ['working.ts'],
      gitRootId: 'root-1',
    });
    task.cancel();
    await task.toPromise();
  });

  it('loads a secondary root through the saga with exact boundary pagination', async () => {
    vi.spyOn(gitClient, 'getStatus').mockResolvedValue({
      ok: true,
      data: {
        branch: 'feature',
        ahead: 0,
        behind: 0,
        diverged: false,
        files: [{ path: 'working.ts', status: 'M', staged: false }],
        hasUncommittedChanges: true,
        hasUntrackedFiles: false,
      },
    });
    vi.spyOn(gitClient, 'getHistory')
      .mockResolvedValueOnce({
        ok: true,
        data: {
          items: [{ hash: 'new', message: 'new' } as CommitInfo],
          nextToken: 'page-2',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { items: [{ hash: 'boundary', message: 'boundary' } as CommitInfo] },
      });
    vi.spyOn(appClient.git, 'commitDetails').mockImplementation(async (_wsId, hash) => ({
      files: [`${hash}.ts`],
      fileDetails: [],
    }));
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, gitReadSaga);

    channel.put(loadSecondaryRootGit('ws-1', 'root-1', 'boundary', 30));
    await vi.waitFor(() =>
      expect(actions).toContainEqual(expect.objectContaining({ type: setSecondaryRootGit.type })),
    );
    const completed = actions.find(
      (action) => (action as { type?: string }).type === setSecondaryRootGit.type,
    ) as ReturnType<typeof setSecondaryRootGit>;
    expect(completed.payload).toEqual(
      expect.objectContaining({
        wsId: 'ws-1',
        gitRootId: 'root-1',
        data: expect.objectContaining({
          commits: [
            expect.objectContaining({ hash: 'new' }),
            expect.objectContaining({ hash: 'boundary' }),
          ],
          commitFiles: {
            new: [{ path: 'new.ts', additions: 0, deletions: 0 }],
            boundary: [{ path: 'boundary.ts', additions: 0, deletions: 0 }],
          },
        }),
      }),
    );
    expect(gitClient.getHistory).toHaveBeenNthCalledWith(2, 'ws-1', 30, {
      gitRootId: 'root-1',
      nextToken: 'page-2',
    });
    task.cancel();
    await task.toPromise();
  });

  it('discards a superseded same-root response', async () => {
    let resolveFirst!: (value: { ok: true; data: GitStatus }) => void;
    const fresh = {
      branch: 'fresh',
      ahead: 0,
      behind: 0,
      diverged: false,
      files: [],
      hasUncommittedChanges: false,
      hasUntrackedFiles: false,
    } satisfies GitStatus;
    vi.spyOn(gitClient, 'getStatus')
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({ ok: true, data: fresh });
    vi.spyOn(gitClient, 'getHistory').mockResolvedValue({ ok: true, data: { items: [] } });
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, gitReadSaga);

    channel.put(loadSecondaryRootGit('ws-1', 'root-1'));
    await settle();
    channel.put(loadSecondaryRootGit('ws-1', 'root-1'));
    await vi.waitFor(() =>
      expect(actions).toContainEqual(
        setSecondaryRootGit('ws-1', 'root-1', {
          status: fresh,
          commits: [],
          nextToken: undefined,
          commitFiles: {},
        }),
      ),
    );
    resolveFirst({ ok: true, data: { ...fresh, branch: 'stale' } });
    await settle();
    expect(
      actions.filter((action) => (action as { type?: string }).type === setSecondaryRootGit.type),
    ).toHaveLength(1);
    task.cancel();
    await task.toPromise();
  });

  it('cancels all in-flight root reads when the workspace unmounts', async () => {
    const resolvers: Array<(value: { ok: true; data: GitStatus }) => void> = [];
    let resolveCommitDetails!: (value: { files: string[]; fileDetails: [] }) => void;
    vi.spyOn(gitClient, 'getStatus').mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve)),
    );
    vi.spyOn(gitClient, 'getHistory').mockResolvedValue({ ok: true, data: { items: [] } });
    vi.spyOn(appClient.git, 'commitDetails').mockReturnValue(
      new Promise((resolve) => (resolveCommitDetails = resolve)),
    );
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, gitReadSaga);

    channel.put(loadSecondaryRootGit('ws-1', 'root-1'));
    channel.put(loadSecondaryRootGit('ws-1', 'root-2'));
    channel.put(loadSecondaryRootCommitFiles('ws-1', 'root-1', 'abc123'));
    await settle();
    channel.put(workspaceUnmounted('ws-1'));
    await settle();
    for (const resolve of resolvers) {
      resolve({
        ok: true,
        data: {
          branch: 'late',
          ahead: 0,
          behind: 0,
          diverged: false,
          files: [],
          hasUncommittedChanges: false,
          hasUntrackedFiles: false,
        },
      });
    }
    resolveCommitDetails({ files: ['late.ts'], fileDetails: [] });
    await settle();
    await settle();
    expect(
      actions.some((action) =>
        [
          setSecondaryRootGit.type,
          setSecondaryRootGitError.type,
          setSecondaryRootCommitFiles.type,
        ].includes((action as { type: string }).type),
      ),
    ).toBe(false);
    task.cancel();
    await task.toPromise();
  });

  it('stores a secondary-root read error', async () => {
    vi.spyOn(gitClient, 'getStatus').mockResolvedValue({ ok: false, error: 'status failed' });
    vi.spyOn(gitClient, 'getHistory').mockResolvedValue({ ok: true, data: { items: [] } });
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, gitReadSaga);

    channel.put(loadSecondaryRootGit('ws-1', 'root-1'));
    await vi.waitFor(() =>
      expect(actions).toContainEqual(setSecondaryRootGitError('ws-1', 'root-1', 'status failed')),
    );
    task.cancel();
    await task.toPromise();
  });

  it('keeps a null commit-detail read recoverable and accepts a later retry', async () => {
    vi.spyOn(appClient.git, 'commitDetails')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        files: ['recovered.ts'],
        fileDetails: [],
      });
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, gitReadSaga);

    channel.put(loadSecondaryRootCommitFiles('ws-1', 'root-1', 'abc123'));
    await settle();
    expect(actions).not.toContainEqual(
      expect.objectContaining({ type: setSecondaryRootGitError.type }),
    );
    channel.put(loadSecondaryRootCommitFiles('ws-1', 'root-1', 'abc123'));
    await vi.waitFor(() =>
      expect(actions).toContainEqual(
        setSecondaryRootCommitFiles('ws-1', 'root-1', 'abc123', [
          { path: 'recovered.ts', additions: 0, deletions: 0 },
        ]),
      ),
    );
    task.cancel();
    await task.toPromise();
  });

  it('discards an in-flight commit-detail response when its root refreshes', async () => {
    let resolveCommitDetails!: (value: { files: string[]; fileDetails: [] }) => void;
    vi.spyOn(appClient.git, 'commitDetails').mockReturnValue(
      new Promise((resolve) => (resolveCommitDetails = resolve)),
    );
    vi.spyOn(gitClient, 'getStatus').mockResolvedValue({
      ok: true,
      data: {
        branch: 'main',
        ahead: 0,
        behind: 0,
        diverged: false,
        files: [],
        hasUncommittedChanges: false,
        hasUntrackedFiles: false,
      },
    });
    vi.spyOn(gitClient, 'getHistory').mockResolvedValue({ ok: true, data: { items: [] } });
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, gitReadSaga);

    channel.put(loadSecondaryRootCommitFiles('ws-1', 'root-1', 'abc123'));
    await settle();
    channel.put(loadSecondaryRootGit('ws-1', 'root-1'));
    await vi.waitFor(() =>
      expect(actions).toContainEqual(expect.objectContaining({ type: setSecondaryRootGit.type })),
    );
    resolveCommitDetails({ files: ['stale.ts'], fileDetails: [] });
    await settle();
    expect(actions).not.toContainEqual(
      expect.objectContaining({ type: setSecondaryRootCommitFiles.type }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('maps the protocol response field by field', async () => {
    const wire = {
      branch: 'main',
      ahead: 2,
      behind: 1,
      diverged: true,
      files: [
        { path: 'src/a.ts', status: 'modified', staged: false, wireOnly: 'drop' },
        {
          path: 'packages/intentd',
          status: 'modified',
          staged: false,
          mode: '160000',
          oldSha: 'a'.repeat(40),
          newSha: 'b'.repeat(40),
          wireOnly: 'drop',
        },
      ],
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
        files: [
          { path: 'src/a.ts', status: 'modified', staged: false },
          {
            path: 'packages/intentd',
            status: 'modified',
            staged: false,
            mode: '160000',
            oldSha: 'a'.repeat(40),
            newSha: 'b'.repeat(40),
          },
        ],
        hasUncommittedChanges: true,
        hasUntrackedFiles: false,
      }),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('leaves broad changes refreshes to the lifecycle read owner', async () => {
    vi.spyOn(appClient.git, 'status').mockResolvedValue(null);
    const channel = stdChannel();
    const task = runSaga({ channel, dispatch: vi.fn() }, gitReadSaga);

    channel.put(refreshRequested('ws-1'));
    await settle();

    expect(appClient.git.status).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  it('coalesces same-workspace refreshes into one leading and one trailing read', async () => {
    let resolveFirst!: (status: GitStatus) => void;
    const first = new Promise<GitStatus>((done) => {
      resolveFirst = done;
    });
    const second: GitStatus = {
      branch: 'main',
      ahead: 1,
      behind: 0,
      diverged: false,
      files: [],
      hasUncommittedChanges: true,
      hasUntrackedFiles: false,
    };
    vi.spyOn(appClient.git, 'status').mockReturnValueOnce(first).mockResolvedValueOnce(second);
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, gitReadSaga);

    channel.put(loadGitStatus('ws-1'));
    await settle();
    channel.put(loadGitStatus('ws-1'));
    channel.put(loadGitStatus('ws-1', true));
    await settle();
    expect(appClient.git.status).toHaveBeenCalledTimes(1);

    resolveFirst({
      branch: 'main',
      ahead: 0,
      behind: 0,
      diverged: false,
      files: [],
      hasUncommittedChanges: false,
      hasUntrackedFiles: false,
    });
    await settle();
    await settle();

    expect(appClient.git.status).toHaveBeenCalledTimes(2);
    expect(appClient.git.status).toHaveBeenNthCalledWith(1, 'ws-1');
    expect(appClient.git.status).toHaveBeenNthCalledWith(2, 'ws-1');
    expect(actions).toHaveLength(2);
    task.cancel();
    await task.toPromise();
  });

  it('keeps different workspace reads concurrent', async () => {
    const resolves = new Map<string, (status: GitStatus) => void>();
    vi.spyOn(appClient.git, 'status').mockImplementation(
      (workspaceId) => new Promise<GitStatus>((resolve) => resolves.set(workspaceId, resolve)),
    );
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, gitReadSaga);

    channel.put(loadGitStatus('ws-1'));
    channel.put(loadGitStatus('ws-2'));
    await settle();

    expect(appClient.git.status).toHaveBeenCalledTimes(2);
    expect(appClient.git.status).toHaveBeenNthCalledWith(1, 'ws-1');
    expect(appClient.git.status).toHaveBeenNthCalledWith(2, 'ws-2');
    resolves.get('ws-1')!({
      branch: 'main',
      ahead: 0,
      behind: 0,
      diverged: false,
      files: [],
      hasUncommittedChanges: false,
      hasUntrackedFiles: false,
    });
    resolves.get('ws-2')!({
      branch: 'feature',
      ahead: 0,
      behind: 0,
      diverged: false,
      files: [],
      hasUncommittedChanges: true,
      hasUntrackedFiles: false,
    });
    await settle();

    expect(actions).toHaveLength(2);
    expect(actions.map((action: any) => action.payload.wsId)).toEqual(
      expect.arrayContaining(['ws-1', 'ws-2']),
    );
    task.cancel();
    await task.toPromise();
  });

  it('cancels a matching unmounted workspace read without affecting another workspace', async () => {
    const resolves = new Map<string, (status: GitStatus) => void>();
    vi.spyOn(appClient.git, 'status').mockImplementation(
      (workspaceId) => new Promise<GitStatus>((resolve) => resolves.set(workspaceId, resolve)),
    );
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, gitReadSaga);

    channel.put(loadGitStatus('ws-1'));
    channel.put(loadGitStatus('ws-2'));
    await settle();
    channel.put(workspaceUnmounted('ws-1'));
    resolves.get('ws-2')!({
      branch: 'feature',
      ahead: 0,
      behind: 0,
      diverged: false,
      files: [],
      hasUncommittedChanges: false,
      hasUntrackedFiles: false,
    });
    await settle();

    expect(appClient.git.status).toHaveBeenCalledTimes(2);
    expect(actions).toHaveLength(1);
    expect((actions[0] as { payload: { wsId: string } }).payload.wsId).toBe('ws-2');
    task.cancel();
    await task.toPromise();
  });

  it('does not cancel a read on deletion before tab removal', async () => {
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
    await settle();
    channel.put(workspaceDeleted('ws-1', []));
    resolve({
      branch: 'retained',
      ahead: 0,
      behind: 0,
      diverged: false,
      files: [],
      hasUncommittedChanges: false,
      hasUntrackedFiles: false,
    });
    await settle();

    expect(actions).toEqual([
      expect.objectContaining({
        type: setGitStatus.type,
        payload: expect.objectContaining({ wsId: 'ws-1' }),
      }),
    ]);
    task.cancel();
    await task.toPromise();
  });
});
