import type { PrincipalIdentity } from '../workspace-sharing/types';
import type { IdentityTarget } from './types';

export function validIdentityTarget(value: IdentityTarget): boolean {
  if (value.provider === 'github') return value.host === 'github.com';
  if (value.provider !== 'gitlab' || !value.host) return false;
  try {
    const url = new URL(`https://${value.host}`);
    return (
      url.host === value.host &&
      url.pathname === '/' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function isCollaborationIdentity(value: unknown): value is PrincipalIdentity {
  if (!value || typeof value !== 'object') return false;
  const identity = value as PrincipalIdentity;
  return (
    validIdentityTarget(identity) &&
    typeof identity.externalUserId === 'string' &&
    identity.externalUserId.length > 0
  );
}

export function identitiesEqual(a: PrincipalIdentity, b: PrincipalIdentity): boolean {
  return a.provider === b.provider && a.host === b.host && a.externalUserId === b.externalUserId;
}

/** GitHub explicitly omits host; GitLab always uses this choice, never repo settings. */
export function identityParams(target: IdentityTarget): {
  provider: 'github' | 'gitlab';
  host?: string;
} {
  return target.provider === 'github'
    ? { provider: 'github' }
    : { provider: 'gitlab', host: target.host };
}
