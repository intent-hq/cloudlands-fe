/**
 * Wire-contract tests for the owner-side sharing client (intent-hq/intentd#1868
 * / #1872). FAKE transport only: `backendRequest` is mocked, so each test
 * asserts the JSON-RPC method + params emitted and how the daemon result or
 * error folds into the client's return contract.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
}));

import { backendRequest } from '$lib/client/live/backend-transport';
import { BackendError } from '$lib/client/live/backend-transport-types';
import { inviteErrorCode, workspaceSharingClient } from './workspace-sharing.client';

const mockedRequest = vi.mocked(backendRequest);

const member = {
  principalId: 'p-bob',
  login: 'bob',
  displayName: 'Bob',
  avatarUrl: 'https://avatars.githubusercontent.com/u/2',
  role: 'collaborator' as const,
  addedAt: '2026-09-14T00:00:00Z',
};

const invite = {
  id: 'inv-1',
  workspaceId: 'ws-1',
  createdByPrincipalId: 'p-alice',
  pinLogin: 'bob',
  pinGithubUserId: 2,
  createdAt: '2026-09-14T00:00:00Z',
  expiresAt: '2026-09-21T00:00:00Z',
};

describe('workspaceSharingClient wire contract (fake transport)', () => {
  afterEach(() => vi.clearAllMocks());

  it('listMembers forwards workspace.members.list and returns the rows with the guest cap', async () => {
    mockedRequest.mockResolvedValueOnce({ members: [member], guestCount: 2, guestLimit: 5 });
    await expect(workspaceSharingClient.listMembers('ws-1')).resolves.toEqual({
      members: [member],
      guestCount: 2,
      guestLimit: 5,
    });
    expect(mockedRequest).toHaveBeenCalledWith('workspace.members.list', { workspaceId: 'ws-1' });
  });

  // Older daemons omit the cap fields; the client reports them as unknown
  // (null) rather than inventing a limit.
  it('listMembers reports the guest cap as null when the daemon omits it', async () => {
    mockedRequest.mockResolvedValueOnce({ members: [member] });
    await expect(workspaceSharingClient.listMembers('ws-1')).resolves.toEqual({
      members: [member],
      guestCount: null,
      guestLimit: null,
    });
  });

  it('removeMember sends { workspaceId, principalId } and folds errors', async () => {
    mockedRequest.mockResolvedValueOnce({ removed: true });
    await expect(workspaceSharingClient.removeMember('ws-1', 'p-bob')).resolves.toEqual({
      success: true,
    });
    expect(mockedRequest).toHaveBeenCalledWith('workspace.members.remove', {
      workspaceId: 'ws-1',
      principalId: 'p-bob',
    });

    mockedRequest.mockRejectedValueOnce(new Error('socket closed'));
    await expect(workspaceSharingClient.removeMember('ws-1', 'p-bob')).resolves.toEqual({
      success: false,
      code: 'unknown',
    });
  });

  // Regression (fe#2440 review P1): the daemon's -32003 capability refusal is
  // classified so callers can withhold the owner controls instead of retrying.
  it('folds the -32003 capability refusal into the forbidden code', async () => {
    mockedRequest.mockRejectedValueOnce(
      new BackendError({ code: 'forbidden', message: 'not the owner', rpcCode: -32003 }),
    );
    await expect(workspaceSharingClient.revokeInvite('ws-1', 'inv-1')).resolves.toEqual({
      success: false,
      code: 'forbidden',
      rpcCode: -32003,
    });
  });

  // Regression (fe#2440 review P1): the failure never carries the raw message —
  // a daemon/transport string may echo invite material into a log or trace.
  it('never carries the raw error message or data in a failure', async () => {
    mockedRequest.mockRejectedValueOnce(
      new BackendError({
        code: 'internal',
        message: 'failed for intent://invite?t=SECRET-TOKEN',
        rpcCode: -32603,
        data: { detail: 'SECRET-TOKEN' },
      }),
    );
    const outcome = await workspaceSharingClient.createInvite('ws-1');
    expect(outcome).toEqual({ success: false, code: 'unknown', rpcCode: -32603 });
    expect(JSON.stringify(outcome)).not.toContain('SECRET');
  });

  it('createInvite omits pinLogin when blank and trims it when supplied', async () => {
    const created = {
      invite,
      secret: 's3cret',
      url: 'intent://invite?v=1',
      hosts: [],
      port: 1,
      fingerprint: 'fp',
      version: 1,
    };
    mockedRequest.mockResolvedValueOnce(created);
    await expect(workspaceSharingClient.createInvite('ws-1', { pinLogin: '  ' })).resolves.toEqual({
      success: true,
      result: created,
    });
    expect(mockedRequest).toHaveBeenLastCalledWith('workspace.invite.create', {
      workspaceId: 'ws-1',
    });

    mockedRequest.mockResolvedValueOnce(created);
    await workspaceSharingClient.createInvite('ws-1', { pinLogin: ' bob ' });
    expect(mockedRequest).toHaveBeenLastCalledWith('workspace.invite.create', {
      workspaceId: 'ws-1',
      pinLogin: 'bob',
    });
  });

  it('createInvite surfaces the machine-readable invite error code', async () => {
    mockedRequest.mockRejectedValueOnce(
      new BackendError({
        code: 'invalid-params',
        message: 'unknown GitHub login',
        rpcCode: -32602,
        data: { code: 'invite-pin-unknown' },
      }),
    );
    await expect(
      workspaceSharingClient.createInvite('ws-1', { pinLogin: 'nobody' }),
    ).resolves.toEqual({
      success: false,
      code: 'invite-pin-unknown',
      rpcCode: -32602,
    });
  });

  // Remote access off: the daemon's `Error::ListenerDown` (-32603) carries
  // `data.code = 'listener-down'`, which is not an invite code but must still
  // reach the saga as a bounded, actionable failure class.
  it('createInvite surfaces the listener-down code without widening the invite codes', async () => {
    mockedRequest.mockRejectedValueOnce(
      new BackendError({
        code: 'internal',
        message: 'invite listener is down',
        rpcCode: -32603,
        data: { code: 'listener-down' },
      }),
    );
    await expect(workspaceSharingClient.createInvite('ws-1')).resolves.toEqual({
      success: false,
      code: 'listener-down',
      rpcCode: -32603,
    });
    expect(inviteErrorCode({ data: { code: 'listener-down' } })).toBeUndefined();
  });

  // Guest cap reached (intent-hq/intentd#1917): `workspace.invite.create`
  // rejects with `data.code = 'guest-limit'`, which is an invite code.
  it('createInvite surfaces the guest-limit code when the workspace is at capacity', async () => {
    mockedRequest.mockRejectedValueOnce(
      new BackendError({
        code: 'invalid-params',
        message: 'guest limit reached',
        rpcCode: -32602,
        data: { code: 'guest-limit' },
      }),
    );
    await expect(workspaceSharingClient.createInvite('ws-1')).resolves.toEqual({
      success: false,
      code: 'guest-limit',
      rpcCode: -32602,
    });
    expect(inviteErrorCode({ data: { code: 'guest-limit' } })).toBe('guest-limit');
  });

  it('listInvites forwards workspace.invite.list and returns the rows verbatim', async () => {
    mockedRequest.mockResolvedValueOnce({ invites: [invite] });
    await expect(workspaceSharingClient.listInvites('ws-1')).resolves.toEqual([invite]);
    expect(mockedRequest).toHaveBeenCalledWith('workspace.invite.list', { workspaceId: 'ws-1' });
  });

  it('revokeInvite sends { workspaceId, inviteId }', async () => {
    mockedRequest.mockResolvedValueOnce({ revoked: true });
    await expect(workspaceSharingClient.revokeInvite('ws-1', 'inv-1')).resolves.toEqual({
      success: true,
    });
    expect(mockedRequest).toHaveBeenCalledWith('workspace.invite.revoke', {
      workspaceId: 'ws-1',
      inviteId: 'inv-1',
    });
  });

  it('inviteErrorCode reads only allowlisted string data.code values', () => {
    expect(inviteErrorCode(new Error('plain'))).toBeUndefined();
    expect(inviteErrorCode({ data: 'detail string' })).toBeUndefined();
    expect(inviteErrorCode({ data: { code: 'invite-expired' } })).toBe('invite-expired');
    expect(inviteErrorCode({ data: { code: 'not-a-daemon-code' } })).toBeUndefined();
  });

  // Regression (fe#2440 verifier, 6138cb4 round): an arbitrary `data.code`
  // string on a daemon rejection is not an invite code — it must never leave
  // the client on `ShareFailure.code` (the saga logs that field).
  it('folds an arbitrary data.code on a rejection to the bounded unknown code', async () => {
    const marker = `leak-${Math.random().toString(36).slice(2)}`;
    for (const run of [
      () => workspaceSharingClient.createInvite('ws-1'),
      () => workspaceSharingClient.revokeInvite('ws-1', 'inv-1'),
      () => workspaceSharingClient.removeMember('ws-1', 'p-bob'),
    ]) {
      mockedRequest.mockRejectedValueOnce({ rpcCode: -32000, data: { code: marker } });
      const outcome = await run();
      expect(outcome).toEqual({ success: false, code: 'unknown', rpcCode: -32000 });
      expect(JSON.stringify(outcome)).not.toContain(marker);
    }
  });
});
