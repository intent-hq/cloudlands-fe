import type { PrincipalIdentity } from '$features/workspace-sharing/types';

export interface HostMember {
  principalId: string;
  hostRole: 'owner' | 'member';
  login: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  identity?: PrincipalIdentity;
  addedAt: string;
}

export interface HostInvite {
  id: string;
  scope: 'host';
  role: 'member';
  createdByPrincipalId: string;
  pinLogin: string;
  pinIdentity: PrincipalIdentity;
  pinGithubUserId?: number;
  reusable: false;
  redemptionCount: number;
  createdAt: string;
  expiresAt: string;
}

export interface HostInviteInput {
  pinLogin: string;
  pinProvider: 'github' | 'gitlab';
  pinHost?: string;
}

export type HostInviteRow = HostInvite & { url?: string };
