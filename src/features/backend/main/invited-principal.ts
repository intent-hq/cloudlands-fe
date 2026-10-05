import { app } from 'electron';
import { compareToPinnedVersion } from '../../../shared/intentd-version-compare';
import { readPinnedVersion } from './intentd-version-pin';
import { protocolVersionAtLeast } from './protocol-compat';
import { parsePrincipalSnapshot, type PrincipalSnapshot } from '../../../shared/types/principal';
import { m } from '../../../shared/paraglide/messages.js';
import { JsonRpcError } from './json-rpc-errors';
import { canonicalFingerprint } from './invited-session-key';
import { JsonRpcClient } from './json-rpc-client';
import type { InvitedCandidate, VerifiedInvitedIdentity } from './invited-session-sync';

/** Only the pinned, bearer-authenticated remote daemon may classify a personal credential. */
export async function inspectPersonalCredential(
  candidate: InvitedCandidate,
): Promise<PrincipalSnapshot> {
  const fingerprint = canonicalFingerprint(candidate.fingerprint);
  if (
    !candidate.token ||
    !Number.isInteger(candidate.port) ||
    candidate.port < 1 ||
    candidate.port > 65535
  ) {
    throw new Error('Invalid personal credential envelope');
  }
  const hosts = candidate.hosts.length ? candidate.hosts : [candidate.host];
  const client = new JsonRpcClient({
    config: {
      transport: 'wss',
      host: hosts[0],
      hosts,
      port: candidate.port,
      fingerprint,
      token: candidate.token,
      tcAddress: candidate.tcAddress ?? undefined,
    },
  });
  // A one-shot validation never starts a background reconnect loop after its result settles.
  client.on('error', () => {});
  try {
    const hello = await requestIdentity(client, 'client.hello');
    assertIdentityProtocol(hello);
    const principal = await requestIdentity(client, 'principal.me', hello);
    const snapshot = parsePrincipalSnapshot(hello, principal);
    if (
      !snapshot ||
      (candidate.principalId !== undefined && snapshot.principal.id !== candidate.principalId)
    ) {
      throw new Error('Personal credential identity unavailable');
    }
    return snapshot;
  } finally {
    client.dispose();
  }
}

function helloServer(hello: unknown): Record<string, unknown> {
  if (!hello || typeof hello !== 'object' || !('server' in hello)) return {};
  const server = hello.server;
  return server && typeof server === 'object' && !Array.isArray(server)
    ? (server as Record<string, unknown>)
    : {};
}

/** Safe, localized diagnostics: never relay arbitrary server text or credential fields. */
export class BackendCompatibilityError extends JsonRpcError {
  constructor(method: 'client.hello' | 'principal.me', hello?: unknown, rpcError?: JsonRpcError) {
    const version = helloServer(hello).version;
    const backendVersion =
      typeof version === 'string' &&
      version.length <= 128 &&
      compareToPinnedVersion(version, version) === 'equal'
        ? version
        : null;
    const bundledVersion = readPinnedVersion({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
    });
    super({
      code: rpcError?.rpcCode ?? -32000,
      message: m.modals_connect_identityMethodUnavailable_error({
        method,
        backendVersion: backendVersion ?? m.modals_connect_unknownVersion_label(),
        bundledVersion: bundledVersion ?? m.modals_connect_unknownVersion_label(),
      }),
      data: rpcError?.data ?? { code: 'BACKEND_INCOMPATIBLE' },
    });
    this.name = 'BackendCompatibilityError';
  }
}

function assertIdentityProtocol(hello: unknown): void {
  const server = helloServer(hello);
  const capabilities = server.capabilities as Record<string, unknown> | undefined;
  if (capabilities?.collaborationIdentity === 1 || capabilities?.hostMembership === 1) return;
  const protocol = server.protocolVersion;
  // protocol-version-ok: protocols below 10.3 predate principal.me (intentd#1868).
  // Some builds on that boundary also lack it, so the actual RPC remains required.
  // Older identity-aware daemons need not advertise the newer hostMembership capability.
  // Unknown metadata is not authority: the required principal.me call below must still succeed.
  if (
    typeof protocol === 'string' &&
    /^\d+(?:\.\d+)*$/.test(protocol.trim()) &&
    !protocolVersionAtLeast(protocol, 10, 3)
  ) {
    throw new BackendCompatibilityError('principal.me', hello);
  }
}

/** Missing identity RPCs cannot establish authority, even after a successful TLS upgrade. */
async function requestIdentity(
  client: JsonRpcClient,
  method: 'client.hello' | 'principal.me',
  hello?: unknown,
) {
  try {
    return await client.request(method);
  } catch (error) {
    if (error instanceof JsonRpcError && error.rpcCode === -32601) {
      throw new BackendCompatibilityError(method, hello, error);
    }
    throw error;
  }
}

export function invitedRole(snapshot: PrincipalSnapshot): 'guest' | 'member' | null {
  if (snapshot.principal.isAdministrator) return null;
  if (snapshot.capabilities.hostMembership) {
    return snapshot.principal.hostRole === 'guest' || snapshot.principal.hostRole === 'member'
      ? snapshot.principal.hostRole
      : null;
  }
  // Legacy principal.me still provides a truthful isAdministrator boolean; never infer member.
  return 'guest';
}

export async function authenticateInvitedCredential(
  candidate: InvitedCandidate,
): Promise<VerifiedInvitedIdentity | null> {
  const snapshot = await inspectPersonalCredential(candidate);
  return invitedRole(snapshot)
    ? { principalId: snapshot.principal.id, login: snapshot.principal.login }
    : null;
}
