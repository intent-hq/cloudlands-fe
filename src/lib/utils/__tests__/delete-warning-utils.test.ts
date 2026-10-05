import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { admitLegacyPrincipal, withHostPrincipal } from '../../../test/fixtures/principal-state';
import {
  principalReceived,
  principalIdentityChanged,
} from '$store/renderer/slices/principal/principal-slice';
import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
import type { WorkspaceMember } from '$features/workspace-sharing/types';
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
  getGuestsSummary,
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
        // Terminal hook-TTL `expired` state not yet in the BackgroundHook union
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

describe('getGuestsSummary', () => {
  let backend: MockBackendHandle;
  beforeAll(() => appStore.init());
  beforeEach(() => {
    admitLegacyPrincipal();
    backend = installMockBackend();
    backend.onRequest('workspace.members.list', () => ({ members: [], guestCount: 0 }));
  });

  afterEach(() => {
    appStore.dispatch(removeWorkspaceEntity(WS));
    resetMockBackend();
  });

  const seedMembership = (membership: Partial<Workspace>) =>
    appStore.dispatch(
      setWorkspaceEntity({ id: WS, title: WS, status: 'Active', ...membership } as Workspace),
    );

  it('reports zero guests for an unknown workspace', async () => {
    expect(await getGuestsSummary('ws-missing')).toEqual({
      collaboratorCount: 0,
      openInviteCount: 0,
    });
  });

  it('reports zero guests when the row omits the membership summary (older daemon)', async () => {
    seedMembership({});

    expect(await getGuestsSummary(WS)).toEqual({ collaboratorCount: 0, openInviteCount: 0 });
  });

  it('supports legacy collaborator roles and the stored invite count when the daemon omits seat spend', async () => {
    seedMembership({ memberCount: 3, openInviteCount: 2 });
    backend.onRequest('workspace.members.list', () => ({
      members: [
        { principalId: 'owner', role: 'owner' },
        { principalId: 'guest-a', role: 'collaborator' },
        { principalId: 'guest-b', role: 'collaborator' },
      ],
    }));

    expect(await getGuestsSummary(WS)).toEqual({ collaboratorCount: 2, openInviteCount: 2 });
  });

  it('reports no collaborators for an owner-only workspace', async () => {
    seedMembership({ memberCount: 1, openInviteCount: 1 });
    backend.onRequest('workspace.members.list', () => ({
      members: [{ principalId: 'owner', role: 'owner' }],
      guestCount: 1,
    }));

    expect(await getGuestsSummary(WS)).toEqual({ collaboratorCount: 0, openInviteCount: 1 });
  });
});

