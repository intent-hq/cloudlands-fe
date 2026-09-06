import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundHook } from '$features/hooks/background-hooks-service';

// FAKE daemon transport: getActiveHookNames' `hook.list` fallback bottoms out
// here so the exact JSON-RPC method + params can be asserted per PROTOCOL.md
// §5.40. The slice branch runs against the REAL configured store.
vi.mock('$lib/client/live/backend-transport', async () => {
  const mod = await import('../../../test/mocks/backend-transport.mock');
  return mod.mockBackendTransportModule;
});

import {
  BackendError,
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '../../../test/mocks/backend-transport.mock';
import {
  getActiveHookNames,
  getActiveWorkNames,
  getLocalChanges,
  getOpenPrItems,
  type LocalChangesWarning,
} from '../delete-warning-utils';
import { store as appStore } from '$store/renderer/store';
import {
  backgroundHooksMarkedStale,
  backgroundHooksUpdated,
} from '$store/renderer/slices/background-hooks/background-hooks-slice';
import {
  removeWorkspaceEntity,
  setWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import { PullRequestStatus, type PullRequestInfo, type Workspace } from '$shared/types';

const WS = 'ws-hooks-test';

function makeHook(
  hookId: string,
  state: BackgroundHook['state'],
  name = `hook ${hookId}`,
): BackgroundHook {
  return {
    hookId,
    workspaceId: WS,
    agentId: 'agent-1',
    name,
    delayMs: 60000,
    state,
    createdAt: '2026-08-04T00:00:00.000Z',
    runCount: 0,
  };
}

describe('getActiveHookNames', () => {
  let backend: MockBackendHandle;

  beforeAll(() => appStore.init());

  beforeEach(() => {
    backend = installMockBackend();
  });

  afterEach(() => {
    appStore.dispatch(removeWorkspaceEntity(WS));
    resetMockBackend();
  });

  // Store init fires unrelated startup requests; only `hook.list` matters here.
  const hookListRequests = () => backend.requests.filter((r) => r.method === 'hook.list');

  it('reads the slice when a live subscription entry exists — no hook.list call', async () => {
    appStore.dispatch(
      backgroundHooksUpdated(WS, [
        makeHook('hook-1', 'scheduled', 'ci watch'),
        makeHook('hook-2', 'running', 'pr checks'),
        makeHook('hook-3', 'dispatched'),
      ]),
    );

    const names = await getActiveHookNames(WS);

    expect(names).toEqual(['ci watch', 'pr checks']);
    expect(hookListRequests()).toHaveLength(0);
  });

  it('uses the slice even when its hook list is empty', async () => {
    appStore.dispatch(backgroundHooksUpdated(WS, []));

    const names = await getActiveHookNames(WS);

    expect(names).toEqual([]);
    expect(hookListRequests()).toHaveLength(0);
  });

  it('falls back to hook.list when no subscription entry exists, sending the §5.40 request', async () => {
    backend.onRequest('hook.list', () => ({
      hooks: [makeHook('hook-1', 'scheduled', 'ci watch'), makeHook('hook-2', 'cancelled')],
    }));

    const names = await getActiveHookNames(WS);

    expect(names).toEqual(['ci watch']);
    expect(hookListRequests()).toEqual([{ method: 'hook.list', params: { workspaceId: WS } }]);
  });

  it('falls back to hook.list when the entry is retained but stale (no live subscription)', async () => {
    appStore.dispatch(backgroundHooksUpdated(WS, [makeHook('hook-1', 'scheduled', 'old name')]));
    appStore.dispatch(backgroundHooksMarkedStale(WS));
    backend.onRequest('hook.list', () => ({
      hooks: [makeHook('hook-1', 'running', 'fresh name')],
    }));

    const names = await getActiveHookNames(WS);

    expect(names).toEqual(['fresh name']);
    expect(hookListRequests()).toEqual([{ method: 'hook.list', params: { workspaceId: WS } }]);
  });

  it('counts only scheduled/running states as active', async () => {
    backend.onRequest('hook.list', () => ({
      hooks: [
        makeHook('hook-1', 'scheduled'),
        makeHook('hook-2', 'running'),
        makeHook('hook-3', 'dispatched'),
        makeHook('hook-4', 'evicted'),
        makeHook('hook-5', 'cancelled'),
        // Terminal v3.1 state not yet in the BackgroundHook union
        // (pre-existing gap); inactive either way.
        makeHook('hook-6', 'expired' as BackgroundHook['state']),
      ],
    }));

    const names = await getActiveHookNames(WS);

    expect(names).toEqual(['hook hook-1', 'hook hook-2']);
  });

  it('falls back to a truncated hookId when a hook has no name', async () => {
    backend.onRequest('hook.list', () => ({
      hooks: [{ ...makeHook('abcdefgh-1234-5678', 'running'), name: '' }],
    }));

    const names = await getActiveHookNames(WS);

    expect(names).toEqual(['abcdefgh']);
  });

  it('fails open (returns []) when hook.list rejects, so archive/delete is not blocked', async () => {
    backend.onRequest('hook.list', () => {
      throw new Error('daemon unavailable');
    });

    const names = await getActiveHookNames(WS);

    expect(names).toEqual([]);
    expect(hookListRequests()).toEqual([{ method: 'hook.list', params: { workspaceId: WS } }]);
  });
});

function makePr(number: number, overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: `pr-${number}`,
    number,
    url: `https://github.com/o/r/pull/${number}`,
    title: `PR ${number}`,
    status: PullRequestStatus.Open,
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
    ...overrides,
  };
}

function seedWorkspace(
  pullRequests: PullRequestInfo[],
  activePullRequest?: PullRequestInfo,
  repo?: { repositoryOwner?: string; repositoryName?: string },
) {
  appStore.dispatch(
    setWorkspaceEntity({
      id: WS,
      title: WS,
      status: 'Active',
      pullRequests,
      ...(activePullRequest ? { activePullRequest } : {}),
      ...(repo ?? {}),
    } as unknown as Workspace),
  );
}

describe('getOpenPrItems', () => {
  beforeAll(() => appStore.init());

  afterEach(() => {
    appStore.dispatch(removeWorkspaceEntity(WS));
  });

  it('returns [] for an unknown workspace', () => {
    expect(getOpenPrItems('ws-missing')).toEqual([]);
  });

  it('keeps only Open/Draft PRs, projected to serializable warning items', () => {
    seedWorkspace([
      makePr(1),
      makePr(2, { status: PullRequestStatus.Merged }),
      makePr(3, { status: PullRequestStatus.Closed }),
      makePr(4, { status: PullRequestStatus.Draft }),
    ]);

    expect(getOpenPrItems(WS)).toEqual([
      { number: 1, title: 'PR 1', url: 'https://github.com/o/r/pull/1', status: 'Open' },
      { number: 4, title: 'PR 4', url: 'https://github.com/o/r/pull/4', status: 'Draft' },
    ]);
  });

  it('reports isDraft: true as status Draft and carries mergeConflicts when set', () => {
    seedWorkspace([makePr(1, { isDraft: true, mergeConflicts: true })]);

    expect(getOpenPrItems(WS)).toEqual([
      {
        number: 1,
        title: 'PR 1',
        url: 'https://github.com/o/r/pull/1',
        status: 'Draft',
        mergeConflicts: true,
      },
    ]);
  });

  it('unions activePullRequest into the pool and dedupes by url', () => {
    const active = makePr(2);
    seedWorkspace([makePr(1), makePr(2)], active);

    expect(getOpenPrItems(WS).map((pr) => pr.number)).toEqual([1, 2]);
  });

  it('includes an Open activePullRequest absent from pullRequests', () => {
    seedWorkspace([makePr(1)], makePr(5));

    expect(getOpenPrItems(WS).map((pr) => pr.number)).toEqual([1, 5]);
  });

  it('excludes a merged activePullRequest', () => {
    seedWorkspace([], makePr(6, { status: PullRequestStatus.Merged }));

    expect(getOpenPrItems(WS)).toEqual([]);
  });

  it('constructs the URL from the workspace repository when the wire url is empty', () => {
    seedWorkspace([makePr(7, { url: '' })], undefined, {
      repositoryOwner: 'acme',
      repositoryName: 'repo',
    });

    expect(getOpenPrItems(WS)).toEqual([
      { number: 7, title: 'PR 7', url: 'https://github.com/acme/repo/pull/7', status: 'Open' },
    ]);
  });

  it('keeps url empty (never a broken link) when no repo owner/name is known either', () => {
    seedWorkspace([makePr(8, { url: '' }), makePr(8, { url: '' })]);

    expect(getOpenPrItems(WS)).toEqual([{ number: 8, title: 'PR 8', url: '', status: 'Open' }]);
  });
});

// PROTOCOL-shaped `workspace.localChanges` result: primary worktree first,
// then each registered secondary root in `gitRoot.list` order.
const localChangesResult: LocalChangesWarning = {
  roots: [
    {
      kind: 'primary',
      path: '/work/repo',
      branch: 'feat/x',
      hasRemoteRefs: true,
      unpushedCount: 3,
      uncommittedCount: 2,
    },
    {
      kind: 'secondary',
      gitRootId: 'root-1',
      path: '/work/repo/packages/sub',
      hasRemoteRefs: false,
      unpushedCount: 0,
      uncommittedCount: 0,
      error: 'unreadable HEAD',
    },
  ],
  hasUnpushedCommits: true,
  hasUncommittedChanges: true,
};

describe('getLocalChanges', () => {
  let backend: MockBackendHandle;

  beforeAll(() => appStore.init());

  beforeEach(() => {
    backend = installMockBackend();
  });

  afterEach(() => {
    resetMockBackend();
  });

  const localChangesRequests = () =>
    backend.requests.filter((r) => r.method === 'workspace.localChanges');

  it('sends the exact workspace.localChanges request with a 10s per-call timeout and returns the wire result as-is', async () => {
    backend.onRequest('workspace.localChanges', () => localChangesResult);

    const result = await getLocalChanges(WS);

    expect(localChangesRequests()).toEqual([
      {
        method: 'workspace.localChanges',
        params: { workspaceId: WS },
        options: { timeoutMs: 10000 },
      },
    ]);
    expect(result).toEqual(localChangesResult);
  });

  it('fails open (returns null) when the daemon rejects the call', async () => {
    backend.onRequest('workspace.localChanges', () => {
      throw new Error('daemon unavailable');
    });

    await expect(getLocalChanges(WS)).resolves.toBeNull();
    expect(localChangesRequests()).toHaveLength(1);
  });

  it('fails open (returns null) when the transport times the request out', async () => {
    // Mirrors the transport's per-call timeout rejection (a BackendError
    // rather than a daemon result), which must not surface to the caller.
    backend.onRequest('workspace.localChanges', () => {
      throw new BackendError({
        code: 'TIMEOUT',
        message: 'JSON-RPC request timed out: workspace.localChanges',
        data: { code: 'TIMEOUT' },
      });
    });

    await expect(getLocalChanges(WS)).resolves.toBeNull();
    expect(localChangesRequests()).toHaveLength(1);
  });

  it('fails open (returns null) on an older daemon without the method', async () => {
    // No handler registered → the mock raises a BackendError, like a
    // JSON-RPC "method not found" from a pre-feature daemon.
    await expect(getLocalChanges(WS)).resolves.toBeNull();
    expect(localChangesRequests()).toHaveLength(1);
  });
});

describe('getActiveWorkNames', () => {
  let backend: MockBackendHandle;

  beforeAll(() => appStore.init());

  beforeEach(() => {
    backend = installMockBackend();
    appStore.dispatch(backgroundHooksUpdated(WS, []));
  });

  afterEach(() => {
    appStore.dispatch(removeWorkspaceEntity(WS));
    resetMockBackend();
  });

  const localChangesRequests = () =>
    backend.requests.filter((r) => r.method === 'workspace.localChanges');

  it('includes local changes only when asked (single-workspace gating)', async () => {
    backend.onRequest('workspace.localChanges', () => localChangesResult);

    const result = await getActiveWorkNames(WS, { includeLocalChanges: true });

    expect(result).toEqual({
      agentNames: [],
      hookNames: [],
      openPrs: [],
      localChanges: localChangesResult,
    });
    expect(localChangesRequests()).toEqual([
      {
        method: 'workspace.localChanges',
        params: { workspaceId: WS },
        options: { timeoutMs: 10000 },
      },
    ]);
  });

  it('never requests workspace.localChanges by default (bulk flows)', async () => {
    backend.onRequest('workspace.localChanges', () => localChangesResult);

    const result = await getActiveWorkNames(WS);

    expect(result.localChanges).toBeNull();
    expect(localChangesRequests()).toHaveLength(0);
  });

  it('carries localChanges: null when the RPC fails so gating falls through to other signals', async () => {
    backend.onRequest('workspace.localChanges', () => {
      throw new Error('boom');
    });

    const result = await getActiveWorkNames(WS, { includeLocalChanges: true });

    expect(result).toEqual({ agentNames: [], hookNames: [], openPrs: [], localChanges: null });
  });
});
