import { backendRequest } from '$lib/client/live/backend-transport';
import { parsePrincipalSnapshot, type PrincipalSnapshot } from '$shared/types/principal';
import { parsePairingUri } from '$shared/utils/pairing-uri';

/** Keep the server's existing URI bytes: QR and clipboard must enroll the same person. */
export async function readSelfPairing(expected: PrincipalSnapshot['principal']): Promise<string> {
  const value = await backendRequest<unknown>('pairing.getSelfInfo');
  if (!value || typeof value !== 'object') throw new Error('Invalid personal pairing response');
  const reply = value as Record<string, unknown>;
  const snapshot = parsePrincipalSnapshot(
    { server: { capabilities: { hostMembership: 1 } } },
    reply.principal,
  );
  const uri = typeof reply.uri === 'string' ? parsePairingUri(reply.uri) : null;
  if (
    reply.version !== 1 ||
    !snapshot ||
    !uri ||
    snapshot.principal.id !== expected.id ||
    snapshot.principal.hostRole !== expected.hostRole ||
    snapshot.principal.hostMembershipRevision !== expected.hostMembershipRevision ||
    !uri.token ||
    uri.token !== reply.token ||
    !uri.fingerprint ||
    uri.fingerprint !== reply.fingerprint ||
    !uri.port ||
    uri.port !== reply.port ||
    !Array.isArray(reply.hosts) ||
    JSON.stringify(uri.hosts) !== JSON.stringify(reply.hosts) ||
    uri.tcAddress !== (reply.tcAddress ?? null) ||
    (!uri.hosts.length && !uri.tcAddress)
  )
    throw new Error('Invalid personal pairing response');
  return reply.uri as string;
}