describe('archive guest impact uses effective membership', () => {
  let backend: MockBackendHandle;
  beforeAll(() => appStore.init());
  beforeEach(() => {
    appStore.dispose();
    appStore.init();
    admitLegacyPrincipal();
    const { principal } = withHostPrincipal(appStore.state);
    appStore.dispatch(
      principalReceived(
        {
          context: principal.context!,
          invalidation: principal.invalidation,
          presentationVersion: principal.presentationVersion,
        },
        principal.snapshot!,
      ),
    );
    backend = installMockBackend();
    appStore.dispatch(
      setWorkspaceEntity({
        id: WS,
        title: WS,
        status: 'Active',
        memberCount: 4,
        openInviteCount: 0,
      } as Workspace),
    );
  });
  afterEach(() => {
    appStore.dispatch(removeWorkspaceEntity(WS));
    resetMockBackend();
  });
  const member = (
    principalId: string,
    hostRole?: WorkspaceMember['hostRole'],
  ): WorkspaceMember => ({
    principalId,
    hostRole,
    role: hostRole === 'owner' ? 'owner' : 'collaborator',
    login: 'same-login',
    displayName: null,
    avatarUrl: null,
    addedAt: '2026-10-01T00:00:00Z',
  });

  it('excludes inherited instance members, including retained direct collaborator grants', async () => {
    backend.onRequest('workspace.members.list', () => ({
      members: [
        member('owner', 'owner'),
        member('member-a', 'member'),
        member('member-b', 'member'),
      ],
      guestCount: 0,
      guestLimit: 10,
    }));
    expect(await getGuestsSummary(WS)).toEqual({ collaboratorCount: 0, openInviteCount: 0 });
    expect(backend.requests.filter((r) => r.method === 'workspace.members.list')).toEqual([
      {
        method: 'workspace.members.list',
        params: { workspaceId: WS },
        options: { timeoutMs: 10000 },
      },
    ]);
  });

  it('counts only workspace guests and pending workspace invitations from the fresh snapshot', async () => {
    backend.onRequest('workspace.members.list', () => ({
      members: [
        member('owner', 'owner'),
        member('inherited', 'member'),
        {
          ...member('github-guest', 'guest'),
          identity: { provider: 'github', host: 'github.com', externalUserId: '42' },
        },
        {
          ...member('gitlab-guest', 'guest'),
          identity: { provider: 'gitlab', host: 'gitlab.com', externalUserId: '42' },
        },
      ],
      guestCount: 3,
      guestLimit: 10,
    }));
    expect(await getGuestsSummary(WS)).toEqual({ collaboratorCount: 2, openInviteCount: 1 });
  });

  it('keeps pending invitations when all accepted collaborators inherit instance access', async () => {
    backend.onRequest('workspace.members.list', () => ({
      members: [member('owner', 'owner'), member('inherited', 'member')],
      guestCount: 2,
      guestLimit: 10,
    }));
    expect(await getGuestsSummary(WS)).toEqual({ collaboratorCount: 0, openInviteCount: 2 });
  });

  it('does not treat an unreadable roster as proof that no guests lose access', async () => {
    expect(await getGuestsSummary(WS)).toBeNull();
  });

  it('discards a roster that settles after the admitted connection changes', async () => {
    let finish!: (value: object) => void;
    backend.onRequest(
      'workspace.members.list',
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = getGuestsSummary(WS);
    appStore.dispatch(connectionStatusChanged('disconnected'));
    finish({ members: [member('guest', 'guest')], guestCount: 1, guestLimit: 10 });
    expect(await pending).toBeNull();
  });
  it('discards a roster after the current provider identity is invalidated', async () => {
    let finish!: (value: object) => void;
    backend.onRequest(
      'workspace.members.list',
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = getGuestsSummary(WS);
    appStore.dispatch(principalIdentityChanged(appStore.state.principal.snapshot!.principal.id));
    finish({ members: [member('guest', 'guest')], guestCount: 1, guestLimit: 10 });
    expect(await pending).toBeNull();
  });

  it('withholds impact while admission is loading instead of using a cached row', async () => {
    appStore.dispatch(connectionStatusChanged('connecting'));
    expect(await getGuestsSummary(WS)).toBeNull();
    expect(backend.requests.filter((r) => r.method === 'workspace.members.list')).toHaveLength(0);
  });

  it('requires host roles from a daemon advertising instance membership', async () => {
    backend.onRequest('workspace.members.list', () => ({
      members: [member('unclassified')],
      guestCount: 1,
    }));
    expect(await getGuestsSummary(WS)).toBeNull();
  });

  it('does not publish partial active-work results when the guest snapshot is unavailable', async () => {
    appStore.dispatch(backgroundHooksUpdated(WS, []));
    expect(await getActiveWorkNames(WS)).toBeNull();
  });
});

describe('getActiveWorkNames', () => {
  let backend: MockBackendHandle;

  beforeAll(() => appStore.init());

  beforeEach(() => {
    appStore.dispose();
    appStore.init();
    admitLegacyPrincipal();
    backend = installMockBackend();
    backend.onRequest('workspace.members.list', () => ({ members: [], guestCount: 0 }));
    appStore.dispatch(backgroundHooksUpdated(WS, []));
  });

  afterEach(() => {
    appStore.dispatch(removeWorkspaceEntity(WS));
    resetMockBackend();
  });

  const noGuests = { collaboratorCount: 0, openInviteCount: 0 };

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
      guests: noGuests,
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

    expect(result?.localChanges).toBeNull();
    expect(localChangesRequests()).toHaveLength(0);
  });

  it('carries localChanges: null when the RPC fails so gating falls through to other signals', async () => {
    backend.onRequest('workspace.localChanges', () => {
      throw new Error('boom');
    });

    const result = await getActiveWorkNames(WS, { includeLocalChanges: true });

    expect(result).toEqual({
      agentNames: [],
      hookNames: [],
      openPrs: [],
      localChanges: null,
      guests: noGuests,
    });
  });

  it('carries the fresh guest summary without requesting workspace.get', async () => {
    appStore.dispatch(
      setWorkspaceEntity({
        id: WS,
        title: WS,
        status: 'Active',
        memberCount: 2,
        openInviteCount: 1,
      } as Workspace),
    );

    backend.onRequest('workspace.members.list', () => ({
      members: [{ principalId: 'guest', role: 'collaborator', hostRole: 'guest' }],
      guestCount: 2,
    }));
    const result = await getActiveWorkNames(WS);

    expect(result?.guests).toEqual({ collaboratorCount: 1, openInviteCount: 1 });
    expect(backend.requests.map((r) => r.method)).not.toContain('workspace.get');
  });

  const workspaceGetRequests = () => backend.requests.filter((r) => r.method === 'workspace.get');

  it('counts open PRs from the full pool when the list row is capped (pullRequestsTotal)', async () => {
    const capped = [1, 2, 3, 4, 5].map((n) => makePr(n));
    appStore.dispatch(
      setWorkspaceEntity({
        id: WS,
        title: WS,
        status: 'Active',
        pullRequests: capped,
        pullRequestsTotal: 7,
      } as unknown as Workspace),
    );
    backend.onRequest('workspace.get', () => ({
      workspace: {
        id: WS,
        title: WS,
        status: 'Active',
        pullRequests: [...capped, makePr(6), makePr(7, { status: PullRequestStatus.Merged })],
      },
    }));

    const result = await getActiveWorkNames(WS);

    expect(workspaceGetRequests()).toEqual([
      { method: 'workspace.get', params: { workspaceId: WS } },
    ]);
    expect(result?.openPrs.map((pr) => pr.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('issues no workspace.get when the stored pool is already complete', async () => {
    seedWorkspace([makePr(1)]);

    const result = await getActiveWorkNames(WS);

    expect(workspaceGetRequests()).toHaveLength(0);
    expect(result?.openPrs.map((pr) => pr.number)).toEqual([1]);
  });

  it('fails open to the capped pool when workspace.get rejects', async () => {
    const capped = [1, 2, 3, 4, 5].map((n) => makePr(n));
    appStore.dispatch(
      setWorkspaceEntity({
        id: WS,
        title: WS,
        status: 'Active',
        pullRequests: capped,
        pullRequestsTotal: 6,
      } as unknown as Workspace),
    );
    backend.onRequest('workspace.get', () => {
      throw new Error('boom');
    });

    const result = await getActiveWorkNames(WS);

    expect(result?.openPrs.map((pr) => pr.number)).toEqual([1, 2, 3, 4, 5]);
  });
});
