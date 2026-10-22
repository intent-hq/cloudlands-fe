import { backendRequest } from '$lib/client/live/backend-transport';
import type { HostInviteInput, HostInviteRow, HostMember } from './types';

/** All requests use the selected connection; there is no local administrator fallback. */
export const hostMembershipClient = {
  listMembers: () =>
    backendRequest<{ members: HostMember[]; revision: number }>('host.members.list', {}),
  listInvites: () => backendRequest<{ invites: HostInviteRow[] }>('host.invite.list', {}),
  createInvite: (input: HostInviteInput) =>
    backendRequest<{
      invite: HostInviteRow;
      secret: string;
      url: string;
      hosts: string[];
      port: number;
      fingerprint: string;
      version: 1;
      tcAddress: string;
    }>('host.invite.create', input),
  removeMember: (principalId: string) =>
    backendRequest<{ removed: boolean }>('host.members.remove', { principalId }),
  revokeInvite: (inviteId: string) =>
    backendRequest<{ revoked: boolean }>('host.invite.revoke', { inviteId }),
};
