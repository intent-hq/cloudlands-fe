/**
 * Wire-contract tests for the git IPC bridge seeder.
 *
 * Asserts each legacy `git:*` / `git-tracking:*` channel (a) forwards to the
 * daemon-owned exec (`host.exec`, PROTOCOL §5.14) / `host.directoryStatus`
 * with the exact argv + workspace-cwd containment params, and (b) maps the
 * exec result to the legacy `{ success, data?, error? }` envelope the call
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

  describe('git:push / git:fetch → host.exec (§5.14)', () => {
    it('push runs `git push` in the workspace root with the 5-min network timeout', async () => {
      mockedRequest.mockResolvedValueOnce(execResult());

      const result = await mockInvoke(IPC_CHANNELS.GIT.PUSH, { workspaceId: 'ws-1' });

      expect(mockedRequest).toHaveBeenCalledWith('host.exec', {
        command: 'git',
        args: ['push'],
        cwd: '.',
        workspaceId: 'ws-1',
        timeoutMs: 300_000,
      });
      expect(result).toEqual({ success: true });
    });

    it('push force:true uses --force-with-lease and folds a non-zero exit to the stderr message', async () => {
      mockedRequest.mockResolvedValueOnce(
        execResult({ exitCode: 1, stderr: 'rejected: stale info\n' }),
      );

      const result = await mockInvoke(IPC_CHANNELS.GIT.PUSH, {
        workspaceId: 'ws-1',
        force: true,
      });

      expect(mockedRequest.mock.calls[0][1]).toMatchObject({
        args: ['push', '--force-with-lease'],
      });
      expect(result).toEqual({ success: false, error: 'rejected: stale info' });
    });

    it('push without a workspaceId fails without touching the wire', async () => {
      expect(await mockInvoke(IPC_CHANNELS.GIT.PUSH, {})).toEqual({
        success: false,
        error: 'Invalid workspace ID',
      });
      expect(mockedRequest).not.toHaveBeenCalled();
    });

    it('fetch runs `git fetch` and folds a transport throw into the error envelope', async () => {
      mockedRequest.mockResolvedValueOnce(execResult());
      expect(await mockInvoke(IPC_CHANNELS.GIT.FETCH, { workspaceId: 'ws-1' })).toEqual({
        success: true,
      });
      expect(mockedRequest).toHaveBeenCalledWith('host.exec', {
        command: 'git',
        args: ['fetch'],
        cwd: '.',
        workspaceId: 'ws-1',
        timeoutMs: 300_000,
      });

      mockedRequest.mockRejectedValueOnce(new Error('daemon unavailable'));
      expect(await mockInvoke(IPC_CHANNELS.GIT.FETCH, { workspaceId: 'ws-1' })).toEqual({
        success: false,
        error: 'daemon unavailable',
      });
    });
  });

  describe('git:stage-hunk / git:unstage-hunk → git apply --cached via sh pipe', () => {
    const PATCH = '--- a/f.ts\n+++ b/f.ts\n@@ -1 +1 @@\n-a\n+b\n';

    it('stage-hunk pipes the patch as a positional arg into `git apply --cached -`', async () => {
      mockedRequest.mockResolvedValueOnce(execResult());

      const result = await mockInvoke(IPC_CHANNELS.GIT.STAGE_HUNK, {
        workspaceId: 'ws-1',
        filePath: 'f.ts',
        hunkPatch: PATCH,
      });

      expect(mockedRequest).toHaveBeenCalledWith('host.exec', {
        command: 'sh',
        args: ['-c', 'printf %s "$1" | git apply --cached -', 'sh', PATCH],
        cwd: '.',
        workspaceId: 'ws-1',
        timeoutMs: 60_000,
      });
      expect(result).toEqual({ success: true });
    });

    it('stage-hunk retries with --3way when the plain apply fails (legacy parity)', async () => {
      mockedRequest
        .mockResolvedValueOnce(execResult({ exitCode: 1, stderr: 'patch does not apply' }))
        .mockResolvedValueOnce(execResult());

      const result = await mockInvoke(IPC_CHANNELS.GIT.STAGE_HUNK, {
        workspaceId: 'ws-1',
        filePath: 'f.ts',
        hunkPatch: PATCH,
      });

      expect(mockedRequest.mock.calls[1][1]).toMatchObject({
        args: ['-c', 'printf %s "$1" | git apply --cached --3way -', 'sh', PATCH],
      });
      expect(result).toEqual({ success: true });
    });

    it('unstage-hunk reverses the apply and surfaces the exec error when both attempts fail', async () => {
      mockedRequest
        .mockResolvedValueOnce(execResult({ exitCode: 1, stderr: 'bad patch' }))
        .mockResolvedValueOnce(execResult({ exitCode: 1, stderr: 'bad patch' }));

      const result = await mockInvoke(IPC_CHANNELS.GIT.UNSTAGE_HUNK, {
        workspaceId: 'ws-1',
        filePath: 'f.ts',
        hunkPatch: PATCH,
      });

      expect(mockedRequest.mock.calls[0][1]).toMatchObject({
        args: ['-c', 'printf %s "$1" | git apply --cached --reverse -', 'sh', PATCH],
      });
      expect(mockedRequest.mock.calls[1][1]).toMatchObject({
        args: ['-c', 'printf %s "$1" | git apply --cached --reverse --3way -', 'sh', PATCH],
      });
      expect(result).toEqual({ success: false, error: 'bad patch' });
    });
  });

  describe('git:numstat → git diff --numstat (legacy arg-building parity)', () => {
    it("default (staged undefined) diffs against HEAD and parses entries incl. binary '-'", async () => {
      mockedRequest.mockResolvedValueOnce(
        execResult({ stdout: '3\t1\tsrc/a.ts\n-\t-\tassets/logo.png\n' }),
      );

      const result = await mockInvoke(IPC_CHANNELS.GIT.NUMSTAT, { workspaceId: 'ws-1' });

      expect(mockedRequest).toHaveBeenCalledWith('host.exec', {
        command: 'git',
        args: ['diff', '--numstat', 'HEAD'],
        cwd: '.',
        workspaceId: 'ws-1',
        timeoutMs: 60_000,
      });
      expect(result).toEqual({
        success: true,
        data: [
          { filePath: 'src/a.ts', additions: 3, deletions: 1 },
          { filePath: 'assets/logo.png', additions: 0, deletions: 0 },
        ],
      });
    });

    it('staged:true uses --cached; staged:false diffs the plain worktree', async () => {
      mockedRequest.mockResolvedValueOnce(execResult({ stdout: '' }));
      await mockInvoke(IPC_CHANNELS.GIT.NUMSTAT, { workspaceId: 'ws-1', staged: true });
      expect(mockedRequest.mock.calls[0][1]).toMatchObject({
        args: ['diff', '--numstat', '--cached'],
      });

      mockedRequest.mockResolvedValueOnce(execResult({ stdout: '' }));
      await mockInvoke(IPC_CHANNELS.GIT.NUMSTAT, { workspaceId: 'ws-1', staged: false });
      expect(mockedRequest.mock.calls[1][1]).toMatchObject({ args: ['diff', '--numstat'] });
    });

    it('baseRef resolves origin/<base> merge-base first and diffs boundary..targetRef', async () => {
      mockedRequest
        .mockResolvedValueOnce(execResult()) // rev-parse --verify origin/main
        .mockResolvedValueOnce(execResult({ stdout: 'abc123\n' })) // merge-base
        .mockResolvedValueOnce(execResult({ stdout: '1\t0\ta.ts\n' })); // numstat

      const result = await mockInvoke(IPC_CHANNELS.GIT.NUMSTAT, {
        workspaceId: 'ws-1',
        baseRef: 'main',
      });

      expect(mockedRequest.mock.calls[0][1]).toMatchObject({
        args: ['rev-parse', '--verify', 'origin/main'],
      });
      expect(mockedRequest.mock.calls[1][1]).toMatchObject({
        args: ['merge-base', 'HEAD', 'origin/main'],
      });
      expect(mockedRequest.mock.calls[2][1]).toMatchObject({
        args: ['diff', '--numstat', 'abc123..HEAD'],
      });
      expect(result).toEqual({
        success: true,
        data: [{ filePath: 'a.ts', additions: 1, deletions: 0 }],
      });
    });

    it('an unresolvable boundary folds to an empty result (legacy /dev/null parity)', async () => {
      mockedRequest
        .mockResolvedValueOnce(execResult({ exitCode: 128 })) // rev-parse origin/gone
        .mockResolvedValueOnce(execResult({ exitCode: 128 })) // rev-parse gone
        .mockResolvedValueOnce(execResult({ exitCode: 1 })); // --is-ancestor sha

      const result = await mockInvoke(IPC_CHANNELS.GIT.NUMSTAT, {
        workspaceId: 'ws-1',
        baseRef: 'gone',
        baseCommitSha: 'dead',
      });

      expect(result).toEqual({ success: true, data: [] });
    });
  });

  describe('git:diff (branch-base only) → boundary + per-file show contents', () => {
    it('rejects non-branch-base params (working-tree diffs read the daemon git.diffs)', async () => {
      const result = await mockInvoke(IPC_CHANNELS.GIT.DIFF, {
        workspaceId: 'ws-1',
        paths: ['a.ts'],
        staged: true,
      });
      expect(result).toEqual({ success: false, error: 'Branch base information is required' });
      expect(mockedRequest).not.toHaveBeenCalled();
    });

    it('builds chunks with old/new full-file sides at boundary and targetRef', async () => {
      mockedRequest
        .mockResolvedValueOnce(execResult()) // rev-parse --verify origin/main
        .mockResolvedValueOnce(execResult({ stdout: 'base99\n' })) // merge-base
        .mockResolvedValueOnce(execResult({ stdout: 'a.ts\n' })) // diff --name-only
        .mockResolvedValueOnce(execResult({ stdout: 'old-a' })) // show base99:a.ts
        .mockResolvedValueOnce(execResult({ stdout: 'new-a' })); // show HEAD:a.ts

      const result = await mockInvoke(IPC_CHANNELS.GIT.DIFF, {
        workspaceId: 'ws-1',
        paths: ['a.ts'],
        baseRef: 'main',
        targetRef: 'HEAD',
      });

      expect(mockedRequest.mock.calls[2][1]).toMatchObject({
        args: ['diff', '--name-only', 'base99..HEAD', '--', 'a.ts'],
      });
      expect(result).toEqual({
        success: true,
        data: [{ file: 'a.ts', chunks: [], oldContent: 'old-a', newContent: 'new-a' }],
      });
    });

    it("a file missing at one ref folds that side to '' (legacy parity)", async () => {
      mockedRequest
        .mockResolvedValueOnce(execResult()) // rev-parse
        .mockResolvedValueOnce(execResult({ stdout: 'base99\n' })) // merge-base
        .mockResolvedValueOnce(execResult({ stdout: 'new-file.ts\n' })) // name-only
        .mockResolvedValueOnce(execResult({ exitCode: 128, stderr: 'does not exist' })) // old side
        .mockResolvedValueOnce(execResult({ stdout: 'created' })); // new side

      const result = await mockInvoke(IPC_CHANNELS.GIT.DIFF, {
        workspaceId: 'ws-1',
        baseRef: 'main',
      });

      expect(result).toEqual({
        success: true,
        data: [{ file: 'new-file.ts', chunks: [], oldContent: '', newContent: 'created' }],
      });
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
});
