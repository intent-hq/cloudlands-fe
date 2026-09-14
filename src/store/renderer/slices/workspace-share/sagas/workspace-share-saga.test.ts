/**
 * Saga → wire contract for the owner-side Share dialog. FAKE transport only:
 * `backendRequest` is mocked, so each test asserts the exact JSON-RPC method
 * + params (PROTOCOL §5.1 membership) and feeds a contract-shaped reply back.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.request }));

import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { WorkspaceInvite, WorkspaceMember } from '$features/workspace-sharing/types';
import {
  initialState,
  openShareDialog,
  shareInviteCreateRequested,
  shareInviteRevokeRequested,
  shareMemberRemoveRequested,
  workspaceShareReducer,
  type WorkspaceShareState,
} from '../workspace-share-slice';
import { workspaceShareSaga } from './workspace-share-saga';

const owner: WorkspaceMember = {
  principalId: 'p-alice',
  login: 'alice',
  displayName: 'Alice',
  avatarUrl: null,
  role: 'owner',
  addedAt: '2026-09-01T00:00:00Z',
};

const invite: WorkspaceInvite = {
  id: 'inv-1',
  workspaceId: 'ws-1',
  createdByPrincipalId: 'p-alice',
  pinLogin: 'carol',
  pinGithubUserId: 3,
  createdAt: '2026-09-14T00:00:00Z',
  expiresAt: '2026-09-21T00:00:00Z',
};

const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

function harness(seed: WorkspaceShareState = initialState) {
  const channel = stdChannel();
  let state = seed;
  const dispatch = vi.fn((action) => {
    state = workspaceShareReducer(state, action);
    channel.put(action);
  });
  const task = runSaga(
    { channel, dispatch, getState: () => ({ workspaceShare: state }) },
    workspaceShareSaga,
  );
  return { channel, dispatch, task, state: () => state };
}

function opened(): WorkspaceShareState {
  return workspaceShareReducer(
    initialState,
    openShareDialog({ workspaceId: 'ws-1', workspaceTitle: 'My Space' }),
  );
}

/** Reply per method so a read after a mutation gets list-shaped payloads. */
function replyByMethod(overrides: Record<string, unknown> = {}) {
  mocks.request.mockImplementation(async (method: string) => {
    if (method in overrides) {
      const reply = overrides[method];
      if (reply instanceof Error) throw reply;
      return reply;
    }
    if (method === 'workspace.members.list') return { members: [owner] };
    if (method === 'workspace.invite.list') return { invites: [invite] };
    return {};
  });
}

function calls(method: string) {
  return mocks.request.mock.calls.filter(([m]) => m === method);
}

