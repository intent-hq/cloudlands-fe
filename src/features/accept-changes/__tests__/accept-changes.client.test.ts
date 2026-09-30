/**
 * Wire-contract tests for AcceptChangesClient over backendRequest.
 *
 * The accept-changes workflow is served by the intentd daemon
 * (`accept-changes.*`, PROTOCOL.md §5.18). These tests assert the exact
 * JSON-RPC method + params each client call sends, feed PROTOCOL.md-shaped
 * mock responses back, and cover the in-band failure conversion for
 * execute/mergePR/resetToTrunk.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import { store } from '$store/renderer/store';
import { initialState as guestInitialState } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
import { acceptWorkflowSaga } from '$store/renderer/slices/accept-workflow/sagas/accept-workflow-saga';
import { isGitMutationPending } from '$store/renderer/utils/worktree-mutation-queue';
import { AcceptChangesClient } from '../accept-changes.client';
import type { WorkspaceId } from '$shared/types/branded-ids';

const mocks = vi.hoisted(() => ({
  backendRequest: vi.fn(),
}));
vi.mock('$lib/client', () => ({ appClient: {} }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: {} }));

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.backendRequest,
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
  let task: Task;
  beforeEach(() => {
    mocks.backendRequest.mockReset();
    const channel = stdChannel();
    const state = {
      workspace: { workspaces: createCollection('id', [{ id: WS, myRole: 'owner' }]) },
      connections: { activeId: LOCAL_CONNECTION_ID, windowBackendId: LOCAL_CONNECTION_ID },
      guestSessions: { ...guestInitialState, hasReceivedList: true },
    };
    task = runSaga(
      { channel, dispatch: (action) => channel.put(action), getState: () => state },
      acceptWorkflowSaga,
    );
    vi.spyOn(store, 'dispatch', 'get').mockReturnValue(((action: {
      promise: Promise<unknown>;
      type: string;
    }) => {
      channel.put(action);
      return action.promise;
    }) as typeof store.dispatch);
  });
  afterEach(async () => {
    task.cancel();
    await task.toPromise();
    vi.restoreAllMocks();
  });

  it.each([
    {
      name: 'execute',
      invoke: () => AcceptChangesClient.execute(WS, 'commit', { commitMessage: 'msg' }),
      method: 'accept-changes.execute',
      params: {
        workspaceId: WS,
        action: 'commit',
        files: undefined,
        commitMessage: 'msg',
        prTitle: undefined,
        prBody: undefined,
        targetBranch: undefined,
        mergeStrategy: undefined,
        upToCommitHash: undefined,
        undoCommitsMetadata: undefined,
        options: {
          stageUnstaged: undefined,
          pushAfterCommit: undefined,
          createPRAfterPush: undefined,
          rebaseFirst: undefined,
          localOnly: undefined,
        },
      },
    },
    {
      name: 'mergePR',
      invoke: () => AcceptChangesClient.mergePR(WS, 42, { mergeMethod: 'squash' }),
      method: 'accept-changes.mergePR',
      params: {
        workspaceId: WS,
        prNumber: 42,
        mergeMethod: 'squash',
        commitTitle: undefined,
        commitMessage: undefined,
      },
    },
    {
      name: 'resetToTrunk',
      invoke: () => AcceptChangesClient.resetToTrunk(WS),
      method: 'accept-changes.execute',
      params: { workspaceId: WS, action: 'reset-to-trunk' },
    },
  ])(
    '$name resolves cancellation as an in-band failure after sending its exact wire request',
    async ({ invoke, method, params }) => {
      let resolve!: (value: { success: boolean; steps: never[] }) => void;
      mocks.backendRequest.mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      const result = invoke();
      try {
        await vi.waitFor(() =>
          expect(mocks.backendRequest).toHaveBeenCalledExactlyOnceWith(method, params),
        );
        task.cancel();
        await task.toPromise();
        await expect(result).resolves.toEqual({
          success: false,
          steps: [],
          error: 'Accept workflow cancelled',
        });
        expect(isGitMutationPending(WS)).toBe(true);
      } finally {
        resolve({ success: true, steps: [] });
        await vi.waitFor(() => expect(isGitMutationPending(WS)).toBe(false));
      }
    },
  );

  it.each([
    {
      name: 'prepare',
      invoke: () => AcceptChangesClient.prepare(WS, 'commit', ['a.ts']),
      method: 'accept-changes.prepare',
      params: { workspaceId: WS, action: 'commit', files: ['a.ts'] },
      response: {
        valid: true,
        warnings: [],
        errors: [],
        filesCount: 0,
        additions: 0,
        deletions: 0,
        files: [],
      },
    },
    {
      name: 'addRemote',
      invoke: () => AcceptChangesClient.addRemote(WS, 'git@github.com:o/r.git'),
      method: 'accept-changes.addRemote',
      params: { workspaceId: WS, remoteUrl: 'git@github.com:o/r.git' },
      response: gitStatus,
    },
  ])(
    '$name still rejects cancellation after sending its exact wire request',
    async ({ invoke, method, params, response }) => {
      let resolve!: (value: unknown) => void;
      mocks.backendRequest.mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      const result = invoke();
      const rejected = expect(result).rejects.toThrow('Accept workflow cancelled');
      try {
        await vi.waitFor(() =>
          expect(mocks.backendRequest).toHaveBeenCalledExactlyOnceWith(method, params),
        );
        task.cancel();
        await task.toPromise();
        await rejected;
      } finally {
        resolve(response);
        await vi.waitFor(() => expect(isGitMutationPending(WS)).toBe(false));
      }
    },
  );

  it('getStatus sends accept-changes.getStatus with workspaceId and returns the status', async () => {
    mocks.backendRequest.mockResolvedValue(gitStatus);
    const status = await AcceptChangesClient.getStatus(WS);
    expect(mocks.backendRequest).toHaveBeenCalledWith('accept-changes.getStatus', {
      workspaceId: WS,
    });
    expect(status).toEqual(gitStatus);
  });

  describe('getStatus single-flight', () => {
    it('coalesces two concurrent calls for the same workspace into one backendRequest', async () => {
      let resolveRequest!: (value: typeof gitStatus) => void;
      mocks.backendRequest.mockReturnValue(
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
      );

      const first = AcceptChangesClient.getStatus(WS);
      const second = AcceptChangesClient.getStatus(WS);

      expect(mocks.backendRequest).toHaveBeenCalledTimes(1);

      resolveRequest(gitStatus);
      const [firstResult, secondResult] = await Promise.all([first, second]);

      expect(firstResult).toEqual(gitStatus);
      expect(secondResult).toEqual(gitStatus);
      expect(mocks.backendRequest).toHaveBeenCalledTimes(1);
    });

    it('does not share in-flight requests across different workspaces', async () => {
      const WS2 = 'ws-def' as WorkspaceId;
      let resolveFirst!: (value: typeof gitStatus) => void;
      let resolveSecond!: (value: typeof gitStatus) => void;
      mocks.backendRequest
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
        )
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
        );

      const first = AcceptChangesClient.getStatus(WS);
      const second = AcceptChangesClient.getStatus(WS2);

      expect(mocks.backendRequest).toHaveBeenCalledTimes(2);
      expect(mocks.backendRequest).toHaveBeenNthCalledWith(1, 'accept-changes.getStatus', {
        workspaceId: WS,
      });
      expect(mocks.backendRequest).toHaveBeenNthCalledWith(2, 'accept-changes.getStatus', {
        workspaceId: WS2,
      });

      resolveFirst(gitStatus);
      resolveSecond({ ...gitStatus, branch: 'other' });
      await Promise.all([first, second]);
    });

    it('issues a fresh request for a call after the previous one has settled', async () => {
      mocks.backendRequest.mockResolvedValueOnce(gitStatus);
      const first = await AcceptChangesClient.getStatus(WS);
      expect(first).toEqual(gitStatus);
      expect(mocks.backendRequest).toHaveBeenCalledTimes(1);

      const updatedStatus = { ...gitStatus, aheadOfTrunk: 2 };
      mocks.backendRequest.mockResolvedValueOnce(updatedStatus);
      const second = await AcceptChangesClient.getStatus(WS);
      expect(second).toEqual(updatedStatus);
      expect(mocks.backendRequest).toHaveBeenCalledTimes(2);
    });

    it('clears the in-flight entry on rejection so the next call retries', async () => {
      mocks.backendRequest.mockRejectedValueOnce(new Error('daemon unavailable'));
      await expect(AcceptChangesClient.getStatus(WS)).rejects.toThrow('daemon unavailable');
      expect(mocks.backendRequest).toHaveBeenCalledTimes(1);

      mocks.backendRequest.mockResolvedValueOnce(gitStatus);
      const retried = await AcceptChangesClient.getStatus(WS);
      expect(retried).toEqual(gitStatus);
      expect(mocks.backendRequest).toHaveBeenCalledTimes(2);
    });

    it('forceRefresh issues a fresh request instead of joining an in-flight one', async () => {
      let resolveFirst!: (value: typeof gitStatus) => void;
      mocks.backendRequest.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      );

      const first = AcceptChangesClient.getStatus(WS);

      const updatedStatus = { ...gitStatus, aheadOfTrunk: 5 };
      mocks.backendRequest.mockResolvedValueOnce(updatedStatus);
      const forced = AcceptChangesClient.getStatus(WS, { forceRefresh: true });

      expect(mocks.backendRequest).toHaveBeenCalledTimes(2);

      resolveFirst(gitStatus);
      const [firstResult, forcedResult] = await Promise.all([first, forced]);
      expect(firstResult).toEqual(gitStatus);
      expect(forcedResult).toEqual(updatedStatus);
    });

    it('forceRefresh republishes the fresh request so subsequent non-forced callers join it, not the stale one', async () => {
      let resolveFirst!: (value: typeof gitStatus) => void;
      let resolveForced!: (value: typeof gitStatus) => void;
      mocks.backendRequest
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
        )
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveForced = resolve;
          }),
        );

      const first = AcceptChangesClient.getStatus(WS);
      const forced = AcceptChangesClient.getStatus(WS, { forceRefresh: true });
      // A non-forced call issued after the forced one should join the fresh
      // (forced) in-flight request, not the stale pre-mutation one.
      const joiner = AcceptChangesClient.getStatus(WS);

      expect(mocks.backendRequest).toHaveBeenCalledTimes(2);

      const updatedStatus = { ...gitStatus, aheadOfTrunk: 7 };
      resolveForced(updatedStatus);
      resolveFirst(gitStatus);

      const [firstResult, forcedResult, joinerResult] = await Promise.all([first, forced, joiner]);
      expect(firstResult).toEqual(gitStatus);
      expect(forcedResult).toEqual(updatedStatus);
      expect(joinerResult).toEqual(updatedStatus);
      expect(mocks.backendRequest).toHaveBeenCalledTimes(2);
    });

    it('does not clear a fresher forced entry when the stale pre-mutation request settles after it', async () => {
      let resolveFirst!: (value: typeof gitStatus) => void;
      mocks.backendRequest.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      );
      const first = AcceptChangesClient.getStatus(WS);

      const updatedStatus = { ...gitStatus, aheadOfTrunk: 9 };
      mocks.backendRequest.mockResolvedValueOnce(updatedStatus);
      const forced = await AcceptChangesClient.getStatus(WS, { forceRefresh: true });
      expect(forced).toEqual(updatedStatus);

      // The stale request settles after the forced one already cleared/replaced the map entry.
      resolveFirst(gitStatus);
      await first;

      // A subsequent call should issue a brand-new request, not resurrect the stale one.
      mocks.backendRequest.mockResolvedValueOnce(gitStatus);
      const next = await AcceptChangesClient.getStatus(WS);
      expect(next).toEqual(gitStatus);
      expect(mocks.backendRequest).toHaveBeenCalledTimes(3);
    });
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
});
