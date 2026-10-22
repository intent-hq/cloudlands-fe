import type { HostInvite, HostMember } from './types';

export type InstanceUserRow =
  | { kind: 'member'; key: string; member: HostMember; online: boolean | undefined }
  | { kind: 'invite'; key: string; invite: HostInvite };

/** Presentation never joins by login, profile or forge; commands retain their exact IDs. */
export function instanceUserRows(
  members: HostMember[],
  invites: HostInvite[],
  onlinePrincipalIds: readonly string[] | null,
): InstanceUserRow[] {
  const online = onlinePrincipalIds === null ? null : new Set(onlinePrincipalIds);
  return [
    ...members.map((member) => ({
      kind: 'member' as const,
      key: `member:${member.principalId}`,
      member,
      online: online?.has(member.principalId),
    })),
    ...invites.map((invite) => ({ kind: 'invite' as const, key: `invite:${invite.id}`, invite })),
  ];
}
