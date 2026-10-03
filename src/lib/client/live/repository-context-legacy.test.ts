import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { WorkspaceId } from '$shared/types/branded-ids';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import { store } from '$store/renderer/store';
import { initialState as guestInitialState } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
import { acceptWorkflowSaga } from '$store/renderer/slices/accept-workflow/sagas/accept-workflow-saga';
import { withLegacyPrincipal } from '../../../test/fixtures/principal-state';
import { AcceptChangesClient } from '$features/accept-changes/accept-changes.client';
import { LiveIntegrationsClient } from './live-integrations-client';
import { backendRequest } from './backend-transport';

vi.mock('./backend-transport', () => ({ backendRequest: vi.fn() }));
vi.mock('$lib/client', () => ({ appClient: {} }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: {} }));

const request = vi.mocked(backendRequest);

describe('repository context integration preserves legacy GitHub adapters', () => {
  let task: Task;
  beforeEach(() => {
    request.mockReset();
    const channel = stdChannel();
    const state = withLegacyPrincipal({
      workspace: {
        workspaces: createCollection('id', [{ id: 'workspace-original', myRole: 'owner' }]),
      },
      connections: { activeId: LOCAL_CONNECTION_ID, windowBackendId: LOCAL_CONNECTION_ID },
      guestSessions: { ...guestInitialState, hasReceivedList: true },
    });
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
    ['open', false, false, false, 'open'],
    ['open', false, true, false, 'draft'],
    ['open', false, false, true, 'queued'],
    ['closed', false, true, false, 'closed'],
    ['closed', true, false, false, 'merged'],
  ] as const)(
    'preserves review metadata for %s / merged=%s / draft=%s / queued=%s',
    async (state, merged, draft, isInMergeQueue, expectedState) => {
      request.mockResolvedValue({
        pull: {
          number: 17,
          title: 'Existing review title',
          state,
          merged,
          draft,
          isInMergeQueue,
          user: { login: 'review-author' },
          htmlUrl: 'https://github.com/owner/repo/pull/17',
          createdAt: '2026-01-02T03:04:05Z',
          updatedAt: '2026-02-03T04:05:06Z',
          headRef: 'feature/original',
          baseRef: 'release',
        },
      });

      expect(await new LiveIntegrationsClient().githubPullRequest('owner', 'repo', 17)).toEqual({
        owner: 'owner',
        repo: 'repo',
        number: 17,
        title: 'Existing review title',
        state: expectedState,
        author: 'review-author',
        url: 'https://github.com/owner/repo/pull/17',
        createdAt: '2026-01-02T03:04:05Z',
        updatedAt: '2026-02-03T04:05:06Z',
        headRef: 'feature/original',
        baseRef: 'release',
      });
      expect(request).toHaveBeenCalledExactlyOnceWith('github.pulls.get', {
        owner: 'owner',
        repo: 'repo',
        number: 17,
      });
    },
  );

  it.each([true, false])(
    'keeps native result metadata and stage receipts when success=%s',
    async (success) => {
      const wire = {
        success,
        steps: [
          { id: 'commit', name: 'Commit', status: 'completed', message: 'Local commit saved' },
          { id: 'create-pr', name: 'Create PR', status: success ? 'completed' : 'failed' },
        ],
        result: {
          commitHash: 'local-b',
          prNumber: 17,
          prUrl: 'https://api.github.com/repos/owner/repo/pulls/17',
          prHtmlUrl: 'https://github.com/owner/repo/pull/17',
          existingPR: true,
          autoRebased: true,
          newHeadSha: 'rebased-head',
          newBaseSha: 'new-base',
          mergeCommitHash: 'merge-result',
        },
        ...(success ? {} : { error: 'Review creation unavailable' }),
      };
      request.mockResolvedValue(wire);

      const result = await AcceptChangesClient.execute(
        WorkspaceId('workspace-original'),
        'create-pr',
        {
          prTitle: 'A newly submitted title must not replace returned metadata',
          prBody: 'Submitted body',
          targetBranch: 'release',
        },
      );

      expect(result).toBe(wire);
      expect(request).toHaveBeenCalledOnce();
      expect(request.mock.calls[0]?.[0]).toBe('accept-changes.execute');
      expect(request.mock.calls[0]?.[1]).toMatchObject({
        workspaceId: 'workspace-original',
        action: 'create-pr',
        options: { pushAfterCommit: undefined, createPRAfterPush: undefined },
      });
    },
  );

  it('preserves a typed auth refusal from the existing review read', async () => {
    const refusal = Object.assign(new Error('Permission denied'), {
      code: 'source-control-unauthorized',
      rpcCode: -32003,
    });
    request.mockRejectedValue(refusal);
    await expect(new LiveIntegrationsClient().githubPullRequest('owner', 'repo', 17)).rejects.toBe(
      refusal,
    );
  });
});
