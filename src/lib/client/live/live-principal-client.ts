import { parsePrincipalSnapshot, type PrincipalSnapshot } from '$shared/types/principal';
import { readBackendPrincipal } from './backend-transport';
import { isDaemonErrorResponse } from './backend-transport-types';

export class IncompatiblePrincipalResponse extends Error {}

/** Only transport failures are retried; protocol and authentication refusals stay closed. */
export function isRetryablePrincipalError(error: unknown): boolean {
  if (error instanceof IncompatiblePrincipalResponse || isDaemonErrorResponse(error)) return false;
  if (!error || typeof error !== 'object') return false;
  if ('code' in error)
    return ['TIMEOUT', 'TRANSPORT_ERROR', 'UNAVAILABLE'].includes(String(error.code));
  // IPC can reject with a plain Error before a structured transport response exists.
  return error instanceof Error;
}

/** Refresh only the principal; the transport supplies its existing acknowledged hello. */
export async function readConnectedPrincipal(): Promise<PrincipalSnapshot> {
  const { hello, principal } = await readBackendPrincipal();
  const snapshot = parsePrincipalSnapshot(hello, principal);
  if (!snapshot)
    throw new IncompatiblePrincipalResponse('Incompatible principal discovery response');
  return snapshot;
}
