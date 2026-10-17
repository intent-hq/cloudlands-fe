import { hostMembershipSaga } from '$store/renderer/slices/host-membership/sagas/host-membership-saga';
import { hostMembershipRequested } from '$store/renderer/slices/host-membership/host-membership-slice';
import { runSaga, stdChannel, type Saga } from 'redux-saga';
import { createEventRecoveryMiddleware } from '$store/renderer/middlewares/event-recovery';
import { workspaceShareSaga } from '$store/renderer/slices/workspace-share/sagas/workspace-share-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollection, getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { Action } from '@redux-saga/types';
import { store } from '$store/renderer/store';
import type { StoreState } from '$store/renderer/types';
import { withHostPrincipal } from '../../test/fixtures/principal-state';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import {
  presenceReducer,
  presenceContextReceived,
  presenceWorkspacesReceived,
  presenceMembersReceived,
  presenceSnapshotReceived,
} from '$store/renderer/slices/presence/presence-slice';
import {
  workspaceShareReducer,
  openShareDialog,
  closeShareDialog,
  shareRosterRequested,
  shareRosterLoaded,
  shareInviteCreateRequested,
} from '$store/renderer/slices/workspace-share/workspace-share-slice';
import {
  hostMembershipReducer,
  hostMembershipOpened,
  hostUserPresenceStarted,
} from '$store/renderer/slices/host-membership/host-membership-slice';
import { selectHostUserPresenceSession } from '$store/renderer/slices/host-membership/host-membership-selectors';
import {
  createEventRecoverySession,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { readInviteLink, storeInviteLink } from '$features/workspace-sharing/invite-link-vault';
import {
  collaborationKey,
  installCollaborationRecovery,
  readCollaboration,
} from './collaboration-recovery';

vi.mock('$lib/components/patterns/notify', () => ({ notify: { success: vi.fn() } }));

const wire = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: wire.request }));

