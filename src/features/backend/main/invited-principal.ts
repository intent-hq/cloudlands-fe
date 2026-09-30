import { parsePrincipalSnapshot, type PrincipalSnapshot } from '../../../shared/types/principal';
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
    const hello = await client.request('client.hello');
    const principal = await client.request('principal.me');
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
