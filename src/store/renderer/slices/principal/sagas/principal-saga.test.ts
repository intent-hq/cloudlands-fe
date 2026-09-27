import { getItem } from '@augmentcode/themis/utils/collections/collection-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '$shared/types';
import type { HostRole } from '$shared/types/principal';
import { CHIEF_WORKSPACE_ID, WorkspaceId } from '$shared/types/branded-ids';

const wire = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: wire.request,
  onBackendNotification: () => () => {},
  onBackendReconnected: () => () => {},
}));

import { store } from '../../../store';
import { routeDaemonEventsNotification } from '$features/events/daemon-events-bridge.client';
import { authRejectedReceived, connectionsListReceived } from '../../connections/connections-slice';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import { guestSessionsListReceived } from '../../guest-sessions/guest-sessions-slice';
import { setGitHubAuthState } from '../../github-auth/github-auth-slice';
import type { GuestSessionRecord } from '../../guest-sessions/guest-sessions-types';
import { daemonEventsSubscribed } from '../../workspace-events/workspace-events-slice';
import { backendReconnected } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { setLabsMultiplayerEnabled } from '../../user-preferences/user-preferences-slice';
import { replaceWorkspaceList, setWorkspaceHasLoaded } from '../../workspace/workspace-slice';
import {
  selectCanManageWorkspace,
  selectCanShareWorkspace,
  selectIsWorkspaceOwner,
  selectIsCollaboratorOnlyClient,
  selectHidesOwnerWorkspaceActions,
} from '../../workspace/workspace-selectors';
import { hostMembershipChanged, principalIdentityChanged } from '../principal-slice';
import {
  selectCanAdministerHost,
  selectCanCreateWorkspace,
  selectCollaborationCapabilities,
  selectHostRole,
} from '../principal-selectors';
import { PRINCIPAL_RETRY_DELAYS_MS, principalSaga } from './principal-saga';
import { BackendError } from '$lib/client/live/backend-transport-types';