const member = {
  principalId: 'guest',
  role: 'collaborator' as const,
  hostRole: 'guest' as const,
  login: 'guest',
  displayName: null,
  avatarUrl: null,
  addedAt: '2026-09-01T00:00:00Z',
};
const roster = { workspaceId: 'ws', members: [{ ...member, focus: [], typing: [] }] };
const settle = async () => {
  for (let i = 0; i < 80; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
let disposeStore: () => void;
let cleanup: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  disposeStore = store.init();
  cleanup = () => {};
});
afterEach(() => {
  cleanup();
  rendererEventRecovery.dispose();
  disposeStore();
  vi.useRealTimers();
});
function harness(supported = true) {
  let state = withHostPrincipal({
    ...store.state,
    userPreferences: { ...store.state.userPreferences, labsMultiplayerEnabled: true },
  });
  state = {
    ...state,
    workspace: {
      ...state.workspace,
      hasLoaded: true,
      loadedBackendId: state.connections.windowBackendId,
      capabilityContext: selectPrincipalActionContext.select(state),
      workspaces: createCollection('id', [
        { id: 'ws', title: 'Shared', memberCount: 2, myRole: 'owner', canManage: true } as never,
      ]),
    },
    tabState: { ...state.tabState, openTabs: { ws: true } },
  };
  const listeners = new Set<() => void>();
  const channel = stdChannel();
  const reduce = (action: Action) => {
    state = {
      ...state,
      presence: presenceReducer(state.presence, action),
      workspaceShare: workspaceShareReducer(state.workspaceShare, action),
      hostMembership: hostMembershipReducer(state.hostMembership, action),
    };
    for (const listener of listeners) listener();
    channel.put(action);
  };
  const dispatch = createEventRecoveryMiddleware()({} as never)(reduce as never) as (
    action: Action,
  ) => unknown;
  const context = selectPrincipalActionContext.select(state)!;
  dispatch(presenceContextReceived(context, 'owner'));
  dispatch(presenceWorkspacesReceived(['ws']));
  dispatch(presenceMembersReceived('ws', [member]));
  dispatch(presenceSnapshotReceived(roster));
  let notify!: (notification: RecoveryNotification) => void;
  let n = 0;
  const request = vi.fn(async (method: string, params?: unknown): Promise<unknown> => {
    if (method === 'events.subscribe') return { subscriptionId: `lease-${++n}`, lossRecovery: 1 };
    if (method === 'events.fence') return params;
    if (method === 'presence.snapshot') return { workspaceId: 'ws', members: [] };
    if (method === 'workspace.members.list') return { members: [], guestCount: 0, guestLimit: 10 };
    if (method === 'workspace.invite.list') return { invites: [] };
    if (method === 'principal.list') return { principals: [] };
    if (method === 'host.members.list') return { members: [], revision: 2 };
    if (method === 'host.invite.list') return { invites: [] };
    if (method === 'client.list') return { clients: [] };
    return {};
  });
  const scope = rendererEventRecovery.attach(
    createEventRecoverySession({
      supported,
      isCurrent: () => true,
      onRetired: () => () => {},
      dispose: () => {},
      onNotification: (handler) => {
        notify = handler;
        return () => {};
      },
      request: async (method, params, observe) => {
        const result = await request(method, params);
        observe?.(result);
        return result;
      },
    }),
  );
  cleanup = installCollaborationRecovery(scope, {
    getState: () => state,
    dispatch,
    subscribe: (handler) => {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
  });
  return {
    request,
    run: (saga: Saga) => {
      const task = runSaga({ channel, dispatch, getState: () => state }, saga);
      const before = cleanup;
      cleanup = () => {
        task.cancel();
        before();
        channel.close();
      };
    },
    scope,
    dispatch,
    state: () => state,
    context,
    change: (fn: (s: StoreState) => StoreState) => {
      state = fn(state);
      for (const l of listeners) l();
    },
    loss: (id = 'lease-1', generation = '1', workspaceId: string | null = 'ws') =>
      notify({
        method: 'events.lost',
        params: { subscriptionId: id, generation, scope: { workspaceId } },
      }),
    event: () =>
      notify({
        method: 'events.event',
        params: {
          subscriptionId: 'lease-1',
          event: { type: 'presence:changed', workspaceId: 'ws', data: roster },
        },
      }),
    subscribe: (
      eventTypes = ['presence:changed', 'workspace:updated'],
      workspaceId: string | undefined = 'ws',
    ) =>
      scope.subscribe({ eventTypes, ...(workspaceId ? { workspaceId } : {}) }, { recover: true }),
  };
}
describe('collaboration loss recovery', () => {
  it('restores all demanded sharing and host projections with exact scoped reads and no leaked links', async () => {
    const h = harness();
    h.dispatch(openShareDialog({ workspaceId: 'ws', workspaceTitle: 'Shared' }));
    h.dispatch(shareRosterRequested({ workspaceId: 'ws' }));
    h.dispatch(shareRosterLoaded({ workspaceId: 'ws', members: [member] }));
    h.dispatch(hostMembershipOpened({ session: 'host', context: h.context }));
    h.dispatch(hostUserPresenceStarted(selectHostUserPresenceSession.select(h.state())!));
    storeInviteLink('revoked', 'secret');
    await h.subscribe(['*'], '');
    h.loss('lease-1', '1', null);
    await settle();
    expect(getItems(h.state().presence.rosters.ws)).toEqual([]);
    expect(getItems(h.state().presence.members.ws)).toEqual([]);
    expect(h.state().workspaceShare.loadStatus).toBe('loaded');
    expect(getItems(h.state().workspaceShare.byWorkspaceId.ws.members)).toEqual([]);
    expect(h.state().hostMembership.loaded).toBe(true);
    expect(h.state().hostMembership.revision).toBe(2);
    expect(h.state().hostMembership.presence.status).toBe('ready');
    expect(readInviteLink('revoked')).toBeNull();
    expect(h.request.mock.calls.filter(([m]) => !m.startsWith('events.'))).toEqual(
      expect.arrayContaining([
        ['presence.snapshot', { workspaceId: 'ws' }],
        ['workspace.members.list', { workspaceId: 'ws' }],
        ['workspace.invite.list', { workspaceId: 'ws' }],
        ['principal.list', {}],
        ['host.members.list', {}],
        ['host.invite.list', {}],
        ['client.list', undefined],
      ]),
    );
    expect(h.request.mock.calls.filter(([m]) => !m.startsWith('events.'))).toHaveLength(9);
  });
  it('coalesces duplicate and overlapping losses and rejects a pre-loss reply', async () => {
    const h = harness();
    await h.subscribe();
    await h.subscribe();
    const token = rendererEventRecovery.capture(collaborationKey('presence-roster', 'ws'));
    h.loss();
    h.loss();
    h.loss('lease-2');
    await settle();
    expect(h.request.mock.calls.filter(([m]) => m === 'presence.snapshot')).toHaveLength(1);
    expect(h.request.mock.calls.filter(([m]) => m === 'workspace.members.list')).toHaveLength(1);
    expect(
      token.commit(() => {
        h.dispatch(presenceSnapshotReceived(roster));
      }),
    ).toBe(false);
    expect(getItems(h.state().presence.rosters.ws)).toEqual([]);
  });
  it('waits for an ordinary flight, ignores its old data, and starts only one trailing read', async () => {
    const h = harness();
    await h.subscribe();
    const held = deferred<typeof roster>();
    const old = rendererEventRecovery.capture(collaborationKey('presence-roster', 'ws'));
    const ordinary = readCollaboration(
      collaborationKey('presence-roster', 'ws'),
      () => held.promise,
    );
    h.loss();
    await settle();
    expect(h.request.mock.calls.filter(([m]) => m === 'presence.snapshot')).toHaveLength(0);
    expect(
      await readCollaboration(collaborationKey('presence-roster', 'ws'), () => {
        throw Error('must not read');
      }),
    ).toBeUndefined();
    held.resolve(roster);
    await ordinary;
    await settle();
    expect(
      old.commit(() => {
        h.dispatch(presenceSnapshotReceived(roster));
      }),
    ).toBe(false);
    expect(getItems(h.state().presence.rosters.ws)).toEqual([]);
    expect(h.request.mock.calls.filter(([m]) => m === 'presence.snapshot')).toHaveLength(1);
  });
  it('turns delayed unversioned pushes into bounded reads after recovery', async () => {
    const h = harness();
    await h.subscribe();
    h.loss();
    await settle();
    for (let i = 0; i < 20; i++) h.event();
    await vi.advanceTimersByTimeAsync(250);
    await settle();
    expect(h.request.mock.calls.filter(([m]) => m === 'presence.snapshot')).toHaveLength(2);
    expect(getItems(h.state().presence.rosters.ws)).toEqual([]);
  });
  it('clears removed workspace rows and rejects the held reply across workspace ABA', async () => {
    const h = harness();
    await h.subscribe();
    h.dispatch(shareRosterRequested({ workspaceId: 'ws' }));
    h.dispatch(shareRosterLoaded({ workspaceId: 'ws', members: [member] }));
    const held = deferred<unknown>();
    h.request.mockImplementation(async (method, params) =>
      method === 'presence.snapshot'
        ? held.promise
        : method === 'workspace.members.list'
          ? { members: [] }
          : params,
    );
    h.loss();
    await settle();
    const original = h.state().workspace;
    h.change((s) => ({ ...s, workspace: { ...s.workspace, workspaces: createCollection('id') } }));
    expect(h.state().presence.rosters.ws).toBeUndefined();
    expect(h.state().workspaceShare.byWorkspaceId.ws).toBeUndefined();
    h.change((s) => ({ ...s, workspace: original }));
    held.resolve(roster);
    await settle();
    expect(h.state().presence.rosters.ws).toBeUndefined();
  });
  it('drops a held Share reply and its secret after close and reopen', async () => {
    const h = harness();
    h.dispatch(openShareDialog({ workspaceId: 'ws', workspaceTitle: 'Shared' }));
    await h.subscribe();
    const held = deferred<unknown>();
    const original = h.request.getMockImplementation()!;
    h.request.mockImplementation((method, params) =>
      method === 'workspace.invite.list' ? held.promise : original(method, params),
    );
    h.loss();
    await settle();
    h.dispatch(closeShareDialog());
    h.dispatch(openShareDialog({ workspaceId: 'ws', workspaceTitle: 'Shared' }));
    held.resolve({ invites: [{ id: 'old', url: 'secret' }] });
    await settle();
    expect(readInviteLink('old')).toBeNull();
    expect(getItems(h.state().workspaceShare.invites)).toEqual([]);
  });
  it('clears all protected rows on principal retirement before held recovery replies return', async () => {
    const h = harness();
    h.dispatch(shareRosterRequested({ workspaceId: 'ws' }));
    h.dispatch(shareRosterLoaded({ workspaceId: 'ws', members: [member] }));
    await h.subscribe();
    const held = deferred<unknown>();
    h.request.mockImplementation((method, params) =>
      method === 'presence.snapshot'
        ? held.promise
        : Promise.resolve(method === 'workspace.members.list' ? { members: [] } : params),
    );
    h.loss();
    await settle();
    h.change((s) => ({ ...s, principal: { ...s.principal, snapshot: null, status: 'loading' } }));
    expect(h.state().presence.rosters.ws).toBeUndefined();
    expect(h.state().workspaceShare.byWorkspaceId.ws).toBeUndefined();
    held.resolve(roster);
    await settle();
    expect(h.state().presence.rosters.ws).toBeUndefined();
  });
  it('retires a forbidden roster after one request without repeated recovery', async () => {
    const h = harness();
    await h.subscribe();
    const original = h.request.getMockImplementation()!;
    h.request.mockImplementation((method, params) =>
      method === 'presence.snapshot'
        ? Promise.reject({ rpcCode: -32003 })
        : original(method, params),
    );
    h.loss();
    await settle();
    await vi.advanceTimersByTimeAsync(10000);
    expect(h.state().presence.rosters.ws).toBeUndefined();
    expect(h.request.mock.calls.filter(([m]) => m === 'presence.snapshot')).toHaveLength(1);
  });
  it('keeps ordinary events read-free before loss and inactive dialogs unread', async () => {
    const h = harness();
    await h.subscribe();
    h.event();
    await settle();
    expect(h.request.mock.calls.filter(([m]) => !m.startsWith('events.'))).toEqual([]);
    h.loss();
    await settle();
    expect(
      h.request.mock.calls.filter(
        ([m]) => m === 'workspace.invite.list' || m === 'host.members.list',
      ),
    ).toEqual([]);
  });
  it('rejects a held snapshot after a subscription replacement, then recovers the new lease', async () => {
    const h = harness();
    const old = await h.subscribe();
    const held = deferred<unknown>();
    const original = h.request.getMockImplementation()!;
    let first = true;
    h.request.mockImplementation((method, params) => {
      if (method === 'presence.snapshot' && first) {
        first = false;
        return held.promise;
      }
      return original(method, params);
    });
    h.loss();
    await settle();
    await h.scope.unsubscribe(old!.id);
    await h.subscribe();
    h.loss('lease-2');
    held.resolve(roster);
    await settle();
    await vi.advanceTimersByTimeAsync(250);
    await settle();
    expect(getItems(h.state().presence.rosters.ws)).toEqual([]);
    expect(h.request.mock.calls.filter(([m]) => m === 'presence.snapshot')).toHaveLength(2);
  });
  it('retires host roster and invite capabilities on backend session disposal', async () => {
    const h = harness();
    h.dispatch(hostMembershipOpened({ session: 'host', context: h.context }));
    await h.subscribe(['*'], '');
    h.loss('lease-1', '1', null);
    await settle();
    expect(h.state().hostMembership.loaded).toBe(true);
    rendererEventRecovery.dispose();
    expect(h.state().hostMembership.loaded).toBe(false);
    expect(h.state().presence.rosters.ws).toBeUndefined();
  });

  it('guards an actual hover saga response held across loss and replaces it once', async () => {
    const h = harness();
    await h.subscribe();
    h.run(workspaceShareSaga);
    const held = deferred<unknown>();
    wire.request.mockReset().mockReturnValue(held.promise);
    h.dispatch(shareRosterRequested({ workspaceId: 'ws' }));
    await settle();
    h.loss();
    await settle();
    // Presence membership reads independently, but the hover owner waits for its ordinary read.
    const baseline = h.request.mock.calls.filter(([m]) => m === 'workspace.members.list').length;
    held.resolve({ members: [member] });
    await settle();
    expect(getItems(h.state().workspaceShare.byWorkspaceId.ws.members)).toEqual([]);
    expect(h.request.mock.calls.filter(([m]) => m === 'workspace.members.list')).toHaveLength(
      baseline + 1,
    );
    expect(wire.request.mock.calls).toEqual([['workspace.members.list', { workspaceId: 'ws' }]]);
  });
  it.each([false, true])(
    'reconciles create secrets after loss without replay (already recovered: %s)',
    async (alreadyRecovered) => {
      const h = harness();
      await h.subscribe();
      h.run(workspaceShareSaga);
      const created = deferred<unknown>();
      wire.request.mockReset().mockImplementation(async (method: string) => {
        if (method === 'workspace.members.list')
          return { members: [], guestCount: 0, guestLimit: 10 };
        if (method === 'workspace.invite.list') return { invites: [] };
        if (method === 'principal.list') return { principals: [] };
        if (method === 'workspace.invite.create') return created.promise;
        throw Error(method);
      });
      h.dispatch(openShareDialog({ workspaceId: 'ws', workspaceTitle: 'Shared' }));
      await settle();
      if (alreadyRecovered) {
        h.loss();
        await settle();
      }
      h.dispatch(shareInviteCreateRequested({ pinLogin: '' }));
      await settle();
      if (!alreadyRecovered) {
        h.loss();
        await settle();
      }
      created.resolve({
        invite: { id: 'revoked', pinLogin: null, pinIdentity: null },
        url: 'old-secret',
      });
      await settle();
      await vi.advanceTimersByTimeAsync(250);
      await settle();
      expect(readInviteLink('revoked')).toBeNull();
      expect(h.state().workspaceShare.creating).toBe(false);
      expect(h.state().workspaceShare.createdLink).toBeNull();
      expect(wire.request.mock.calls.filter(([m]) => m === 'workspace.invite.create')).toEqual([
        ['workspace.invite.create', { workspaceId: 'ws' }],
      ]);
    },
  );
  it('preserves legacy delivery without pretending unsupported loss can recover', async () => {
    const h = harness(false);
    await h.subscribe();
    h.loss();
    await settle();
    expect(h.request.mock.calls).toEqual([
      [
        'events.subscribe',
        { workspaceId: 'ws', eventTypes: ['presence:changed', 'workspace:updated'] },
      ],
    ]);
    const data = await readCollaboration(
      collaborationKey('presence-roster', 'ws'),
      async () => roster,
    );
    expect(data).toEqual(roster);
  });
  it('does not issue another ordinary read from a retired owner', async () => {
    const h = harness();
    await h.subscribe();
    const original = h.request.getMockImplementation()!;
    h.request.mockImplementation((method, params) =>
      method === 'presence.snapshot'
        ? Promise.reject({ rpcCode: -32003 })
        : original(method, params),
    );
    h.loss();
    await settle();
    const read = vi.fn(async () => roster);
    expect(
      await readCollaboration(collaborationKey('presence-roster', 'ws'), read),
    ).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });
  it('restores authenticated online host members after the final client event is lost', async () => {
    const h = harness();
    h.dispatch(hostMembershipOpened({ session: 'host', context: h.context }));
    h.dispatch(hostUserPresenceStarted(selectHostUserPresenceSession.select(h.state())!));
    const original = h.request.getMockImplementation()!;
    h.request.mockImplementation((method, params) =>
      method === 'client.list'
        ? Promise.resolve({
            clients: [
              {
                clientId: 'client',
                principalId: 'member',
                hostRole: 'member',
                login: null,
                displayName: null,
                avatarUrl: null,
                connections: 1,
                transports: ['wss'],
                connectedAt: '2026-10-13T00:00:00Z',
                capabilities: {},
              },
            ],
          })
        : original(method, params),
    );
    await h.subscribe(['client:connected', 'client:disconnected'], '');
    h.loss('lease-1', '1', null);
    await settle();
    expect(h.state().hostMembership.presence.onlinePrincipalIds).toEqual(['member']);
    expect(h.request.mock.calls.filter(([m]) => m === 'client.list')).toEqual([
      ['client.list', undefined],
    ]);
  });
});

it('host recovery does not settle a still-running invite command', async () => {
  const h = harness();
  h.run(hostMembershipSaga);
  const created = deferred<unknown>();
  wire.request.mockReset().mockImplementation(async (method) => {
    if (method === 'host.members.list') return { members: [], revision: 1 };
    if (method === 'host.invite.list') return { invites: [] };
    if (method === 'host.invite.create') return created.promise;
    throw Error(method);
  });
  const target = { session: 'host', context: h.context };
  h.dispatch(hostMembershipOpened(target));
  await settle();
  await h.subscribe(['*'], '');
  const command = {
    kind: 'create' as const,
    input: { pinLogin: 'test', pinProvider: 'github' as const, pinHost: 'github.com' },
  };
  h.dispatch(hostMembershipRequested(target, command));
  await settle();
  expect(h.state().hostMembership.busy).toBe(true);
  h.loss('lease-1', '1', null);
  await settle();
  const whilePending = h.state().hostMembership.busy;
  h.dispatch(hostMembershipRequested(target, command));
  await settle();
  const starts = wire.request.mock.calls.filter(([m]) => m === 'host.invite.create').length;
  created.resolve({ invite: { id: 'test' }, url: 'secret' });
  await settle();
  expect({ busyWhileOriginalCommandPending: whilePending, physicalCommandStarts: starts }).toEqual({
    busyWhileOriginalCommandPending: true,
    physicalCommandStarts: 1,
  });
});

it('does not let an old command settle a sibling in a reopened host view', async () => {
  const h = harness();
  h.run(hostMembershipSaga);
  const first = deferred<unknown>();
  const second = deferred<unknown>();
  let starts = 0;
  wire.request.mockReset().mockImplementation(async (method) => {
    if (method === 'host.members.list') return { members: [], revision: 1 };
    if (method === 'host.invite.list') return { invites: [] };
    if (method === 'host.invite.create') return ++starts === 1 ? first.promise : second.promise;
    throw Error(method);
  });
  const target = { session: 'host', context: h.context };
  const command = {
    kind: 'create' as const,
    input: { pinLogin: 'test', pinProvider: 'github' as const, pinHost: 'github.com' },
  };
  h.dispatch(hostMembershipOpened(target));
  await settle();
  await h.subscribe(['*'], '');
  h.dispatch(hostMembershipRequested(target, command));
  await settle();
  h.loss('lease-1', '1', null);
  await settle();
  h.dispatch(hostMembershipOpened(target));
  await settle();
  h.dispatch(hostMembershipRequested(target, command));
  await settle();
  expect(starts).toBe(2);
  first.resolve({ invite: { id: 'old' }, url: 'old-secret' });
  await settle();
  expect(h.state().hostMembership).toMatchObject({ busy: true, creating: true });
  second.resolve({ invite: { id: 'new' }, url: 'new-secret' });
  await settle();
  expect(h.state().hostMembership).toMatchObject({ busy: false, creating: false });
});

it('newer presence push supersedes held membership recovery snapshot', async () => {
  const h = harness();
  await h.subscribe(['workspace:updated']);
  const members = deferred<unknown>();
  const original = h.request.getMockImplementation()!;
  h.request.mockImplementation((method, params) =>
    method === 'workspace.members.list' ? members.promise : original(method, params),
  );
  h.loss();
  await settle();
  const key = collaborationKey('presence-roster', 'ws');
  expect(rendererEventRecovery.push(key)).toBe(true);
  const { presenceRosterReceived } = await import('$store/renderer/slices/presence/presence-slice');
  rendererEventRecovery.capture(key).commit(() => {
    h.dispatch(
      presenceRosterReceived({
        ...roster,
        members: [{ ...roster.members[0], displayName: 'fresh' }],
      }),
    );
  });
  expect(getItems(h.state().presence.members.ws)[0].displayName).toBe('fresh');
  members.resolve({ members: [{ ...member, displayName: 'old' }] });
  await settle();
  expect(getItems(h.state().presence.members.ws)[0].displayName).toBe('fresh');
});

it('discarded invite completion cannot settle a pending member operation', async () => {
  const { shareMemberAddRequested } =
    await import('$store/renderer/slices/workspace-share/workspace-share-slice');
  const h = harness();
  await h.subscribe();
  h.run(workspaceShareSaga);
  const created = deferred<unknown>();
  const added = deferred<unknown>();
  wire.request.mockReset().mockImplementation(async (method: string) => {
    if (method === 'workspace.members.list') return { members: [], guestCount: 0, guestLimit: 10 };
    if (method === 'workspace.invite.list') return { invites: [] };
    if (method === 'principal.list') return { principals: [] };
    if (method === 'workspace.invite.create') return created.promise;
    if (method === 'workspace.members.add') return added.promise;
    throw Error(method);
  });
  h.dispatch(openShareDialog({ workspaceId: 'ws', workspaceTitle: 'Shared' }));
  await settle();
  h.dispatch(shareInviteCreateRequested({ pinLogin: '' }));
  h.dispatch(shareMemberAddRequested('guest'));
  await settle();
  expect(h.state().workspaceShare).toMatchObject({ creating: true, addingPrincipalId: 'guest' });
  h.loss();
  await settle();
  created.resolve({
    invite: { id: 'revoked', pinLogin: null, pinIdentity: null },
    url: 'old-secret',
  });
  await settle();
  const pendingAfterSiblingSettles = h.state().workspaceShare.addingPrincipalId;
  h.dispatch(shareMemberAddRequested('guest'));
  h.dispatch(shareMemberAddRequested('other-guest'));
  await settle();
  const starts = wire.request.mock.calls.filter(([m]) => m === 'workspace.members.add').length;
  added.resolve({ added: true });
  await settle();
  expect({ pendingAfterSiblingSettles, physicalMemberStarts: starts }).toEqual({
    pendingAfterSiblingSettles: 'guest',
    physicalMemberStarts: 1,
  });
});

it('retired hover removal cannot settle a new workspace lifetime operation', async () => {
  const { shareRosterMemberRemoveRequested } =
    await import('$store/renderer/slices/workspace-share/workspace-share-slice');
  const h = harness();
  await h.subscribe();
  h.run(workspaceShareSaga);
  const first = deferred<unknown>();
  const second = deferred<unknown>();
  let starts = 0;
  wire.request.mockReset().mockImplementation(async (method: string) => {
    if (method === 'workspace.members.list')
      return {
        members: [member, { ...member, principalId: 'second-guest' }],
        guestCount: 2,
        guestLimit: 10,
      };
    if (method === 'workspace.members.remove')
      return ++starts === 1 ? first.promise : second.promise;
    throw Error(method);
  });
  h.dispatch(shareRosterRequested({ workspaceId: 'ws' }));
  await settle();
  h.dispatch(shareRosterMemberRemoveRequested({ workspaceId: 'ws', principalId: 'guest' }));
  await settle();
  expect(starts).toBe(1);
  const original = h.state().workspace;
  h.change((s) => ({ ...s, workspace: { ...s.workspace, workspaces: createCollection('id') } }));
  expect(h.state().workspaceShare.byWorkspaceId.ws).toBeUndefined();
  h.change((s) => ({ ...s, workspace: original }));
  h.dispatch(shareRosterRequested({ workspaceId: 'ws' }));
  await settle();
  h.dispatch(shareRosterMemberRemoveRequested({ workspaceId: 'ws', principalId: 'second-guest' }));
  await settle();
  expect(starts).toBe(2);
  expect(h.state().workspaceShare.byWorkspaceId.ws.removingPrincipalId).toBe('second-guest');
  first.resolve({});
  await settle();
  const pendingAfterOldSettles = h.state().workspaceShare.byWorkspaceId.ws.removingPrincipalId;
  h.dispatch(shareRosterMemberRemoveRequested({ workspaceId: 'ws', principalId: 'third-guest' }));
  await settle();
  const totalStarts = starts;
  second.resolve({});
  await settle();
  expect({ pendingAfterOldSettles, totalStarts }).toEqual({
    pendingAfterOldSettles: 'second-guest',
    totalStarts: 2,
  });
});

it('discarded member completion cannot settle a pending invite creation', async () => {
  const { shareMemberAddRequested } =
    await import('$store/renderer/slices/workspace-share/workspace-share-slice');
  const h = harness();
  await h.subscribe();
  h.run(workspaceShareSaga);
  const created = deferred<unknown>();
  const added = deferred<unknown>();
  wire.request.mockReset().mockImplementation(async (method: string) => {
    if (method === 'workspace.members.list') return { members: [], guestCount: 0, guestLimit: 10 };
    if (method === 'workspace.invite.list') return { invites: [] };
    if (method === 'principal.list') return { principals: [] };
    if (method === 'workspace.invite.create') return created.promise;
    if (method === 'workspace.members.add') return added.promise;
    throw Error(method);
  });
  h.dispatch(openShareDialog({ workspaceId: 'ws', workspaceTitle: 'Shared' }));
  await settle();
  h.dispatch(shareInviteCreateRequested({ pinLogin: '' }));
  h.dispatch(shareMemberAddRequested('guest'));
  await settle();
  h.loss();
  await settle();
  added.resolve({ added: true });
  await settle();
  const creating = h.state().workspaceShare.creating;
  // The dialog enables Create only after its own operation settles.
  if (!creating) h.dispatch(shareInviteCreateRequested({ pinLogin: '' }));
  await settle();
  const starts = wire.request.mock.calls.filter(([m]) => m === 'workspace.invite.create').length;
  created.resolve({
    invite: { id: 'revoked', pinLogin: null, pinIdentity: null },
    url: 'old-secret',
  });
  await settle();
  expect({ creating, starts }).toEqual({ creating: true, starts: 1 });
  expect(readInviteLink('revoked')).toBeNull();
});
