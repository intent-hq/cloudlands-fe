import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appClient } from '$lib/client';
import { AcceptChangesClient } from '$features/accept-changes/accept-changes.client';
import { gitClient } from '$features/git/git.client';
import * as diffIpcBatcher from '$features/file-tracking/components/diff/diff-ipc-batcher';
import type { CommitInfo, GitStatus } from '$shared/types';
import { refreshRequested } from '../../changes/changes-slice';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  loadGitStatus,
  loadGitBranches,
  readGitStatusRequested,
  loadCommitDetails,
  loadGitDiffs,
  loadGitEnrichment,
  loadSecondaryRootCommitFiles,
  loadSecondaryRootGit,
  executeAcceptChangesRequested,
  stageGitHunkRequested,
  readCommitDetailsRequested,
  readGitBranchesRequested,
  readGitBranchStatusRequested,
  readGitDiffsRequested,
  setCommitDetails,
  setGitBranches,
  setGitBranchStatus,
  setGitDiffs,
  setGitEnrichment,
  setGitStatus,
  setGitStatusReadResult,
  setSecondaryRootGit,
  setSecondaryRootGitError,
  setSecondaryRootCommitFiles,
} from '../git-slice';
import { gitReadSaga } from './git-read-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('gitReadSaga', () => {
  beforeEach(() => {
    vi.spyOn(appClient.git, 'diffs').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publishes only the latest reverse-ordered Git-status result', async () => {
    const stale = deferred<GitStatus>();
    const fresh = deferred<GitStatus>();
    vi.spyOn(appClient.git, 'status')
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, gitReadSaga);
    const first = readGitStatusRequested('ws-1', true, 'request-1');
    const second = readGitStatusRequested('ws-1', true, 'request-2');
    const staleStatus: GitStatus = {
      branch: 'stale',
      ahead: 0,
      behind: 0,
      diverged: false,
      files: [{ path: 'stale.swift', status: 'M', staged: false }],
      hasUncommittedChanges: true,
      hasUntrackedFiles: false,
    };
    const freshStatus: GitStatus = {
      ...staleStatus,
      branch: 'fresh',
      files: [{ path: 'fresh.swift', status: 'M', staged: false }],
    };

    channel.put(first);
    await vi.waitFor(() => expect(appClient.git.status).toHaveBeenCalledTimes(1));
    channel.put(second);
    await vi.waitFor(() => expect(appClient.git.status).toHaveBeenCalledTimes(2));

    fresh.resolve(freshStatus);
    await vi.waitFor(() =>
      expect(actions).toContainEqual(setGitStatusReadResult('ws-1', 'request-2', freshStatus)),
    );
    stale.resolve(staleStatus);
    await settle();

    expect(appClient.git.status).toHaveBeenNthCalledWith(1, 'ws-1', { forceRefresh: true });
    expect(appClient.git.status).toHaveBeenNthCalledWith(2, 'ws-1', { forceRefresh: true });
    expect(actions).not.toContainEqual(setGitStatusReadResult('ws-1', 'request-1', staleStatus));
    task.cancel();
    await task.toPromise();
  });

  it('resolves a correlated enrichment request through the exact Git adapter calls', async () => {
    const localDiff = { file: 'src/local.ts', chunks: [], oldContent: 'old', newContent: 'new' };
    const branchDiff = {
      file: 'src/branch.ts',
      chunks: [],
      oldContent: 'base',
      newContent: 'head',
    };
    const numstat = [{ filePath: 'src/local.ts', additions: 2, deletions: 1 }];
    const showFile = { success: true, data: 'committed content' };
    const diff = vi.spyOn(diffIpcBatcher, 'batchedGitDiff').mockResolvedValue(localDiff);
    const branch = vi
      .spyOn(diffIpcBatcher, 'batchedGitBranchBaseDiff')
      .mockResolvedValue(branchDiff);
    const stats = vi.spyOn(diffIpcBatcher, 'dedupedGitNumstat').mockResolvedValue(numstat);
    const show = vi.spyOn(diffIpcBatcher, 'dedupedShowFile').mockResolvedValue(showFile);
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, gitReadSaga);
    const request = {
      diffs: [
        {
          key: 'local',
          path: 'src/local.ts',
          staged: true,
          gitlink: { oldSha: 'old-sha', newSha: 'new-sha' },
          gitRootId: 'root-1',
          gitRootPath: '/repo/root',
        },
      ],
      branchDiffs: [
        {
          key: 'branch',
          path: 'src/branch.ts',
          baseRef: 'main',
          baseCommitSha: 'abc123',
        },
      ],
      numstats: [
        {
          key: 'stats',
          staged: false,
          baseRef: 'main',
          baseCommitSha: 'abc123',
          targetRef: 'HEAD',
        },
      ],
      showFiles: [{ key: 'show', path: 'src/committed.ts', ref: 'def456', gitRootId: 'root-1' }],
    };

    channel.put(loadGitEnrichment('ws-1', 'panel', 'request-1', request));
    await vi.waitFor(() =>
      expect(actions).toContainEqual(
        setGitEnrichment('ws-1', 'panel', 'request-1', {
          diffs: { local: localDiff },
          branchDiffs: { branch: branchDiff },
          numstats: { stats: numstat },
          showFiles: { show: showFile },
        }),
      ),
    );
    expect(diff).toHaveBeenCalledWith('ws-1', true, 'src/local.ts', {
      gitlink: { oldSha: 'old-sha', newSha: 'new-sha' },
      gitRootId: 'root-1',
      gitRootPath: '/repo/root',
    });
    expect(branch).toHaveBeenCalledWith(
      'ws-1',
      { baseRef: 'main', baseCommitSha: 'abc123' },
      'src/branch.ts',
    );
    expect(stats).toHaveBeenCalledWith('ws-1', {
      staged: false,
      baseRef: 'main',
      baseCommitSha: 'abc123',
      targetRef: 'HEAD',
    });
    expect(show).toHaveBeenCalledWith('ws-1', 'def456', 'src/committed.ts', {
      gitRootId: 'root-1',
    });

    task.cancel();
    await task.toPromise();
  });

  it('does not publish an enrichment result after its workspace unmounts', async () => {
    let resolveDiff!: (value: { file: string; chunks: [] }) => void;
    const diff = vi.spyOn(diffIpcBatcher, 'batchedGitDiff').mockReturnValue(
      new Promise((resolve) => {
        resolveDiff = resolve;
      }),
    );
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, gitReadSaga);

    channel.put(
      loadGitEnrichment('ws-1', 'panel', 'request-1', {
        diffs: [{ key: 'local', path: 'src/local.ts', staged: false }],
        branchDiffs: [],
        numstats: [],
        showFiles: [],
      }),
    );
    await vi.waitFor(() => expect(diff).toHaveBeenCalledOnce());
    channel.put(workspaceUnmounted('ws-1'));
    await settle();
    resolveDiff({ file: 'src/local.ts', chunks: [] });
    await settle();

    expect(actions).not.toContainEqual(expect.objectContaining({ type: setGitEnrichment.type }));
    task.cancel();
    await task.toPromise();
  });

  it('refreshes selector-backed Git reads after an exact successful hunk mutation', async () => {
    const stage = vi.spyOn(gitClient, 'stageHunk').mockResolvedValue({ ok: true, data: undefined });
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, gitReadSaga);
    const request = stageGitHunkRequested('ws-1', 'src/x.ts', 'patch-@@');

    channel.put(request);
    await vi.waitFor(() => expect(actions).toContainEqual(request.success({ success: true })));

    expect(stage).toHaveBeenCalledWith('ws-1', 'src/x.ts', 'patch-@@');
    expect(actions).toEqual([
      { type: 'git/loadStatus', payload: ['ws-1', true] },
      { type: 'changes/refreshRequested', payload: ['ws-1', true] },
      request.success({ success: true }),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('executes accept-changes mutations with the exact workspace and options', async () => {
    const execute = vi.spyOn(AcceptChangesClient, 'execute').mockResolvedValue({
      success: true,
      steps: [],
    });
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, gitReadSaga);
    const request = executeAcceptChangesRequested('ws-1', 'push', {
      targetBranch: 'feature',
      upToCommitHash: 'abc123',
    });

    channel.put(request);
    await vi.waitFor(() =>
      expect(actions).toContainEqual(request.success({ success: true, steps: [] })),
    );
    expect(execute).toHaveBeenCalledWith('ws-1', 'push', {
      targetBranch: 'feature',
      upToCommitHash: 'abc123',
    });

    task.cancel();
    await task.toPromise();
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

  it('reads branches and branch status with exact path-based wire parameters', async () => {
    const branches = {
      branches: ['feature', 'main'],
      remoteBranches: ['origin/release'],
      currentBranch: 'feature',
      defaultBranch: 'main',
    };
    const branchStatus = {
      branch: 'feature',
      currentBranch: 'feature',
      isCurrentBranch: true,
      ahead: 2,
      behind: 1,
      hasUncommittedChanges: true,
    };
    vi.spyOn(appClient.git, 'getBranches').mockResolvedValue(branches);
    vi.spyOn(appClient.git, 'branchStatus').mockResolvedValue(branchStatus);
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, gitReadSaga);

    channel.put(readGitBranchesRequested('/repo', true));
    channel.put(readGitBranchStatusRequested('/repo', 'feature'));

    await vi.waitFor(() => {
      expect(actions).toContainEqual(setGitBranches('/repo', branches));
      expect(actions).toContainEqual(setGitBranchStatus('/repo', 'feature', branchStatus));
    });
    expect(appClient.git.getBranches).toHaveBeenCalledWith('/repo', true);
    expect(appClient.git.branchStatus).toHaveBeenCalledWith('/repo', 'feature');
    task.cancel();
    await task.toPromise();
  });

  it('debounces branch loads and suppresses a superseded same-repository result', async () => {
    vi.useFakeTimers();
    const stale = deferred<{
      branches: string[];
      remoteBranches: string[];
      currentBranch: string;
      defaultBranch: string;
    }>();
    const fresh = {
      branches: ['fresh'],
      remoteBranches: [],
      currentBranch: 'fresh',
      defaultBranch: 'fresh',
    };
    const getBranches = vi
      .spyOn(appClient.git, 'getBranches')
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(fresh);
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, gitReadSaga);

    try {
      channel.put(loadGitBranches('/race-repo', true));
      await settle();
      await vi.advanceTimersByTimeAsync(149);
      expect(getBranches).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(getBranches).toHaveBeenCalledTimes(1);

      channel.put(loadGitBranches('/race-repo', true, true));
      await settle();
      await vi.advanceTimersByTimeAsync(150);
      await settle();
      expect(getBranches).toHaveBeenCalledTimes(2);

      stale.resolve({
        branches: ['stale'],
        remoteBranches: [],
        currentBranch: 'stale',
        defaultBranch: 'stale',
      });
      await settle();

      expect(actions).toContainEqual(setGitBranches('/race-repo', fresh));
      expect(actions).not.toContainEqual(
        setGitBranches('/race-repo', {
          branches: ['stale'],
          remoteBranches: [],
          currentBranch: 'stale',
          defaultBranch: 'stale',
        }),
      );
    } finally {
      task.cancel();
      await task.toPromise();
      vi.useRealTimers();
    }
  });

  it('reuses the branch cache until a force refresh invalidates it', async () => {
    vi.useFakeTimers();
    const cached = {
      branches: ['cached'],
      remoteBranches: [],
      currentBranch: 'cached',
      defaultBranch: 'cached',
    };
    const refreshed = { ...cached, branches: ['refreshed'], currentBranch: 'refreshed' };
    const getBranches = vi
      .spyOn(appClient.git, 'getBranches')
      .mockResolvedValueOnce(cached)
      .mockResolvedValueOnce(refreshed);
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, gitReadSaga);

    try {
      channel.put(loadGitBranches('/cache-repo', true, false, true));
      await settle();
      await vi.advanceTimersByTimeAsync(150);
      await settle();
      channel.put(loadGitBranches('/cache-repo', true, false, true));
      await settle();
      await vi.advanceTimersByTimeAsync(150);
      await settle();
      expect(getBranches).toHaveBeenCalledTimes(1);

      channel.put(loadGitBranches('/cache-repo', true, true, true));
      await settle();
      await vi.advanceTimersByTimeAsync(150);
      await settle();
      expect(getBranches).toHaveBeenCalledTimes(2);
      expect(actions).toContainEqual(setGitBranches('/cache-repo', refreshed));
    } finally {
      task.cancel();
      await task.toPromise();
      vi.useRealTimers();
    }
  });

  it('reads commit details and diffs with exact secondary-root wire parameters', async () => {
    const wireDetails = {
      commitHash: 'abc123',
      author: 'Agent',
      authorEmail: 'agent@example.com',
      date: '2026-09-08T00:00:00.000Z',
      message: 'Scoped change',
      files: ['src/a.ts'],
      fileDetails: [{ path: 'src/a.ts', additions: 2, deletions: 1 }],
    };
    const diffs = [
      {
        file: 'src/a.ts',
        content: '',
        chunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: [{ type: 'Addition' as const, content: 'added' }],
          },
        ],
      },
    ];
    vi.spyOn(appClient.git, 'commitDetails').mockResolvedValue(wireDetails);
    vi.mocked(appClient.git.diffs).mockResolvedValue(diffs);
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, gitReadSaga);

    channel.put(readCommitDetailsRequested('ws-1', 'abc123', 'root-1'));
    channel.put(
      readGitDiffsRequested('ws-1', {
        path: 'src/a.ts',
        staged: true,
        commitHash: 'abc123',
        gitRootId: 'root-1',
      }),
    );

    await vi.waitFor(() => {
      expect(actions).toContainEqual(
        setCommitDetails(
          'ws-1',
          'abc123',
          { ...wireDetails, files: wireDetails.fileDetails },
          'root-1',
        ),
      );
      expect(actions).toContainEqual(
        setGitDiffs(
          'ws-1',
          {
            path: 'src/a.ts',
            staged: true,
            commitHash: 'abc123',
            gitRootId: 'root-1',
          },
          diffs,
        ),
      );
    });
    expect(appClient.git.commitDetails).toHaveBeenCalledWith('ws-1', 'abc123', {
      gitRootId: 'root-1',
    });
    expect(appClient.git.diffs).toHaveBeenCalledWith('ws-1', {
      path: 'src/a.ts',
      staged: true,
      commitHash: 'abc123',
      gitRootId: 'root-1',
    });
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
    expect(appClient.git.status).toHaveBeenNthCalledWith(2, 'ws-1', { forceRefresh: true });
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

  it('cancels every keyed commit and diff read for an unmounted workspace only', async () => {
    const commitResolvers = new Map<string, (value: any) => void>();
    const diffResolvers = new Map<string, (value: any[]) => void>();
    vi.spyOn(appClient.git, 'commitDetails').mockImplementation(
      (workspaceId, hash) =>
        new Promise((resolve) => commitResolvers.set(`${workspaceId}:${hash}`, resolve)),
    );
    vi.mocked(appClient.git.diffs).mockImplementation(
      (workspaceId, options) =>
        new Promise((resolve) => diffResolvers.set(`${workspaceId}:${options?.path}`, resolve)),
    );
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, gitReadSaga);

    channel.put(loadCommitDetails('ws-1', 'a'));
    channel.put(loadCommitDetails('ws-1', 'b'));
    channel.put(loadGitDiffs('ws-1', { path: 'a.ts' }));
    channel.put(loadGitDiffs('ws-1', { path: 'b.ts' }));
    channel.put(loadCommitDetails('ws-2', 'c'));
    channel.put(loadGitDiffs('ws-2', { path: 'c.ts' }));
    await settle();
    channel.put(workspaceUnmounted('ws-1'));
    await settle();

    commitResolvers.get('ws-1:a')?.({ files: ['a.ts'], fileDetails: [] });
    commitResolvers.get('ws-1:b')?.({ files: ['b.ts'], fileDetails: [] });
    diffResolvers.get('ws-1:a.ts')?.([]);
    diffResolvers.get('ws-1:b.ts')?.([]);
    commitResolvers.get('ws-2:c')?.({ files: ['c.ts'], fileDetails: [] });
    diffResolvers.get('ws-2:c.ts')?.([]);
    await settle();

    expect(
      actions.filter((action) =>
        [setCommitDetails.type, setGitDiffs.type].includes((action as { type: string }).type),
      ),
    ).toEqual([
      expect.objectContaining({ type: setCommitDetails.type }),
      expect.objectContaining({ type: setGitDiffs.type }),
    ]);
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
