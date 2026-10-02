import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import {
  withHostPrincipal,
  withLegacyPrincipal,
} from '../../../../../test/fixtures/principal-state';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import {
  hostMembershipReducer,
  hostMembershipOpened,
  hostMembershipClosed,
  hostMembershipRequested,
  initialState,
} from '../host-membership-slice';
import { hostMembershipSaga } from './host-membership-saga';
import { readHostInviteLink } from '$features/host-membership/invite-links';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.request }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { success: vi.fn() } }));
const owner = {
  principalId: 'owner',
  hostRole: 'owner',
  login: null,
  displayName: null,
  avatarUrl: null,
  addedAt: '2026-09-01T00:00:00Z',
};
const member = { ...owner, principalId: 'member', hostRole: 'member' };
const invitation = {
  id: 'invite',
  scope: 'host',
  role: 'member',
  createdByPrincipalId: 'owner',
  pinLogin: 'sam',
  pinIdentity: { provider: 'github', host: 'github.com', externalUserId: '2' },
  reusable: false,
  redemptionCount: 0,
  createdAt: '2026-09-30T00:00:00Z',
  expiresAt: '2026-10-07T00:00:00Z',
};
const secret = 'secret-marker';
const url = `intent://invite?v=1&port=8080&fp=fp&inviteId=invite&secret=${secret}&tc=address&scope=host`;
const settle = async () => {
  for (let i = 0; i < 24; i++) await Promise.resolve();
};
function harness(role: 'owner' | 'member' | 'guest' = 'owner', legacy = false) {
  let state = (legacy ? withLegacyPrincipal : withHostPrincipal)(
    {
      hostMembership: initialState,
      userPreferences: { labsMultiplayerEnabled: true, labsGitLabEnabled: true },
    },
    role === 'member' && legacy ? 'guest' : (role as 'owner' | 'guest'),
  );
  const target = { session: 'session', context: selectPrincipalActionContext.select(state)! };
  const channel = stdChannel();
  const actions: unknown[] = [];
  const dispatch = (action: Parameters<typeof hostMembershipReducer>[1]) => {
    state = { ...state, hostMembership: hostMembershipReducer(state.hostMembership, action) };
    actions.push(action);
    channel.put(action);
  };
  const task = runSaga({ channel, dispatch, getState: () => state }, hostMembershipSaga);
  return {
    target,
    task,
    dispatch,
    actions,
    state: () => state,
    change: (next: typeof state) => {
      state = next;
    },
  };
}
describe('owner host membership wire and authority', () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.request.mockImplementation(async (method: string) => {
      if (method === 'host.members.list') return { members: [owner, member], revision: 1 };
      if (method === 'host.invite.list') return { invites: [{ ...invitation, url }] };
      if (method === 'host.invite.create')
        return {
          invite: { ...invitation, url },
          url,
          secret,
          hosts: [],
          port: 8080,
          fingerprint: 'fp',
          version: 1,
          tcAddress: 'address',
        };
      if (method === 'host.members.remove') return { removed: true };
      if (method === 'host.invite.revoke') return { revoked: true };
      throw new Error('unexpected');
    });
  });
  afterEach(() => {
    mocks.request.mockReset();
  });
  it('owner with no profile or repository setup loads and issues an explicitly pinned host invitation', async () => {
    const h = harness();
    try {
      h.dispatch(hostMembershipOpened(h.target));
      await settle();
      expect(mocks.request).toHaveBeenCalledWith('host.members.list', {});
      expect(mocks.request).toHaveBeenCalledWith('host.invite.list', {});
      h.dispatch(
        hostMembershipRequested(h.target, {
          kind: 'create',
          input: { pinLogin: ' sam ', pinProvider: 'github' },
        }),
      );
      await settle();
      expect(mocks.request).toHaveBeenCalledWith('host.invite.create', {
        pinLogin: 'sam',
        pinProvider: 'github',
        pinHost: 'github.com',
      });
      expect(JSON.stringify(h.actions)).not.toContain(secret);
      expect(JSON.stringify(h.state())).not.toContain(secret);
      expect(readHostInviteLink('session', 'invite')).toBe(url);
      h.dispatch(hostMembershipClosed(h.target));
      await settle();
      expect(readHostInviteLink('session', 'invite')).toBeNull();
    } finally {
      h.task.cancel();
    }
  });
  it.each(['member', 'guest', 'legacy', 'disabled', 'unknown'] as const)(
    'issues no host RPCs for %s',
    async (caseName) => {
      const h = harness(
        caseName === 'member' || caseName === 'guest' ? caseName : 'owner',
        caseName === 'legacy',
      );
      if (caseName === 'disabled')
        h.change({
          ...h.state(),
          userPreferences: { ...h.state().userPreferences, labsMultiplayerEnabled: false },
        });
      if (caseName === 'unknown')
        h.change({ ...h.state(), principal: { ...h.state().principal, status: 'loading' } });
      try {
        h.dispatch(hostMembershipOpened(h.target));
        h.dispatch(
          hostMembershipRequested(h.target, {
            kind: 'create',
            input: { pinLogin: 'sam', pinProvider: 'github' },
          }),
        );
        h.dispatch(hostMembershipRequested(h.target, { kind: 'remove', principalId: 'member' }));
        h.dispatch(hostMembershipRequested(h.target, { kind: 'revoke', inviteId: 'invite' }));
        await settle();
        expect(mocks.request).not.toHaveBeenCalled();
      } finally {
        h.task.cancel();
      }
    },
  );
  it('pins GitLab independently of repository instance and keeps methods daemon-global', async () => {
    const h = harness();
    try {
      h.dispatch(hostMembershipOpened(h.target));
      await settle();
      h.dispatch(
        hostMembershipRequested(h.target, {
          kind: 'create',
          input: { pinLogin: 'sam', pinProvider: 'gitlab', pinHost: 'Forge.Example:8443' },
        }),
      );
      await settle();
      expect(mocks.request).toHaveBeenCalledWith('host.invite.create', {
        pinLogin: 'sam',
        pinProvider: 'gitlab',
        pinHost: 'forge.example:8443',
      });
      h.dispatch(hostMembershipRequested(h.target, { kind: 'remove', principalId: 'owner' }));
      await settle();
      expect(
        mocks.request.mock.calls.filter(([method]) => method === 'host.members.remove'),
      ).toEqual([]);
      h.dispatch(hostMembershipRequested(h.target, { kind: 'remove', principalId: 'member' }));
      await settle();
      expect(mocks.request).toHaveBeenCalledWith('host.members.remove', { principalId: 'member' });
      h.dispatch(hostMembershipRequested(h.target, { kind: 'revoke', inviteId: 'invite' }));
      await settle();
      expect(mocks.request).toHaveBeenCalledWith('host.invite.revoke', { inviteId: 'invite' });
    } finally {
      h.task.cancel();
    }
  });
  it('drops a pending read after a principal context change without retaining links', async () => {
    let resolve!: (value: unknown) => void;
    mocks.request.mockImplementation((method) =>
      method === 'host.members.list'
        ? new Promise((r) => {
            resolve = r;
          })
        : Promise.resolve({ invites: [{ ...invitation, url }] }),
    );
    const h = harness();
    try {
      h.dispatch(hostMembershipOpened(h.target));
      await settle();
      h.change({ ...h.state(), principal: { ...h.state().principal, invalidation: 1 } });
      resolve({ members: [owner], revision: 1 });
      await settle();
      expect(h.state().hostMembership.loaded).toBe(false);
      expect(h.actions.some((a) => JSON.stringify(a).includes(secret))).toBe(false);
    } finally {
      h.dispatch(hostMembershipClosed(h.target));
      h.task.cancel();
    }
  });
  it.each(['role', 'principal', 'host', 'revision', 'disabled', 'closed'] as const)(
    'does not reload or retain a pending invitation after %s changes',
    async (change) => {
      const h = harness();
      try {
        h.dispatch(hostMembershipOpened(h.target));
        await settle();
        let resolve!: (value: unknown) => void;
        mocks.request.mockImplementationOnce(
          () =>
            new Promise((done) => {
              resolve = done;
            }),
        );
        mocks.request.mockClear();
        h.dispatch(
          hostMembershipRequested(h.target, {
            kind: 'create',
            input: { pinLogin: 'sam', pinProvider: 'github' },
          }),
        );
        await settle();
        const state = h.state();
        if (change === 'role') h.change(withHostPrincipal(state, 'member'));
        if (change === 'principal' || change === 'revision')
          h.change({
            ...state,
            principal: {
              ...state.principal,
              snapshot: {
                ...state.principal.snapshot!,
                principal: {
                  ...state.principal.snapshot!.principal,
                  ...(change === 'principal'
                    ? { id: 'different-person' }
                    : { hostMembershipRevision: 2 }),
                },
              },
            },
          });
        if (change === 'host')
          h.change({
            ...state,
            connections: { ...state.connections, windowBackendId: 'other-host' },
          });
        if (change === 'disabled')
          h.change({
            ...state,
            userPreferences: { ...state.userPreferences, labsMultiplayerEnabled: false },
          });
        if (change === 'closed') h.dispatch(hostMembershipClosed(h.target));
        resolve({ invite: invitation, url: url + '-new', secret });
        await settle();
        expect(mocks.request.mock.calls.map(([method]) => method)).toEqual(['host.invite.create']);
        expect(readHostInviteLink('session', 'invite')).not.toBe(url + '-new');
        expect(JSON.stringify(h.actions)).not.toContain(secret);
      } finally {
        h.dispatch(hostMembershipClosed(h.target));
        h.task.cancel();
      }
    },
  );
  it('withholds forbidden host administration and never exposes the server error text', async () => {
    const h = harness();
    try {
      mocks.request.mockRejectedValue({ rpcCode: -32003, message: secret });
      h.dispatch(hostMembershipOpened(h.target));
      await settle();
      expect(h.state().hostMembership.withheld).toBe(true);
      expect(JSON.stringify(h.state())).not.toContain(secret);
      mocks.request.mockClear();
      h.dispatch(hostMembershipRequested(h.target, { kind: 'load' }));
      h.dispatch(hostMembershipRequested(h.target, { kind: 'copy', inviteId: 'invite' }));
      await settle();
      expect(mocks.request).not.toHaveBeenCalled();
      expect(readHostInviteLink('session', 'invite')).toBeNull();
    } finally {
      h.dispatch(hostMembershipClosed(h.target));
      h.task.cancel();
    }
  });
  it.each(['gitlab-disabled', 'invalid-host'] as const)(
    'rejects %s without issuing an invitation',
    async (reason) => {
      const h = harness();
      try {
        h.dispatch(hostMembershipOpened(h.target));
        await settle();
        if (reason === 'gitlab-disabled')
          h.change({
            ...h.state(),
            userPreferences: { ...h.state().userPreferences, labsGitLabEnabled: false },
          });
        mocks.request.mockClear();
        h.dispatch(
          hostMembershipRequested(h.target, {
            kind: 'create',
            input: {
              pinLogin: 'sam',
              pinProvider: 'gitlab',
              pinHost: reason === 'invalid-host' ? 'https://forge.example/path' : 'forge.example',
            },
          }),
        );
        await settle();
        expect(mocks.request).not.toHaveBeenCalled();
        expect(h.state().hostMembership.error).toBeTruthy();
      } finally {
        h.dispatch(hostMembershipClosed(h.target));
        h.task.cancel();
      }
    },
  );
});
