/**
 * Wire-contract tests for the git IPC bridge seeder.
 *
 * Asserts each legacy `git:*` / `git-tracking:*` channel (a) forwards to the
 * matching daemon RPC (`git.*`, PROTOCOL §5.6; `host.exec` §5.14;
 * `host.directoryStatus`) with the exact method + params, and (b) maps the
 * daemon result to the legacy `{ success, data?, error? }` envelope the call
 * sites (git.client.ts, diff-ipc-batcher, workspace-validation, the
 * onboarding/initializer pickers) already consume.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// FAKE transport only: the daemon bridge is mocked so no IPC ever fires.
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
}));

import { backendRequest } from '$lib/client/live/backend-transport';
import { mockInvoke } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';

const mockedRequest = vi.mocked(backendRequest);

/** PROTOCOL §5.14 host.exec result. */
function execResult(
  overrides: Partial<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> = {},
) {
  return { stdout: '', stderr: '', exitCode: 0, ...overrides };
}

describe('git-bridge-seeder', () => {
  beforeAll(async () => {
    // Importing the seeder runs its `registerMockIpcHandler` side effects.
    await import('./git-bridge-seeder');
  });

  afterEach(() => vi.clearAllMocks());

  describe('git:push / git:fetch → git.push / git.fetch (§5.6)', () => {
    it('push forwards workspaceId + force:false to git.push', async () => {
      mockedRequest.mockResolvedValueOnce({ ok: true, branch: 'main', pushedSha: 'abc' });

      const result = await mockInvoke(IPC_CHANNELS.GIT.PUSH, { workspaceId: 'ws-1' });

      expect(mockedRequest).toHaveBeenCalledWith(
        'git.push',
        { workspaceId: 'ws-1', force: false },
        { timeoutMs: 300_000 },
      );
      expect(result).toEqual({ success: true });
    });

    it('push force:true forwards force:true and folds a daemon rejection to the error envelope', async () => {
      mockedRequest.mockRejectedValueOnce(new Error('rejected: stale info'));

      const result = await mockInvoke(IPC_CHANNELS.GIT.PUSH, {
        workspaceId: 'ws-1',
        force: true,
      });

      expect(mockedRequest).toHaveBeenCalledWith(
        'git.push',
        { workspaceId: 'ws-1', force: true },
        { timeoutMs: 300_000 },
      );
      expect(result).toEqual({ success: false, error: 'rejected: stale info' });
    });

    it('push without a workspaceId fails without touching the wire', async () => {
      expect(await mockInvoke(IPC_CHANNELS.GIT.PUSH, {})).toEqual({
        success: false,
        error: 'Invalid workspace ID',
      });
      expect(mockedRequest).not.toHaveBeenCalled();
    });

    it('fetch forwards workspaceId to git.fetch and folds a transport throw into the error envelope', async () => {
      mockedRequest.mockResolvedValueOnce({ ok: true });
      expect(await mockInvoke(IPC_CHANNELS.GIT.FETCH, { workspaceId: 'ws-1' })).toEqual({
        success: true,
      });
      expect(mockedRequest).toHaveBeenCalledWith(
        'git.fetch',
        { workspaceId: 'ws-1' },
        { timeoutMs: 60_000 },
      );

      mockedRequest.mockRejectedValueOnce(new Error('daemon unavailable'));
      expect(await mockInvoke(IPC_CHANNELS.GIT.FETCH, { workspaceId: 'ws-1' })).toEqual({
        success: false,
        error: 'daemon unavailable',
      });
    });
  });

  describe('git:stage-hunk / git:unstage-hunk → git.stageHunk / git.unstageHunk (§5.6)', () => {
    const PATCH = '--- a/f.ts\n+++ b/f.ts\n@@ -1 +1 @@\n-a\n+b\n';

    it('stage-hunk forwards workspaceId + filePath + hunkPatch to git.stageHunk', async () => {
      mockedRequest.mockResolvedValueOnce({ ok: true });

      const result = await mockInvoke(IPC_CHANNELS.GIT.STAGE_HUNK, {
        workspaceId: 'ws-1',
        filePath: 'f.ts',
        hunkPatch: PATCH,
      });

      expect(mockedRequest).toHaveBeenCalledWith('git.stageHunk', {
        workspaceId: 'ws-1',
        filePath: 'f.ts',
        hunkPatch: PATCH,
      });
      expect(result).toEqual({ success: true });
    });

    it('unstage-hunk forwards to git.unstageHunk and folds a daemon rejection into the error envelope', async () => {
      mockedRequest.mockRejectedValueOnce(new Error('bad patch'));

      const result = await mockInvoke(IPC_CHANNELS.GIT.UNSTAGE_HUNK, {
        workspaceId: 'ws-1',
        filePath: 'f.ts',
        hunkPatch: PATCH,
      });

      expect(mockedRequest).toHaveBeenCalledWith('git.unstageHunk', {
        workspaceId: 'ws-1',
        filePath: 'f.ts',
        hunkPatch: PATCH,
      });
      expect(result).toEqual({ success: false, error: 'bad patch' });
    });

    it('stage-hunk without a filePath fails without touching the wire', async () => {
      expect(
        await mockInvoke(IPC_CHANNELS.GIT.STAGE_HUNK, {
          workspaceId: 'ws-1',
          hunkPatch: PATCH,
        }),
      ).toEqual({ success: false, error: 'filePath is required' });
      expect(mockedRequest).not.toHaveBeenCalled();
    });

    it('stage-hunk without a hunkPatch fails without touching the wire', async () => {
      expect(
        await mockInvoke(IPC_CHANNELS.GIT.STAGE_HUNK, {
          workspaceId: 'ws-1',
          filePath: 'f.ts',
        }),
      ).toEqual({ success: false, error: 'hunkPatch is required' });
      expect(mockedRequest).not.toHaveBeenCalled();
    });
  });

  describe('git:numstat → git.numstat (§5.6)', () => {
    it('default (no options) forwards only workspaceId and passes the bare-array result through', async () => {
      mockedRequest.mockResolvedValueOnce([
        { filePath: 'src/a.ts', additions: 3, deletions: 1 },
        { filePath: 'assets/logo.png', additions: 0, deletions: 0 },
      ]);

      const result = await mockInvoke(IPC_CHANNELS.GIT.NUMSTAT, { workspaceId: 'ws-1' });

      expect(mockedRequest).toHaveBeenCalledWith(
        'git.numstat',
        { workspaceId: 'ws-1' },
        { timeoutMs: 60_000 },
      );
      expect(result).toEqual({
        success: true,
        data: [
          { filePath: 'src/a.ts', additions: 3, deletions: 1 },
          { filePath: 'assets/logo.png', additions: 0, deletions: 0 },
        ],
      });
    });

    it('forwards staged:true and staged:false verbatim', async () => {
      mockedRequest.mockResolvedValueOnce([]);
      await mockInvoke(IPC_CHANNELS.GIT.NUMSTAT, { workspaceId: 'ws-1', staged: true });
      expect(mockedRequest).toHaveBeenNthCalledWith(
        1,
        'git.numstat',
        { workspaceId: 'ws-1', staged: true },
        { timeoutMs: 60_000 },
      );

      mockedRequest.mockResolvedValueOnce([]);
      await mockInvoke(IPC_CHANNELS.GIT.NUMSTAT, { workspaceId: 'ws-1', staged: false });
      expect(mockedRequest).toHaveBeenNthCalledWith(
        2,
        'git.numstat',
        { workspaceId: 'ws-1', staged: false },
        { timeoutMs: 60_000 },
      );
    });

    it('forwards baseRef / baseCommitSha / targetRef; an unresolvable boundary folds to [] on the daemon', async () => {
      mockedRequest.mockResolvedValueOnce([]);

      const result = await mockInvoke(IPC_CHANNELS.GIT.NUMSTAT, {
        workspaceId: 'ws-1',
        baseRef: 'gone',
        baseCommitSha: 'dead',
        targetRef: 'HEAD',
      });

      expect(mockedRequest).toHaveBeenCalledWith(
        'git.numstat',
        {
          workspaceId: 'ws-1',
          baseRef: 'gone',
          baseCommitSha: 'dead',
          targetRef: 'HEAD',
        },
        { timeoutMs: 60_000 },
      );
      expect(result).toEqual({ success: true, data: [] });
    });

    it('folds a daemon rejection into the error envelope', async () => {
      mockedRequest.mockRejectedValueOnce(new Error('workspace not found'));
      expect(await mockInvoke(IPC_CHANNELS.GIT.NUMSTAT, { workspaceId: 'ws-1' })).toEqual({
        success: false,
        error: 'workspace not found',
      });
    });

    it('without a workspaceId fails without touching the wire', async () => {
      expect(await mockInvoke(IPC_CHANNELS.GIT.NUMSTAT, {})).toEqual({
        success: false,
        error: 'Invalid workspace ID',
      });
      expect(mockedRequest).not.toHaveBeenCalled();
    });
  });

  describe('git:diff (branch-base only) → git.branchDiff (§5.6)', () => {
    it('rejects non-branch-base params (working-tree diffs read the daemon git.diffs)', async () => {
      const result = await mockInvoke(IPC_CHANNELS.GIT.DIFF, {
        workspaceId: 'ws-1',
        paths: ['a.ts'],
        staged: true,
      });
      expect(result).toEqual({ success: false, error: 'Branch base information is required' });
      expect(mockedRequest).not.toHaveBeenCalled();
    });

    it('forwards baseRef + targetRef + paths and passes the bare-array result through', async () => {
      mockedRequest.mockResolvedValueOnce([
        { file: 'a.ts', chunks: [], oldContent: 'old-a', newContent: 'new-a' },
      ]);

      const result = await mockInvoke(IPC_CHANNELS.GIT.DIFF, {
        workspaceId: 'ws-1',
        paths: ['a.ts'],
        baseRef: 'main',
        targetRef: 'HEAD',
      });

      expect(mockedRequest).toHaveBeenCalledWith(
        'git.branchDiff',
        {
          workspaceId: 'ws-1',
          baseRef: 'main',
          targetRef: 'HEAD',
          paths: ['a.ts'],
        },
        { timeoutMs: 60_000 },
      );
      expect(result).toEqual({
        success: true,
        data: [{ file: 'a.ts', chunks: [], oldContent: 'old-a', newContent: 'new-a' }],
      });
    });

    it('omits paths when empty and forwards baseCommitSha; unresolvable boundary folds to []', async () => {
      mockedRequest.mockResolvedValueOnce([]);

      const result = await mockInvoke(IPC_CHANNELS.GIT.DIFF, {
        workspaceId: 'ws-1',
        paths: [],
        baseCommitSha: 'dead',
      });

      expect(mockedRequest).toHaveBeenCalledWith(
        'git.branchDiff',
        { workspaceId: 'ws-1', baseCommitSha: 'dead' },
        { timeoutMs: 60_000 },
      );
      expect(result).toEqual({ success: true, data: [] });
    });

    it('folds a daemon rejection into the error envelope', async () => {
      mockedRequest.mockRejectedValueOnce(new Error('workspace not found'));
      expect(
        await mockInvoke(IPC_CHANNELS.GIT.DIFF, { workspaceId: 'ws-1', baseRef: 'main' }),
      ).toEqual({ success: false, error: 'workspace not found' });
    });
  });

  describe('git:isRepository → host.directoryStatus', () => {
    it("maps isGitRepo onto the caller's top-level isRepository read", async () => {
      mockedRequest.mockResolvedValueOnce({ exists: true, isGitRepo: true });

      const result = await mockInvoke(IPC_CHANNELS.GIT_EXT.IS_REPOSITORY, { path: '/repo' });

      expect(mockedRequest).toHaveBeenCalledWith('host.directoryStatus', { path: '/repo' });
      expect(result).toEqual({ success: true, isRepository: true, data: true });
    });

    it('a failed probe folds to the error envelope', async () => {
      mockedRequest.mockRejectedValueOnce(new Error('nope'));
      expect(await mockInvoke(IPC_CHANNELS.GIT_EXT.IS_REPOSITORY, { path: '/x' })).toEqual({
        success: false,
        error: 'nope',
      });
    });
  });

  describe('git-tracking:get-remote-url → git -C <repoPath> config remote.origin.url', () => {
    it('parses a github ssh remote into owner/repo (path-based, no workspace cwd)', async () => {
      mockedRequest.mockResolvedValueOnce(
        execResult({ stdout: 'git@github.com:acme/widgets.git\n' }),
      );

      const result = await mockInvoke(IPC_CHANNELS.GIT_TRACKING.GET_REMOTE_URL, {
        repoPath: '/src/widgets',
      });

      expect(mockedRequest).toHaveBeenCalledWith('host.exec', {
        command: 'git',
        args: ['-C', '/src/widgets', 'config', '--get', 'remote.origin.url'],
        timeoutMs: 60_000,
      });
      expect(result).toEqual({
        success: true,
        data: { remoteUrl: 'git@github.com:acme/widgets.git', owner: 'acme', repo: 'widgets' },
      });
    });

    it('no origin remote is a soft empty result, not an error (legacy parity)', async () => {
      mockedRequest.mockResolvedValueOnce(execResult({ exitCode: 1 }));
      expect(
        await mockInvoke(IPC_CHANNELS.GIT_TRACKING.GET_REMOTE_URL, { repoPath: '/src/x' }),
      ).toEqual({ success: true, data: { remoteUrl: '', owner: null, repo: null } });
    });

    it('a non-github remote keeps the URL with null owner/repo', async () => {
      mockedRequest.mockResolvedValueOnce(
        execResult({ stdout: 'https://gitlab.com/acme/widgets.git\n' }),
      );
      expect(
        await mockInvoke(IPC_CHANNELS.GIT_TRACKING.GET_REMOTE_URL, { repoPath: '/src/x' }),
      ).toEqual({
        success: true,
        data: { remoteUrl: 'https://gitlab.com/acme/widgets.git', owner: null, repo: null },
      });
    });
  });

  describe('workspace:rename-branch → git.renameBranch (§5.6)', () => {
    it('reads the current branch via git.status and forwards it to git.renameBranch', async () => {
      mockedRequest
        .mockResolvedValueOnce({ branch: 'add-dark-mode' })
        .mockResolvedValueOnce({ ok: true, oldBranch: 'add-dark-mode', newBranch: 'feature/renamed' });

      const result = await mockInvoke(IPC_CHANNELS.WORKSPACE.RENAME_BRANCH, {
        id: 'ws-1',
        newBranchName: 'feature/renamed',
      });

      expect(mockedRequest).toHaveBeenNthCalledWith(1, 'git.status', { workspaceId: 'ws-1' });
      expect(mockedRequest).toHaveBeenNthCalledWith(2, 'git.renameBranch', {
        workspaceId: 'ws-1',
        oldBranchName: 'add-dark-mode',
        newBranchName: 'feature/renamed',
      });
      expect(result).toEqual({ success: true });
    });

    it('folds a daemon rejection into the error envelope', async () => {
      mockedRequest
        .mockResolvedValueOnce({ branch: 'add-dark-mode' })
        .mockRejectedValueOnce(new Error('fatal: a branch named x already exists'));

      expect(
        await mockInvoke(IPC_CHANNELS.WORKSPACE.RENAME_BRANCH, { id: 'ws-1', newBranchName: 'x' }),
      ).toEqual({ success: false, error: 'fatal: a branch named x already exists' });
    });

    it('rejects when git.status has no branch (detached HEAD or missing worktree)', async () => {
      mockedRequest.mockResolvedValueOnce({ branch: '' });
      expect(
        await mockInvoke(IPC_CHANNELS.WORKSPACE.RENAME_BRANCH, { id: 'ws-1', newBranchName: 'x' }),
      ).toEqual({ success: false, error: 'Failed to rename branch: current branch is unknown' });
      expect(mockedRequest).toHaveBeenCalledTimes(1);
    });

    it('validates params without touching the wire', async () => {
      expect(
        await mockInvoke(IPC_CHANNELS.WORKSPACE.RENAME_BRANCH, { newBranchName: 'x' }),
      ).toEqual({ success: false, error: 'Invalid workspace ID' });
      expect(
        await mockInvoke(IPC_CHANNELS.WORKSPACE.RENAME_BRANCH, { id: 'ws-1', newBranchName: '  ' }),
      ).toEqual({ success: false, error: 'Invalid branch name' });
      expect(mockedRequest).not.toHaveBeenCalled();
    });
  });
});
