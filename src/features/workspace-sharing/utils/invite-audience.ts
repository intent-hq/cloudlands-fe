import type { IdentityProvider, WorkspaceInvite } from '../types';

export interface InviteAudience {
  workspaceId: string;
  login: string;
  provider: IdentityProvider;
  host: string;
  externalUserId?: string;
}

/** Reuse only an active, locally resolvable link for precisely this audience. */
export function findCopyableInvite(
  invites: readonly WorkspaceInvite[],
  links: Readonly<Record<string, string>>,
  audience: InviteAudience,
  now = Date.now(),
): WorkspaceInvite | undefined {
  return invites.find((invite) => {
    if (
      invite.workspaceId !== audience.workspaceId ||
      !links[invite.id] ||
      invite.revokedAt ||
      !(Date.parse(invite.expiresAt) > now) ||
      (invite.reusable !== true && invite.redeemedAt)
    )
      return false;
    if (!audience.login) return !invite.pinLogin && !invite.pinIdentity && !invite.pinGithubUserId;
    if (invite.pinLogin?.toLowerCase() !== audience.login.toLowerCase()) return false;
    if (
      audience.externalUserId &&
      audience.externalUserId !==
        String(invite.pinIdentity?.externalUserId ?? invite.pinGithubUserId)
    )
      return false;
    if (!invite.pinIdentity) return audience.provider === 'github' && !!invite.pinGithubUserId;
    return (
      invite.pinIdentity.provider === audience.provider &&
      invite.pinIdentity.host.toLowerCase() === audience.host.toLowerCase()
    );
  });
}
