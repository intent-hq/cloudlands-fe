/** Raw discovery reads from one acknowledged connection, before wire validation. */
export interface PrincipalDiscovery {
  hello: unknown;
  principal: unknown;
}

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
  gitlabCheckout?: boolean;
  submissionCorrelation?: 1;
  /** `workspace.findByPullRequest` support (PROTOCOL §5.1). */
  prWorkspaceLookup?: 1;
  /** `Workspace.label` + clearable `workspace.update` `label` (PROTOCOL §5.1). */
  workspaceLabels?: 1;
  /** Agent secret requests: secret-request cards and `secret.*` (PROTOCOL §5.56). */
  secretRequests?: 1;
  /** `Workspace.autoArchiveDisabled` + `workspace.update` toggle (PROTOCOL §5.1). */
  workspaceAutoArchiveOptOut?: 1;
  invitationAccountSearch?: boolean;
  workspaceGuestRoles?: boolean;
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
    gitlabCheckout: bag.gitlabCheckout === 1,
    ...(bag.submissionCorrelation === 1 ? { submissionCorrelation: 1 as const } : {}),
    ...(bag.prWorkspaceLookup === 1 ? { prWorkspaceLookup: 1 as const } : {}),
    ...(bag.workspaceLabels === 1 ? { workspaceLabels: 1 as const } : {}),
    ...(bag.secretRequests === 1 ? { secretRequests: 1 as const } : {}),
    ...(bag.workspaceAutoArchiveOptOut === 1 ? { workspaceAutoArchiveOptOut: 1 as const } : {}),
    invitationAccountSearch: bag.invitationAccountSearch === 1,
    workspaceGuestRoles: bag.workspaceGuestRoles === 1,
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
