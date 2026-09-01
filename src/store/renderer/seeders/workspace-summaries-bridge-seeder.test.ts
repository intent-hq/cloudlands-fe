/**
 * Wire-contract tests for the workspace summaries IPC bridge seeder.
 *
 * Asserts `workspace:get-diff-summary` / `workspace:get-git-summary` (a)
 * forward to the daemon RPCs (`git.status` / `git.numstat` /
 * `workspace.get` / `git.branchStatus` / `git.commits`, PROTOCOL §5.1/§5.6)
 * with the exact method + params, and (b) map the daemon results to the
 * legacy `{ success, data?, error? }` envelope the call site
 * (workspace.client.ts invokeFresh) consumes — `data: null` for the legacy
 * "no summary" undefined.
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

/** Route the mock by daemon method so multi-RPC handlers stay readable. */
function routeRequests(routes: Record<string, unknown | Error | ((params: any) => unknown)>) {
  mockedRequest.mockImplementation(async (method: string, params?: unknown) => {
    if (!(method in routes)) throw new Error(`Unrouted daemon method: ${method}`);
    const route = routes[method];
    if (route instanceof Error) throw route;
    return typeof route === 'function' ? (route as (p: unknown) => unknown)(params) : route;
  });
}

describe('workspace-summaries-bridge-seeder', () => {
  beforeAll(async () => {
    // Importing the seeder runs its `registerMockIpcHandler` side effects.
    await import('./workspace-summaries-bridge-seeder');
  });

  afterEach(() => vi.clearAllMocks());

  describe('workspace:get-diff-summary → git.status + git.numstat (§5.6)', () => {
    it('tallies changed files from git.status and line stats from git.numstat', async () => {
      routeRequests({
        'git.status': {
          branch: 'feat',
          ahead: 0,
          behind: 0,
          files: [
            { path: 'a.ts', status: 'modified', staged: false },
            { path: 'a.ts', status: 'modified', staged: true },
            { path: 'b.ts', status: 'untracked', staged: false },
          ],
        },
        'git.numstat': [
          { filePath: 'a.ts', additions: 3, deletions: 1 },
          { filePath: 'b.ts', additions: 2, deletions: 0 },
        ],
      });

      const result = (await mockInvoke(IPC_CHANNELS.WORKSPACE.GET_DIFF_SUMMARY, {
        workspaceId: 'ws-1',
      })) as { success: boolean; data: Record<string, unknown> };

      expect(mockedRequest).toHaveBeenCalledWith('git.status', { workspaceId: 'ws-1' });
      expect(mockedRequest).toHaveBeenCalledWith(
        'git.numstat',
        { workspaceId: 'ws-1' },
        { timeoutMs: 60_000 },
      );
      expect(result.success).toBe(true);
      // a.ts is deduped across its staged/unstaged rows.
      expect(result.data).toMatchObject({
        schemaVersion: 1,
        totalFiles: 2,
        totalAdditions: 5,
        totalDeletions: 1,
        files: [],
      });
      expect(typeof result.data.updatedAt).toBe('string');
    });

    it('uses totalFiles when git.status is truncated (v8.4 5000-entry cap)', async () => {
      routeRequests({
        'git.status': {
          files: [{ path: 'a.ts', status: 'modified', staged: false }],
          filesTruncated: true,
          totalFiles: 6234,
        },
        'git.numstat': [{ filePath: 'a.ts', additions: 1, deletions: 1 }],
      });

      const result = (await mockInvoke(IPC_CHANNELS.WORKSPACE.GET_DIFF_SUMMARY, {
        workspaceId: 'ws-1',
      })) as { success: boolean; data: Record<string, unknown> };

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ totalFiles: 6234 });
    });

    it('returns data:null when git.status reports no changed files (legacy parity)', async () => {
      routeRequests({
        'git.status': { branch: 'feat', ahead: 0, behind: 0, files: [] },
      });

      expect(
        await mockInvoke(IPC_CHANNELS.WORKSPACE.GET_DIFF_SUMMARY, { workspaceId: 'ws-1' }),
      ).toEqual({ success: true, data: null });
      expect(mockedRequest).toHaveBeenCalledTimes(1);
    });

    it('keeps the summary with zero line stats when git.numstat fails (non-fatal, legacy parity)', async () => {
      routeRequests({
        'git.status': { files: [{ path: 'a.ts', status: 'modified', staged: false }] },
        'git.numstat': new Error('numstat exploded'),
      });

      const result = (await mockInvoke(IPC_CHANNELS.WORKSPACE.GET_DIFF_SUMMARY, {
        workspaceId: 'ws-1',
      })) as { success: boolean; data: Record<string, unknown> };

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ totalFiles: 1, totalAdditions: 0, totalDeletions: 0 });
    });

    it('folds a git.status rejection into the error envelope', async () => {
      routeRequests({ 'git.status': new Error('daemon unavailable') });

      expect(
        await mockInvoke(IPC_CHANNELS.WORKSPACE.GET_DIFF_SUMMARY, { workspaceId: 'ws-1' }),
      ).toEqual({ success: false, error: 'daemon unavailable' });
    });

    it('rejects a missing workspaceId without touching the wire', async () => {
      expect(await mockInvoke(IPC_CHANNELS.WORKSPACE.GET_DIFF_SUMMARY, {})).toEqual({
        success: false,
        error: 'Invalid workspace ID',
      });
      expect(mockedRequest).not.toHaveBeenCalled();
    });
  });

  describe('workspace:get-git-summary → workspace.get + git.branchStatus + git.status + git.commits', () => {
    const WORKSPACE = {
      workspace: { id: 'ws-1', worktreePath: '/wt/ws-1', baseRef: 'develop' },
    };

    it('resolves baseRef via workspace.get, ahead/behind via git.branchStatus, commits via git.commits', async () => {
      routeRequests({
        'workspace.get': WORKSPACE,
        'git.branchStatus': {
          branch: 'develop',
          currentBranch: 'feat',
          isCurrentBranch: false,
          ahead: 2,
          behind: 1,
          hasUncommittedChanges: false,
        },
        'git.status': {
          branch: 'feat',
          ahead: 2,
          behind: 0,
          files: [],
          hasUpstream: true,
          unpushedCount: 2,
        },
        'git.commits': {
          items: [
            { hash: 'a'.repeat(40), sha: 'abcdef1', message: 'feat: one\n\nbody' },
            { hash: 'b'.repeat(40), sha: 'abcdef2', message: 'fix: two' },
          ],
        },
      });

      const result = await mockInvoke(IPC_CHANNELS.WORKSPACE.GET_GIT_SUMMARY, {
        workspaceId: 'ws-1',
      });

      expect(mockedRequest).toHaveBeenCalledWith('workspace.get', { workspaceId: 'ws-1' });
      expect(mockedRequest).toHaveBeenCalledWith('git.branchStatus', {
        repoPath: '/wt/ws-1',
        branchName: 'develop',
      });
      expect(mockedRequest).toHaveBeenCalledWith('git.status', { workspaceId: 'ws-1' });
      // limit = min(ahead, 6).
      expect(mockedRequest).toHaveBeenCalledWith('git.commits', { workspaceId: 'ws-1', limit: 2 });
      expect(result).toEqual({
        success: true,
        data: {
          ahead: 2,
          behind: 1,
          hasUnpushed: true,
          commits: [
            { sha: 'abcdef1', title: 'feat: one' },
            { sha: 'abcdef2', title: 'fix: two' },
          ],
        },
      });
    });

    it('defaults a missing baseRef to main and caps the commit limit at 6', async () => {
      routeRequests({
        'workspace.get': { workspace: { id: 'ws-1', worktreePath: '/wt/ws-1' } },
        'git.branchStatus': { ahead: 9, behind: 0 },
        'git.status': { ahead: 9, files: [] },
        'git.commits': { items: [] },
      });

      const result = (await mockInvoke(IPC_CHANNELS.WORKSPACE.GET_GIT_SUMMARY, {
        workspaceId: 'ws-1',
      })) as { success: boolean; data: Record<string, unknown> };

      expect(mockedRequest).toHaveBeenCalledWith('git.branchStatus', {
        repoPath: '/wt/ws-1',
        branchName: 'main',
      });
      expect(mockedRequest).toHaveBeenCalledWith('git.commits', { workspaceId: 'ws-1', limit: 6 });
      expect(result.data).toMatchObject({ ahead: 9, behind: 0, commits: [] });
    });

    it('returns data:null when the branch is even with its base (legacy parity)', async () => {
      routeRequests({
        'workspace.get': WORKSPACE,
        'git.branchStatus': { ahead: 0, behind: 0 },
      });

      expect(
        await mockInvoke(IPC_CHANNELS.WORKSPACE.GET_GIT_SUMMARY, { workspaceId: 'ws-1' }),
      ).toEqual({ success: true, data: null });
      // Even → no git.status/git.commits round trips.
      expect(mockedRequest).toHaveBeenCalledTimes(2);
    });

    it('returns data:null when the workspace has no worktreePath (legacy parity)', async () => {
      routeRequests({ 'workspace.get': { workspace: { id: 'ws-1' } } });

      expect(
        await mockInvoke(IPC_CHANNELS.WORKSPACE.GET_GIT_SUMMARY, { workspaceId: 'ws-1' }),
      ).toEqual({ success: true, data: null });
      expect(mockedRequest).toHaveBeenCalledTimes(1);
    });

    it('folds a git.branchStatus failure to 0/0 → data:null (legacy `|| echo 0` parity)', async () => {
      routeRequests({
        'workspace.get': WORKSPACE,
        'git.branchStatus': new Error('Path is not a git repository: /wt/ws-1'),
      });

      expect(
        await mockInvoke(IPC_CHANNELS.WORKSPACE.GET_GIT_SUMMARY, { workspaceId: 'ws-1' }),
      ).toEqual({ success: true, data: null });
    });

    it('falls back to the base-ahead count for hasUnpushed when git.status fails, and tolerates a git.commits failure', async () => {
      routeRequests({
        'workspace.get': WORKSPACE,
        'git.branchStatus': { ahead: 1, behind: 0 },
        'git.status': new Error('status exploded'),
        'git.commits': new Error('commits exploded'),
      });

      expect(
        await mockInvoke(IPC_CHANNELS.WORKSPACE.GET_GIT_SUMMARY, { workspaceId: 'ws-1' }),
      ).toEqual({
        success: true,
        data: { ahead: 1, behind: 0, hasUnpushed: true, commits: [] },
      });
    });

    it('reads hasUnpushed:false off an upstream-even git.status without commits round trips when only behind', async () => {
      routeRequests({
        'workspace.get': WORKSPACE,
        'git.branchStatus': { ahead: 0, behind: 3 },
        'git.status': { ahead: 0, files: [], hasUpstream: true, unpushedCount: 0 },
      });

      expect(
        await mockInvoke(IPC_CHANNELS.WORKSPACE.GET_GIT_SUMMARY, { workspaceId: 'ws-1' }),
      ).toEqual({
        success: true,
        data: { ahead: 0, behind: 3, hasUnpushed: false, commits: [] },
      });
      // ahead === 0 → no git.commits call.
      expect(mockedRequest).not.toHaveBeenCalledWith('git.commits', expect.anything());
    });

    it('reads hasUnpushed:false when the upstream is even (unpushedCount 0) despite commits ahead of the base', async () => {
      routeRequests({
        'workspace.get': WORKSPACE,
        'git.branchStatus': { ahead: 2, behind: 0 },
        'git.status': { ahead: 0, files: [], hasUpstream: true, unpushedCount: 0 },
        'git.commits': { items: [] },
      });

      expect(
        await mockInvoke(IPC_CHANNELS.WORKSPACE.GET_GIT_SUMMARY, { workspaceId: 'ws-1' }),
      ).toEqual({
        success: true,
        data: { ahead: 2, behind: 0, hasUnpushed: false, commits: [] },
      });
    });

    it('reads hasUnpushed:true for a never-pushed branch ahead of its base (hasUpstream:false, legacy parity)', async () => {
      routeRequests({
        'workspace.get': WORKSPACE,
        'git.branchStatus': { ahead: 1, behind: 0 },
        // No upstream: unpushedCount is omitted entirely (monorepo#4058).
        'git.status': { ahead: 0, behind: 0, files: [], hasUpstream: false },
        'git.commits': { items: [] },
      });

      expect(
        await mockInvoke(IPC_CHANNELS.WORKSPACE.GET_GIT_SUMMARY, { workspaceId: 'ws-1' }),
      ).toEqual({
        success: true,
        data: { ahead: 1, behind: 0, hasUnpushed: true, commits: [] },
      });
    });

    it('falls back to the upstream-relative ahead approximation on a pre-#4058 daemon (hasUpstream absent)', async () => {
      routeRequests({
        'workspace.get': WORKSPACE,
        'git.branchStatus': { ahead: 1, behind: 0 },
        'git.status': { ahead: 3, behind: 0, files: [] },
        'git.commits': { items: [] },
      });

      expect(
        await mockInvoke(IPC_CHANNELS.WORKSPACE.GET_GIT_SUMMARY, { workspaceId: 'ws-1' }),
      ).toEqual({
        success: true,
        data: { ahead: 1, behind: 0, hasUnpushed: true, commits: [] },
      });
    });

    it('folds a workspace.get rejection into the error envelope', async () => {
      routeRequests({ 'workspace.get': new Error('workspace not found') });

      expect(
        await mockInvoke(IPC_CHANNELS.WORKSPACE.GET_GIT_SUMMARY, { workspaceId: 'ws-1' }),
      ).toEqual({ success: false, error: 'workspace not found' });
    });

    it('rejects a missing workspaceId without touching the wire', async () => {
      expect(await mockInvoke(IPC_CHANNELS.WORKSPACE.GET_GIT_SUMMARY, {})).toEqual({
        success: false,
        error: 'Invalid workspace ID',
      });
      expect(mockedRequest).not.toHaveBeenCalled();
    });
  });
});
