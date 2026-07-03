/**
 * Wire-contract tests for AcceptChangesClient over backendRequest.
 *
 * The accept-changes workflow is served by the intentd daemon
 * (`accept-changes.*`, PROTOCOL.md §5.18). These tests assert the exact
 * JSON-RPC method + params each client call sends, feed PROTOCOL.md-shaped
 * mock responses back, and cover the in-band failure conversion for
 * execute/mergePR/resetToTrunk. `checkPathHasChanges` stays on local IPC.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AcceptChangesClient } from '../accept-changes.client';
import type { WorkspaceId } from '$shared/types/branded-ids';

const mocks = vi.hoisted(() => ({
  backendRequest: vi.fn(),
  invokeIpc: vi.fn(),
}));

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.backendRequest,
}));

vi.mock('$shared/generated/ipc-client', () => ({
  invoke: mocks.invokeIpc,
}));

const WS = 'ws-abc' as WorkspaceId;

const gitStatus = {
  branch: 'feature/x',
  trunkBranch: 'main',
  aheadOfTrunk: 1,
  behindTrunk: 0,
  hasRemote: true,
  isPushed: false,
  uncommittedCount: 0,
  stagedCount: 2,
  localCommits: [],
};

describe('AcceptChangesClient (accept-changes.* over backendRequest)', () => {
  beforeEach(() => {
    mocks.backendRequest.mockReset();
    mocks.invokeIpc.mockReset();
  });

  it('getStatus sends accept-changes.getStatus with workspaceId and returns the status', async () => {
    mocks.backendRequest.mockResolvedValue(gitStatus);
    const status = await AcceptChangesClient.getStatus(WS);
    expect(mocks.backendRequest).toHaveBeenCalledWith('accept-changes.getStatus', {
      workspaceId: WS,
    });
    expect(status).toEqual(gitStatus);
  });

  it('prepare sends accept-changes.prepare with workspaceId/action/files', async () => {
    const prepared = {
      valid: true,
      warnings: [],
      errors: [],
      suggestedPRTitle: 'Add review wire surface',
      suggestedPRBody: 'Body',
      filesCount: 1,
      additions: 3,
      deletions: 1,
      files: [{ path: 'a.ts', additions: 3, deletions: 1, staged: true }],
    };
    mocks.backendRequest.mockResolvedValue(prepared);
    const result = await AcceptChangesClient.prepare(WS, 'create-pr', ['a.ts']);
    expect(mocks.backendRequest).toHaveBeenCalledWith('accept-changes.prepare', {
      workspaceId: WS,
      action: 'create-pr',
      files: ['a.ts'],
    });
    expect(result).toEqual(prepared);
  });

  it('execute sends the full accept-changes.execute request shape', async () => {
    const wireResult = {
      success: true,
      steps: [{ id: 'create-pr', name: 'Create PR', status: 'completed' }],
      result: { prNumber: 7, prUrl: 'https://api/pr/7', prHtmlUrl: 'https://gh/pr/7' },
    };
    mocks.backendRequest.mockResolvedValue(wireResult);
    const result = await AcceptChangesClient.execute(WS, 'create-pr', {
      prTitle: 'Title',
      prBody: 'Body',
      targetBranch: 'main',
      commitMessage: 'Title',
      stageUnstaged: true,
    });
    expect(mocks.backendRequest).toHaveBeenCalledWith('accept-changes.execute', {
      workspaceId: WS,
      action: 'create-pr',
      files: undefined,
      commitMessage: 'Title',
      prTitle: 'Title',
      prBody: 'Body',
      targetBranch: 'main',
      mergeStrategy: undefined,
      upToCommitHash: undefined,
      undoCommitsMetadata: undefined,
      options: {
        stageUnstaged: true,
        pushAfterCommit: undefined,
        createPRAfterPush: undefined,
        rebaseFirst: undefined,
        localOnly: undefined,
      },
    });
    expect(result).toEqual(wireResult);
  });

  it('execute converts thrown daemon errors into a failed AcceptChangesResult', async () => {
    mocks.backendRequest.mockRejectedValue(new Error('workspace not found'));
    const result = await AcceptChangesClient.execute(WS, 'commit', { commitMessage: 'msg' });
    expect(result).toEqual({ success: false, steps: [], error: 'workspace not found' });
  });

  it('mergePR sends accept-changes.mergePR and converts errors in-band', async () => {
    const wireResult = { success: true, steps: [], result: { mergeCommitHash: 'deadbeef' } };
    mocks.backendRequest.mockResolvedValue(wireResult);
    const ok = await AcceptChangesClient.mergePR(WS, 42, { mergeMethod: 'squash' });
    expect(mocks.backendRequest).toHaveBeenCalledWith('accept-changes.mergePR', {
      workspaceId: WS,
      prNumber: 42,
      mergeMethod: 'squash',
      commitTitle: undefined,
      commitMessage: undefined,
    });
    expect(ok).toEqual(wireResult);

    mocks.backendRequest.mockRejectedValue(new Error('merge conflict'));
    const failed = await AcceptChangesClient.mergePR(WS, 42);
    expect(failed).toEqual({ success: false, steps: [], error: 'merge conflict' });
  });

  it('addRemote sends accept-changes.addRemote and returns the refreshed status', async () => {
    mocks.backendRequest.mockResolvedValue(gitStatus);
    const status = await AcceptChangesClient.addRemote(WS, 'git@github.com:o/r.git');
    expect(mocks.backendRequest).toHaveBeenCalledWith('accept-changes.addRemote', {
      workspaceId: WS,
      remoteUrl: 'git@github.com:o/r.git',
    });
    expect(status).toEqual(gitStatus);
  });

  it('resetToTrunk sends accept-changes.execute with action reset-to-trunk and converts errors', async () => {
    const wireResult = { success: true, steps: [], result: { newHeadSha: 'abc123' } };
    mocks.backendRequest.mockResolvedValue(wireResult);
    const ok = await AcceptChangesClient.resetToTrunk(WS);
    expect(mocks.backendRequest).toHaveBeenCalledWith('accept-changes.execute', {
      workspaceId: WS,
      action: 'reset-to-trunk',
    });
    expect(ok).toEqual(wireResult);

    mocks.backendRequest.mockRejectedValue(new Error('daemon unavailable'));
    const failed = await AcceptChangesClient.resetToTrunk(WS);
    expect(failed).toEqual({ success: false, steps: [], error: 'daemon unavailable' });
  });

  it('checkPathHasChanges stays on local IPC (accept-changes:check-path-has-changes)', async () => {
    mocks.invokeIpc.mockResolvedValue({
      success: true,
      data: { hasChanges: true, isGitRepo: true },
    });
    const result = await AcceptChangesClient.checkPathHasChanges('/some/path');
    expect(mocks.invokeIpc).toHaveBeenCalledWith('accept-changes:check-path-has-changes', {
      targetPath: '/some/path',
    });
    expect(mocks.backendRequest).not.toHaveBeenCalled();
    expect(result).toEqual({ hasChanges: true, isGitRepo: true });
  });
});
