/** Connected caller and discovery contract (PROTOCOL §5.49). */
export type HostRole = 'owner' | 'member' | 'guest';

interface PrincipalMe {
  id: string;
  login: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  isAdministrator: boolean;
  identity?: { provider: 'github' | 'gitlab'; host: string; externalUserId: string };
  /** Absent on older daemons; never infer a member in that case. */
  hostRole?: HostRole;
  hostMembershipRevision?: number;
}

/** Individually supported server features, never the client's hello capability bag. */
interface HostCapabilities {
  hostMembership: boolean;
  collaborationIdentity: boolean;
  personalPairing: boolean;
  authenticatedDevices: boolean;
}

export interface PrincipalSnapshot {
  principal: PrincipalMe;
  capabilities: HostCapabilities;
}

export interface HostMembershipChange {
  revision: number;
  principalId: string;
  hostRole: 'member' | 'guest';
  action: 'added' | 'removed';
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const revision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

export function isHostMembershipChange(value: unknown): value is HostMembershipChange {
  return (
    record(value) &&
    revision(value.revision) &&
    nonempty(value.principalId) &&
    ((value.action === 'added' && value.hostRole === 'member') ||
      (value.action === 'removed' && value.hostRole === 'guest'))
  );
}

/** Validate required wire fields; an advertised contract cannot fall back to legacy authority. */
export function parsePrincipalSnapshot(hello: unknown, value: unknown): PrincipalSnapshot | null {
  if (!record(hello) || !record(hello.server) || !record(value)) return null;
  const bag = record(hello.server.capabilities) ? hello.server.capabilities : {};
  const capabilities: HostCapabilities = {
    hostMembership: bag.hostMembership === 1,
    collaborationIdentity: bag.collaborationIdentity === 1,
    personalPairing: bag.personalPairing === 1,
    authenticatedDevices: bag.authenticatedDevices === 1,
  };
  if (!nonempty(value.id) || typeof value.isAdministrator !== 'boolean') return null;
  for (const key of ['login', 'displayName', 'avatarUrl']) {
    if (value[key] !== null && typeof value[key] !== 'string') return null;
  }
  if (
    value.identity !== undefined &&
    (!record(value.identity) ||
      !['github', 'gitlab'].includes(value.identity.provider as string) ||
      !nonempty(value.identity.host) ||
      !nonempty(value.identity.externalUserId))
  )
    return null;
  if (
    capabilities.hostMembership &&
    (!['owner', 'member', 'guest'].includes(value.hostRole as string) ||
      !revision(value.hostMembershipRevision) ||
      value.isAdministrator !== (value.hostRole === 'owner'))
  )
    return null;
  return { principal: value as unknown as PrincipalMe, capabilities };
}