const hello = {
  server: {
    capabilities: {
      hostMembership: 1,
      collaborationIdentity: 1,
      personalPairing: 1,
      authenticatedDevices: 1,
    },
  },
};
const principal = (hostRole: HostRole = 'member', hostMembershipRevision = 3) => ({
  id: 'person',
  login: null,
  displayName: null,
  avatarUrl: null,
  isAdministrator: hostRole === 'owner',
  hostRole,
  hostMembershipRevision,
});
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('connected principal hydration', () => {
  let dispose: () => void;
  let cancel: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    wire.request
      .mockReset()
      .mockImplementation(async (method) => (method === 'client.hello' ? hello : principal()));
    dispose = store.init();
  });
  afterEach(() => {
    cancel?.();
    cancel = undefined;
    dispose();
    vi.useRealTimers();
  });

  function bind(id = 'local') {
    store.dispatch(connectionsListReceived({ connections: [], activeId: id, windowBackendId: id }));
  }
  function start(id = 'local') {
    bind(id);
    store.dispatch(connectionStatusChanged('connected'));
    store.dispatch(daemonEventsSubscribed());
    cancel = store.runSaga(principalSaga);
  }
  function workspace(
    canManage: boolean | undefined,
    myRole: 'owner' | 'collaborator' = 'collaborator',
  ) {
    store.dispatch(
      replaceWorkspaceList([
        { id: WorkspaceId('ws-1'), canManage, myRole, ownerPrincipalId: 'real-owner' } as Workspace,
      ]),
    );
    store.dispatch(setWorkspaceHasLoaded(true, store.state.connections.windowBackendId));
  }
  function defer() {
    const requests: Array<{ method: string; resolve: (value: unknown) => void }> = [];
    wire.request.mockImplementation(
      (method) => new Promise((resolve) => requests.push({ method, resolve })),
    );
    return {
      reply(index: number, role: HostRole = 'member', revision = 3) {
        requests[index * 2].resolve(hello);
        requests[index * 2 + 1].resolve(principal(role, revision));
      },
      count: () => requests.length / 2,
    };
  }

  it('waits for the actual backend binding and live event subscription', async () => {
    cancel = store.runSaga(principalSaga);
    store.dispatch(connectionStatusChanged('connected'));
    store.dispatch(daemonEventsSubscribed());
    await settle();
    expect(wire.request).not.toHaveBeenCalled();
    bind('remote');
    await settle();
    expect(wire.request.mock.calls).toEqual([
      ['client.hello', {}],
      ['principal.me', {}],
    ]);
    expect(selectHostRole.select(store.state)).toBe('member');
  });

  it.each(['client.hello', 'principal.me'])(
    'recovers after a transient %s timeout on the same connection',
    async (failedMethod) => {
      let failed = false;
      wire.request.mockImplementation(async (method) => {
        if (method === failedMethod && !failed) {
          failed = true;
          throw new BackendError({ code: 'TIMEOUT', message: 'Request timed out' });
        }
        return method === 'client.hello' ? hello : principal('owner');
      });
      start();
      await settle();
      expect(selectHostRole.select(store.state)).toBeNull();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(selectHostRole.select(store.state)).toBe('owner');
      expect(wire.request).toHaveBeenCalledTimes(4);
    },
  );

  it('bounds transient retry attempts while keeping authority unresolved', async () => {
    wire.request.mockRejectedValue(new BackendError({ code: 'TIMEOUT', message: 'timed out' }));
    start();
    await settle();
    expect(wire.request).toHaveBeenCalledTimes(2);
    for (const [index, backoff] of PRINCIPAL_RETRY_DELAYS_MS.entries()) {
      await vi.advanceTimersByTimeAsync(backoff - 1);
      expect(wire.request).toHaveBeenCalledTimes(2 * (index + 1));
      await vi.advanceTimersByTimeAsync(1);
      expect(wire.request).toHaveBeenCalledTimes(2 * (index + 2));
    }
    await vi.advanceTimersByTimeAsync(60_000);
    expect(wire.request).toHaveBeenCalledTimes(8);
    expect(selectHostRole.select(store.state)).toBeNull();
  });

  it.each([
    { code: 'FORBIDDEN', rpcCode: -32003 },
    { code: 'UNAUTHORIZED', rpcCode: -32001 },
    { code: 'INVALID_PARAMS', rpcCode: -32602 },
    { code: 'METHOD_NOT_FOUND', rpcCode: -32601 },
    { code: 'AUTH_REJECTED' },
    { code: 'FORBIDDEN' },
  ])('does not retry a $code refusal, including when hello also times out', async (error) => {
    wire.request.mockRejectedValueOnce(new BackendError({ code: 'TIMEOUT', message: 'timed out' }));
    wire.request.mockRejectedValue(new BackendError({ ...error, message: 'Request rejected' }));
    start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(wire.request).toHaveBeenCalledTimes(2);
    expect(selectHostRole.select(store.state)).toBeNull();
  });

  it('does not retry an incompatible advertised principal', async () => {
    wire.request.mockImplementation(async (method) =>
      method === 'client.hello' ? hello : { ...principal(), hostRole: undefined },
    );
    start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(wire.request).toHaveBeenCalledTimes(2);
    expect(store.state.principal.error).toBe('incompatible-response');
  });

  it.each(['backend', 'disconnect', 'auth rejection'] as const)(
    'cancels a pending retry on %s',
    async (transition) => {
      wire.request.mockRejectedValue(new BackendError({ code: 'TIMEOUT', message: 'timed out' }));
      start();
      await vi.advanceTimersByTimeAsync(500);
      if (transition === 'backend') {
        wire.request.mockImplementation(async (method) =>
          method === 'client.hello' ? hello : principal('guest'),
        );
        bind('other-backend');
      } else if (transition === 'disconnect')
        store.dispatch(connectionStatusChanged('disconnected'));
      else store.dispatch(authRejectedReceived({ id: 'local', statusCode: 401 }));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(wire.request).toHaveBeenCalledTimes(transition === 'backend' ? 4 : 2);
      expect(selectHostRole.select(store.state)).toBe(transition === 'backend' ? 'guest' : null);
    },
  );

  it('cancels a pending retry after confirmed membership revocation', async () => {
    start();
    await settle();
    wire.request.mockRejectedValue(new BackendError({ code: 'TIMEOUT', message: 'timed out' }));
    store.dispatch(
      hostMembershipChanged({
        revision: 4,
        principalId: 'other-person',
        action: 'added',
        hostRole: 'member',
      }),
    );
    await vi.advanceTimersByTimeAsync(500);
    store.dispatch(
      hostMembershipChanged({
        revision: 5,
        principalId: 'person',
        action: 'removed',
        hostRole: 'guest',
      }),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(wire.request).toHaveBeenCalledTimes(4);
    expect(store.state.principal.status).toBe('revoked');
  });

  it('replaces the retry timer with a fresh invalidated read and fences its pending response', async () => {
    wire.request.mockRejectedValue(new BackendError({ code: 'TIMEOUT', message: 'timed out' }));
    start();
    await vi.advanceTimersByTimeAsync(500);
    const pending = defer();
    store.dispatch(
      hostMembershipChanged({
        revision: 4,
        principalId: 'other-person',
        action: 'added',
        hostRole: 'member',
      }),
    );
    expect(pending.count()).toBe(1);
    store.dispatch(
      hostMembershipChanged({
        revision: 5,
        principalId: 'other-person',
        action: 'added',
        hostRole: 'member',
      }),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(pending.count()).toBe(1);
    pending.reply(0, 'owner', 4);
    await settle();
    expect(selectHostRole.select(store.state)).toBeNull();
    expect(pending.count()).toBe(2);
    pending.reply(1, 'member', 5);
    await settle();
    expect(selectHostRole.select(store.state)).toBe('member');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pending.count()).toBe(2);
  });

  it.each(['local', 'remote'])(
    'hydrates an empty %s host with no repository account or linked profile',
    async (id) => {
      start(id);
      await settle();
      expect(store.state.workspace.workspaces.ids).toEqual([]);
      expect(selectCanCreateWorkspace.select(store.state)).toBe(true);
      expect(selectCanAdministerHost.select(store.state)).toBe(false);
      expect(selectIsCollaboratorOnlyClient.select(store.state)).toBe(true);
      // Saved registry category and repository connection list changes cannot alter authority.
      store.dispatch(guestSessionsListReceived({ sessions: [], openIds: [], connectedIds: [] }));
      store.dispatch(
        setGitHubAuthState({
          isAuthenticated: false,
          requiresDaemonAuth: false,
          user: null,
          needsScopeUpdate: false,
          oauthUrl: null,
        }),
      );
      bind(id);
      await settle();
      expect(selectHostRole.select(store.state)).toBe('member');
      expect(wire.request).toHaveBeenCalledTimes(2);
    },
  );

  it.each(['owner', 'member', 'guest'] as const)(
    'uses %s authority and keeps workspace ownership truthful',
    async (role) => {
      wire.request.mockImplementation(async (method) =>
        method === 'client.hello' ? hello : principal(role),
      );
      start('invited-host');
      store.dispatch(
        guestSessionsListReceived({
          sessions: [
            {
              id: 'invited-host',
              label: 'Shared host',
              host: 'example.test',
              hosts: ['example.test'],
              port: 443,
              fingerprint: 'AA:BB',
              tcAddress: null,
              hostname: 'example.test',
              principalId: 'stale-person',
              login: 'stale-profile',
              tokenEncrypted: true,
              updatedAt: 1,
            } satisfies GuestSessionRecord,
          ],
          openIds: ['invited-host'],
          connectedIds: ['invited-host'],
        }),
      );
      workspace(true, role === 'owner' ? 'owner' : 'collaborator');
      await settle();
      expect(selectHostRole.select(store.state)).toBe(role);
      expect(selectCanCreateWorkspace.select(store.state)).toBe(role !== 'guest');
      expect(selectCanManageWorkspace.select(store.state, 'ws-1')).toBe(role !== 'guest');
      expect(selectIsWorkspaceOwner.select(store.state, 'ws-1')).toBe(role === 'owner');
      expect(selectCanManageWorkspace.select(store.state, CHIEF_WORKSPACE_ID)).toBe(
        role === 'owner',
      );
      expect(getItem(store.state.workspace.workspaces, WorkspaceId('ws-1'))?.ownerPrincipalId).toBe(
        'real-owner',
      );
      workspace(false);
      expect(selectCanManageWorkspace.select(store.state, 'ws-1')).toBe(false);
      workspace(undefined);
      expect(selectCanManageWorkspace.select(store.state, 'ws-1')).toBe(false);
    },
  );

  it('drops delayed replies across backend switches, disconnects and same-host reconnects', async () => {
    const pending = defer();
    start();
    expect(pending.count()).toBe(1);
    bind('remote');
    expect(pending.count()).toBe(2);
    pending.reply(1, 'member');
    await settle();
    pending.reply(0, 'owner');
    await settle();
    expect(selectHostRole.select(store.state)).toBe('member');
    store.dispatch(connectionStatusChanged('disconnected'));
    expect(selectHostRole.select(store.state)).toBe(null);
    store.dispatch(connectionStatusChanged('connected'));
    store.dispatch(backendReconnected());
    store.dispatch(daemonEventsSubscribed());
    expect(selectCanCreateWorkspace.select(store.state)).toBe(false);
    pending.reply(pending.count() - 1, 'guest');
    await settle();
    expect(selectHostRole.select(store.state)).toBe('guest');
  });

  it('waits for the current backend workspace snapshot before granting workspace management', async () => {
    start('first-host');
    workspace(true);
    await settle();
    expect(selectCanManageWorkspace.select(store.state, 'ws-1')).toBe(true);
    bind('second-host');
    await settle();
    expect(selectCanCreateWorkspace.select(store.state)).toBe(true);
    expect(selectCanManageWorkspace.select(store.state, 'ws-1')).toBe(false);
    workspace(false);
    expect(selectCanManageWorkspace.select(store.state, 'ws-1')).toBe(false);
    workspace(true);
    expect(selectCanManageWorkspace.select(store.state, 'ws-1')).toBe(true);
  });

  it('invalidates roles synchronously and coalesces membership bursts into one trailing read', async () => {
    const pending = defer();
    start();
    pending.reply(0);
    await settle();
    const change = (revision: number) =>
      routeDaemonEventsNotification(
        'events.event',
        {
          subscriptionId: 'role-events',
          event: {
            id: `membership-${revision}`,
            type: 'host:members-changed',
            timestamp: '2026-09-25T00:00:00Z',
            data: { revision, principalId: 'another-person', hostRole: 'member', action: 'added' },
          },
        },
        'role-events',
      );
    change(4);
    expect(selectHostRole.select(store.state)).toBe(null);
    change(5);
    change(6);
    expect(pending.count()).toBe(2);
    pending.reply(1, 'member', 4);
    await settle();
    expect(selectHostRole.select(store.state)).toBe(null);
    expect(pending.count()).toBe(3);
    pending.reply(2, 'member', 6);
    await settle();
    expect(selectHostRole.select(store.state)).toBe('member');
    expect(store.state.principal.minimumRevision).toBe(6);
    change(5);
    await settle();
    expect(pending.count()).toBe(3);
  });

  it('keeps own removal revoked even if an outstanding reply says member', async () => {
    const pending = defer();
    start();
    pending.reply(0);
    await settle();
    store.dispatch(principalIdentityChanged('person'));
    store.dispatch(
      hostMembershipChanged({
        revision: 4,
        principalId: 'person',
        hostRole: 'guest',
        action: 'removed',
      }),
    );
    pending.reply(1, 'member', 4);
    await settle();
    expect(store.state.principal.status).toBe('revoked');
    expect(selectCanCreateWorkspace.select(store.state)).toBe(false);
    expect(pending.count()).toBe(2);
  });

  it.each([true, false])(
    'uses valid legacy isAdministrator=%s without inventing member rights',
    async (isAdministrator) => {
      wire.request.mockImplementation(async (method) =>
        method === 'client.hello'
          ? { server: {} }
          : {
              id: 'legacy',
              login: null,
              displayName: null,
              avatarUrl: null,
              isAdministrator,
              hostRole: 'member',
            },
      );
      start();
      workspace(undefined, 'owner');
      await settle();
      expect(selectHostRole.select(store.state)).toBe(isAdministrator ? 'owner' : 'guest');
      expect(selectCanManageWorkspace.select(store.state, 'ws-1')).toBe(isAdministrator);
      expect(selectCanCreateWorkspace.select(store.state)).toBe(isAdministrator);
    },
  );

  it.each([
    null,
    {},
    { ...principal(), hostRole: undefined },
    { ...principal(), hostMembershipRevision: -1 },
    { ...principal(), isAdministrator: true },
  ])('fails closed on an invalid advertised principal: %j', async (reply) => {
    wire.request.mockImplementation(async (method) => (method === 'client.hello' ? hello : reply));
    start();
    await settle();
    expect(selectHostRole.select(store.state)).toBe(null);
    expect(store.state.principal.error).toBe('incompatible-response');
  });

  it('fails closed on refused/failed identity reads and auth rejection', async () => {
    wire.request.mockRejectedValue({ rpcCode: -32003 });
    start();
    await settle();
    expect(selectCanCreateWorkspace.select(store.state)).toBe(false);
    expect(store.state.principal.error).toBe('unavailable');
    store.dispatch(authRejectedReceived({ id: 'local', statusCode: 401 }));
    expect(selectHostRole.select(store.state)).toBe(null);
  });

  it('holds a discovery flight until both wire reads settle, even if one rejects', async () => {
    let finishPrincipal!: (value: unknown) => void;
    wire.request.mockImplementation((method) =>
      method === 'client.hello'
        ? Promise.reject(new Error('offline'))
        : new Promise((resolve) => {
            finishPrincipal = resolve;
          }),
    );
    start();
    store.dispatch(setLabsMultiplayerEnabled(true));
    await settle();
    expect(wire.request).toHaveBeenCalledTimes(2);
    finishPrincipal(principal());
    await settle();
    expect(wire.request).toHaveBeenCalledTimes(4);
  });

  it('ignores malformed and other-subscription invalidations', async () => {
    start();
    await settle();
    for (const [subscriptionId, data] of [
      [
        'other-subscription',
        { revision: 4, action: 'removed', hostRole: 'guest', principalId: 'person' },
      ],
      [
        'role-events',
        { revision: -1, action: 'removed', hostRole: 'guest', principalId: 'person' },
      ],
    ]) {
      routeDaemonEventsNotification(
        'events.event',
        { subscriptionId, event: { type: 'host:members-changed', data } },
        'role-events',
      );
    }
    expect(selectHostRole.select(store.state)).toBe('member');
    expect(wire.request).toHaveBeenCalledTimes(2);
  });

  it('preserves ordinary legacy owner controls with Multiplayer off or missing', async () => {
    wire.request.mockImplementation(async (method) =>
      method === 'client.hello'
        ? { server: {} }
        : { id: 'owner', login: null, displayName: null, avatarUrl: null, isAdministrator: true },
    );
    start();
    workspace(undefined, 'owner');
    await settle();
    expect(selectCanAdministerHost.select(store.state)).toBe(true);
    expect(selectHidesOwnerWorkspaceActions.select(store.state, 'ws-1')).toBe(false);
    expect(selectCanShareWorkspace.select(store.state, 'ws-1')).toBe(false);
    const withoutPreferences = {
      ...store.state,
      userPreferences: undefined,
    } as unknown as typeof store.state;
    expect(selectCollaborationCapabilities.select(withoutPreferences).personalPairing).toBe(false);
    expect(selectCanAdministerHost.select(withoutPreferences)).toBe(true);
  });

  it.each([false, true])('keeps rollout separate with GitLab flag %s', async (gitlab) => {
    // Main has no GitLab lab yet; an additive preference cannot bypass Multiplayer.
    dispose();
    dispose = store.init({ userPreferences: { labsGitLabEnabled: gitlab } } as never);
    const pending = defer();
    start();
    workspace(true);
    pending.reply(0);
    await settle();
    expect(selectHostRole.select(store.state)).toBe('member');
    expect(selectCanShareWorkspace.select(store.state, 'ws-1')).toBe(false);
    expect(selectHidesOwnerWorkspaceActions.select(store.state, 'ws-1')).toBe(true);
    expect(Object.values(selectCollaborationCapabilities.select(store.state))).not.toContain(true);
    store.dispatch(setLabsMultiplayerEnabled(true));
    expect(selectHostRole.select(store.state)).toBe('member');
    expect(selectCanShareWorkspace.select(store.state, 'ws-1')).toBe(false);
    pending.reply(1);
    await settle();
    expect(selectCanShareWorkspace.select(store.state, 'ws-1')).toBe(true);
    expect(selectHidesOwnerWorkspaceActions.select(store.state, 'ws-1')).toBe(false);
    expect(selectCollaborationCapabilities.select(store.state).personalPairing).toBe(true);
    expect(selectCollaborationCapabilities.select(store.state).manageHostMembers).toBe(false);
    store.dispatch(setLabsMultiplayerEnabled(false));
    expect(selectCanShareWorkspace.select(store.state, 'ws-1')).toBe(false);
    expect(selectHostRole.select(store.state)).toBe('member');
    store.dispatch(backendReconnected());
    store.dispatch(daemonEventsSubscribed());
    pending.reply(pending.count() - 1);
    await settle();
    expect(selectCanShareWorkspace.select(store.state, 'ws-1')).toBe(false);
  });
});
