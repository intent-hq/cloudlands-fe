import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import {
  PullRequestStatus,
  WorkspaceStatus,
  type PullRequestInfo,
  type Workspace,
} from '$shared/types';
import {
  bulkUpdateWorkspaceEntities,
  replaceWorkspaceList,
  updateWorkspaceEntity,
  workspaceReducer,
} from '$store/renderer/slices/workspace/workspace-slice';
import HomeWorkspacePullBadge from './HomeWorkspacePullBadge.svelte';
import { LiveWorkspacesClient } from '$lib/client/live/live-workspaces-client';
import * as backendTransport from '$lib/client/live/backend-transport';
import { createTestWorkspaceId } from '../../test/factories/workspace.factory';

const workspaceId = createTestWorkspaceId();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function pull(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: '3390',
    number: 3390,
    url: 'https://github.com/intent-hq/cloudlands-fe/pull/3390',
    title: 'Fix workspace actions',
    status: PullRequestStatus.Open,
    createdAt: '2026-10-13T00:00:00Z',
    updatedAt: '2026-10-13T00:00:00Z',
    ...overrides,
  };
}

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: workspaceId,
    title: 'Fix workspace actions',
    branch: 'fix/actions',
    status: WorkspaceStatus.Active,
    changesets: [],
    timeline: [],
    conversationInfo: [],
    createdAt: '2026-10-13T00:00:00Z',
    updatedAt: '2026-10-13T00:00:00Z',
    pullRequests: [pull()],
    ...overrides,
  };
}

describe('Home workspace PR status', () => {
  it('renders queue entry, exit and merge from the global workspace subscription', async () => {
    const request = vi
      .spyOn(backendTransport, 'backendRequest')
      .mockResolvedValue({ subscriptionId: 'home-pr-sub' });
    const notifications = vi
      .spyOn(backendTransport, 'onBackendNotification')
      .mockImplementation(() => () => {});
    vi.spyOn(backendTransport, 'onBackendReconnected').mockImplementation(() => () => {});
    let state = workspaceReducer(undefined, { type: '@@INIT' });
    const client = new LiveWorkspacesClient();
    const stop = client.subscribe((rows) => {
      state = workspaceReducer(state, replaceWorkspaceList(rows));
    });
    try {
      await vi.waitFor(() => expect(request).toHaveBeenCalledWith('workspace.subscribe', {}));
      const notify = notifications.mock.calls.at(-1)![0];
      const initial = workspace();
      notify({
        method: 'subscription.push',
        params: { subscriptionId: 'home-pr-sub', kind: 'snapshot', seq: 0, snapshot: [initial] },
      });
      const view = render(HomeWorkspacePullBadge, {
        workspace: getItem(state.workspaces, initial.id)!,
      });
      expect(view.getByText('Open')).toBeTruthy();
      let seq = 0;
      for (const [pr, label] of [
        [pull({ isInMergeQueue: true }), 'Queued'],
        [pull(), 'Open'],
        [pull({ status: PullRequestStatus.Merged }), 'Merged'],
      ] as const) {
        notify({
          method: 'subscription.push',
          params: {
            subscriptionId: 'home-pr-sub',
            kind: 'delta',
            seq: ++seq,
            delta: { updated: [workspace({ pullRequests: [pr] })] },
          },
        });
        await view.rerender({ workspace: getItem(state.workspaces, initial.id)! });
        expect(view.getByText(label)).toBeTruthy();
      }
      expect(request.mock.calls).toEqual([['workspace.subscribe', {}]]);
    } finally {
      stop();
    }
  });

  it('updates Open → Queued → Open from workspace PR deltas without dropping other repositories', async () => {
    const other = pull({ url: 'https://github.com/intent-hq/intentd/pull/3390' });
    const initial = workspace({ pullRequests: [pull(), other] });
    let state = workspaceReducer(undefined, replaceWorkspaceList([initial]));
    const view = render(HomeWorkspacePullBadge, {
      workspace: getItem(state.workspaces, initial.id)!,
    });
    expect(view.getByText('Open')).toBeTruthy();
    for (const queued of [true, false]) {
      const updated = pull(queued ? { isInMergeQueue: true } : {});
      state = workspaceReducer(
        state,
        bulkUpdateWorkspaceEntities([
          updateWorkspaceEntity(initial.id, {
            pullRequests: [updated],
            activePullRequest: updated,
          }),
        ]),
      );
      const row = getItem(state.workspaces, initial.id)!;
      await view.rerender({ workspace: row });
      expect(view.getByText(queued ? 'Queued' : 'Open')).toBeTruthy();
      expect(row.pullRequests).toEqual([updated, other]);
    }
  });

  it('shows Queued while a queued PR still has pending CI', () => {
    const view = render(HomeWorkspacePullBadge, {
      workspace: workspace({
        pullRequests: [
          pull({ isInMergeQueue: true, ciStatus: { total: 1, passed: 0, failed: 0, pending: 1 } }),
        ],
      }),
    });
    expect(view.getByText('Queued')).toBeTruthy();
  });

  it('retains the CI-running label when the PR is not queued', () => {
    const view = render(HomeWorkspacePullBadge, {
      workspace: workspace({
        pullRequests: [pull({ ciStatus: { total: 1, passed: 0, failed: 0, pending: 1 } })],
      }),
    });
    expect(view.getByText('CI running')).toBeTruthy();
  });

  it.each([PullRequestStatus.Merged, PullRequestStatus.Closed, PullRequestStatus.Draft])(
    'does not show Queued on a %s PR with a leftover queue flag',
    (status) => {
      const view = render(HomeWorkspacePullBadge, {
        workspace: workspace({ pullRequests: [pull({ status, isInMergeQueue: true })] }),
      });
      expect(view.queryByText('Queued')).toBeNull();
      expect(view.getByText(status)).toBeTruthy();
    },
  );

  it('uses the active PR fallback when no pool is available', () => {
    const view = render(HomeWorkspacePullBadge, {
      workspace: workspace({
        pullRequests: undefined,
        activePullRequest: pull({ isInMergeQueue: true }),
      }),
    });
    expect(view.getByText('Queued')).toBeTruthy();
  });
});
