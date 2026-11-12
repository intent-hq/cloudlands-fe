import type { BackendConnectionConfig } from './backend-connection';

export interface BackendDialRecord {
  id: string;
  host: string;
  hosts: string[];
  port: number;
  fingerprint: string;
  tcAddress: string | null;
  getToken: () => Promise<string | null>;
  /** Saved through local code pairing: loopback only, a 401 is transient. */
  localPairing?: boolean;
  invitedIdentity?: { principalId: string; pairedAt: number };
}

export class ConnectionSecretUnavailableError extends Error {
  constructor() {
    // i18n-ignore (internal error)
    super('Connection secret unavailable');
    this.name = 'ConnectionSecretUnavailableError';
  }
}

/** Convert a resolved owner or guest record into its transport configuration. */
export async function buildConfigForRecord(
  record: BackendDialRecord,
  tokenOverride?: string,
): Promise<{
  config: BackendConnectionConfig;
  invitedCredential?: { principalId: string; pairedAt: number; token: string };
  meta: { id: string; host: string; port: number };
}> {
  const { id } = record;
  let token: string | null | undefined = tokenOverride;
  if (token === undefined) {
    try {
      token = await record.getToken();
    } catch {
      throw new ConnectionSecretUnavailableError();
    }
  }
  if (!token) {
    throw new Error(`No stored token for connection: ${id}`);
  }
  // The store's list() already sanitizes `hosts` (a legacy loopback primary
  // is excluded whenever a routable candidate exists), so the race dials
  // hosts[0] first — not the raw stored primary, which can be loopback on
  // records synced from before self-publish filtered it out.
  const dialHosts = record.hosts;
  return {
    config: {
      transport: 'wss',
      host: dialHosts[0],
      hosts: dialHosts,
      port: record.port,
      token,
      fingerprint: record.fingerprint,
      // A local pairing credential is admitted only from loopback, never
      // through the other Intent's tunnel (protocol §5.58).
      tcAddress: record.localPairing ? undefined : (record.tcAddress ?? undefined),
      ...(record.localPairing ? { localPairingCredential: true } : {}),
    },
    ...(record.invitedIdentity ? { invitedCredential: { ...record.invitedIdentity, token } } : {}),
    meta: { id, host: record.host, port: record.port },
  };
}