describe('workspaceShareSaga', () => {
  afterEach(() => mocks.request.mockReset());

  it('reads the roster and open invites for the target when the dialog opens', async () => {
    replyByMethod();
    const h = harness();

    h.dispatch(openShareDialog({ workspaceId: 'ws-1', workspaceTitle: 'My Space' }));
    await settle();

    expect(mocks.request).toHaveBeenCalledWith('workspace.members.list', { workspaceId: 'ws-1' });
    expect(mocks.request).toHaveBeenCalledWith('workspace.invite.list', { workspaceId: 'ws-1' });
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(h.state().loadStatus).toBe('loaded');
    expect(getItems(h.state().members)).toEqual([owner]);
    expect(getItems(h.state().invites)).toEqual([invite]);
    h.task.cancel();
  });

  it('records a localized load error when a read fails', async () => {
    replyByMethod({ 'workspace.invite.list': new Error('daemon unavailable') });
    const h = harness();

    h.dispatch(openShareDialog({ workspaceId: 'ws-1', workspaceTitle: 'My Space' }));
    await settle();

    expect(h.state().loadStatus).toBe('error');
    expect(h.state().loadError).toEqual(expect.any(String));
    expect(h.state().loadError).not.toContain('daemon unavailable');
    h.task.cancel();
  });

  it('creates a pinned invite, stores the one-time link, and re-reads the invites', async () => {
    replyByMethod({
      'workspace.invite.create': {
        invite: { ...invite, id: 'inv-2', pinLogin: 'dave', pinGithubUserId: 4 },
        secret: 's3cret',
        url: 'intent://invite?v=1&h=example.test&p=5181&f=fp&t=tok',
        hosts: ['example.test'],
        port: 5181,
        fingerprint: 'fp',
        version: 1,
      },
    });
    const h = harness(opened());

    h.dispatch(shareInviteCreateRequested({ pinLogin: ' dave ' }));
    await settle();

    expect(mocks.request).toHaveBeenCalledWith('workspace.invite.create', {
      workspaceId: 'ws-1',
      pinLogin: 'dave',
    });
    expect(h.state()).toMatchObject({
      creating: false,
      createError: null,
      createdLink: {
        url: 'intent://invite?v=1&h=example.test&p=5181&f=fp&t=tok',
        pinLogin: 'dave',
      },
      loadStatus: 'loaded',
    });
    expect(getItems(h.state().invites)).toEqual([invite]);
    expect(calls('workspace.invite.list')).toHaveLength(1);
    h.task.cancel();
  });

  it('omits pinLogin from the wire for an open invite', async () => {
    replyByMethod({
      'workspace.invite.create': { invite, secret: 's', url: 'intent://invite?t=1' },
    });
    const h = harness(opened());

    h.dispatch(shareInviteCreateRequested({ pinLogin: '' }));
    await settle();

    expect(mocks.request).toHaveBeenCalledWith('workspace.invite.create', { workspaceId: 'ws-1' });
    h.task.cancel();
  });

  it('maps the invite-pin-unknown daemon code onto the localized inline error', async () => {
    const unknown = Object.assign(new Error('unknown GitHub login'), {
      data: { code: 'invite-pin-unknown' },
    });
    replyByMethod({ 'workspace.invite.create': unknown });
    const h = harness(opened());

    h.dispatch(shareInviteCreateRequested({ pinLogin: 'nobody' }));
    await settle();

    expect(h.state().creating).toBe(false);
    expect(h.state().createError).toContain('@nobody');
    expect(h.state().createdLink).toBeNull();
    expect(calls('workspace.invite.list')).toHaveLength(0);
    h.task.cancel();
  });

  it('revokes an invite then re-reads, and surfaces a rejected revoke', async () => {
    replyByMethod({ 'workspace.invite.revoke': { revoked: true } });
    const h = harness(opened());

    h.dispatch(shareInviteRevokeRequested('inv-1'));
    await settle();

    expect(mocks.request).toHaveBeenCalledWith('workspace.invite.revoke', {
      workspaceId: 'ws-1',
      inviteId: 'inv-1',
    });
    expect(h.state()).toMatchObject({ revokingInviteId: null, actionError: null });
    expect(calls('workspace.invite.list')).toHaveLength(1);

    replyByMethod({ 'workspace.invite.revoke': new Error('forbidden') });
    h.dispatch(shareInviteRevokeRequested('inv-1'));
    await settle();

    expect(h.state()).toMatchObject({ revokingInviteId: null, actionError: 'forbidden' });
    expect(calls('workspace.invite.list')).toHaveLength(1);
    h.task.cancel();
  });

  it('removes a collaborator then re-reads the roster', async () => {
    replyByMethod({ 'workspace.members.remove': { removed: true } });
    const h = harness(opened());

    h.dispatch(shareMemberRemoveRequested('p-bob'));
    await settle();

    expect(mocks.request).toHaveBeenCalledWith('workspace.members.remove', {
      workspaceId: 'ws-1',
      principalId: 'p-bob',
    });
    expect(h.state()).toMatchObject({ removingPrincipalId: null, actionError: null });
    expect(calls('workspace.members.list')).toHaveLength(1);
    h.task.cancel();
  });

  it('does nothing when the dialog is closed', async () => {
    replyByMethod();
    const h = harness();

    h.dispatch(shareInviteCreateRequested({ pinLogin: '' }));
    h.dispatch(shareInviteRevokeRequested('inv-1'));
    h.dispatch(shareMemberRemoveRequested('p-bob'));
    await settle();

    expect(mocks.request).not.toHaveBeenCalled();
    h.task.cancel();
  });
});
