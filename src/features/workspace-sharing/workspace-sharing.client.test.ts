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

  it('listMembers forwards workspace.members.list and returns the rows verbatim', async () => {
    mockedRequest.mockResolvedValueOnce({ members: [member] });
    await expect(workspaceSharingClient.listMembers('ws-1')).resolves.toEqual([member]);
    expect(mockedRequest).toHaveBeenCalledWith('workspace.members.list', { workspaceId: 'ws-1' });
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

    mockedRequest.mockRejectedValueOnce(new Error('forbidden'));
    await expect(workspaceSharingClient.removeMember('ws-1', 'p-bob')).resolves.toEqual({
      success: false,
      error: 'forbidden',
    });
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
      error: 'unknown GitHub login',
      code: 'invite-pin-unknown',
    });
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

  it('inviteErrorCode reads only string data.code values', () => {
    expect(inviteErrorCode(new Error('plain'))).toBeUndefined();
    expect(inviteErrorCode({ data: 'detail string' })).toBeUndefined();
    expect(inviteErrorCode({ data: { code: 'invite-expired' } })).toBe('invite-expired');
  });
});
