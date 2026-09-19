import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PullRequestInfo, Workspace, WorkspaceId } from '$shared/types';
import { PullRequestStatus, WorkspaceStatusEnum } from '$shared/types';

// FAKE seam: appClient.workspaces.get is stubbed so no daemon call happens.
// The helpers run against the REAL configured store so the setWorkspaceEntity
// merge and the detail-hydrated mark are exercised end to end.
vi.mock('$lib/client', () => ({
  appClient: {
    workspaces: {
      get: vi.fn(() => Promise.resolve(null as Workspace | null)),
    },
  },
}));

import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';

const testStore = appStore as typeof appStore & {
  storeContext?: unknown;
  getExistingStoreContext(): unknown;
};
testStore.getExistingStoreContext = function () {
  return this.storeContext;
};
import {
  removeWorkspaceEntity,
  replaceWorkspaceList,
} from '$store/renderer/slices/workspace/workspace-slice';
import {
  selectWorkspaceById,
  selectWorkspaceDetailHydrated,
} from '$store/renderer/slices/workspace/workspace-selectors';
import {
  __resetWorkspaceDetailHydrationForTesting,
  ensureWorkspaceDetail,
  ensureWorkspacePullRequestPool,
  fetchWorkspaceDetail,
} from './workspace-detail-hydration';

const getMock = appClient.workspaces.get as unknown as ReturnType<typeof vi.fn>;
const WS = 'ws-detail-hydration-1';

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: WS as WorkspaceId,
    title: 'Test',
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatusEnum.Active,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function pr(number: number): PullRequestInfo {
  return {
    id: `pr-${number}`,
    number,
    url: `https://github.com/example/repo/pull/${number}`,
    title: `PR ${number}`,
    status: PullRequestStatus.Open,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

const stored = () => selectWorkspaceById.select(appStore.state, WS);
const hydrated = () => selectWorkspaceDetailHydrated.select(appStore.state, WS);

beforeAll(() => appStore.init());

afterEach(() => {
  appStore.dispatch(removeWorkspaceEntity(WS));
  __resetWorkspaceDetailHydrationForTesting();
  getMock.mockReset();
  getMock.mockImplementation(() => Promise.resolve(null));
});

describe('fetchWorkspaceDetail', () => {
  it('single-flights concurrent reads of the same workspace', async () => {
    let resolve!: (value: Workspace | null) => void;
    getMock.mockImplementation(() => new Promise<Workspace | null>((r) => (resolve = r)));
    const a = fetchWorkspaceDetail(WS);
    const b = fetchWorkspaceDetail(WS);
    await vi.waitFor(() => expect(getMock).toHaveBeenCalledWith(WS));
    expect(getMock).toHaveBeenCalledTimes(1);
    resolve(makeWorkspace());
    expect(await a).toEqual(await b);
    // Settled: a later call issues a fresh read.
    void fetchWorkspaceDetail(WS);
    await vi.waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
  });

  it('fails open to null on a transport error', async () => {
    getMock.mockRejectedValueOnce(new Error('socket closed'));
    await expect(fetchWorkspaceDetail(WS)).resolves.toBeNull();
  });
});

describe('ensureWorkspaceDetail', () => {
  it('merges the workspace.get projection into a slim list row and marks it hydrated once', async () => {
    appStore.dispatch(replaceWorkspaceList([makeWorkspace()]));
    expect(stored()?.setupScript).toBeUndefined();
    getMock.mockResolvedValueOnce(makeWorkspace({ setupScript: 'pnpm install' }));

    const result = await ensureWorkspaceDetail(WS);

    expect(result?.setupScript).toBe('pnpm install');
    expect(stored()?.setupScript).toBe('pnpm install');
    expect(hydrated()).toBe(true);

    await ensureWorkspaceDetail(WS);
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the hydrated detail across a later slim list refresh without refetching', async () => {
    appStore.dispatch(replaceWorkspaceList([makeWorkspace()]));
    getMock.mockResolvedValueOnce(makeWorkspace({ setupScript: 'pnpm install' }));
    await ensureWorkspaceDetail(WS);

    appStore.dispatch(replaceWorkspaceList([makeWorkspace({ title: 'Refreshed' })]));
    const result = await ensureWorkspaceDetail(WS);

    expect(result?.title).toBe('Refreshed');
    expect(result?.setupScript).toBe('pnpm install');
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('leaves the row unmarked when the read yields nothing', async () => {
    appStore.dispatch(replaceWorkspaceList([makeWorkspace()]));
    const result = await ensureWorkspaceDetail(WS);
    expect(result?.id).toBe(WS);
    expect(hydrated()).toBe(false);
  });
});

describe('ensureWorkspacePullRequestPool', () => {
  it('does not fetch when the stored pool is complete', async () => {
    appStore.dispatch(replaceWorkspaceList([makeWorkspace({ pullRequests: [pr(1)] })]));
    await ensureWorkspacePullRequestPool(WS);
    expect(getMock).not.toHaveBeenCalled();
  });

  it('completes a truncated list-row pool from workspace.get and clears pullRequestsTotal', async () => {
    const capped = [pr(1), pr(2), pr(3), pr(4), pr(5)];
    appStore.dispatch(
      replaceWorkspaceList([makeWorkspace({ pullRequests: capped, pullRequestsTotal: 7 })]),
    );
    getMock.mockResolvedValueOnce(makeWorkspace({ pullRequests: [...capped, pr(6), pr(7)] }));

    const result = await ensureWorkspacePullRequestPool(WS);

    expect(getMock).toHaveBeenCalledWith(WS);
    expect(result?.pullRequests?.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(result?.pullRequestsTotal).toBeUndefined();

    // Complete now: no second read.
    await ensureWorkspacePullRequestPool(WS);
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('refetches after an authoritative list refresh re-caps the pool, even when detail-hydrated', async () => {
    const capped = [pr(1), pr(2), pr(3), pr(4), pr(5)];
    const truncatedRow = makeWorkspace({ pullRequests: capped, pullRequestsTotal: 6 });
    appStore.dispatch(replaceWorkspaceList([truncatedRow]));
    getMock.mockResolvedValue(makeWorkspace({ pullRequests: [...capped, pr(6)] }));
    await ensureWorkspacePullRequestPool(WS);
    expect(hydrated()).toBe(true);

    appStore.dispatch(replaceWorkspaceList([truncatedRow]));
    expect(stored()?.pullRequestsTotal).toBe(6);

    await ensureWorkspacePullRequestPool(WS);
    expect(getMock).toHaveBeenCalledTimes(2);
    expect(stored()?.pullRequests).toHaveLength(6);
  });
});
