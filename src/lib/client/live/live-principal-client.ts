import { parsePrincipalSnapshot, type PrincipalSnapshot } from '$shared/types/principal';
import { backendRequest } from './backend-transport';
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

/** No process cache: both reads must belong to the window's current connection. */
export async function readConnectedPrincipal(): Promise<PrincipalSnapshot> {
  const [hello, principal] = await Promise.allSettled([
    backendRequest<unknown>('client.hello', {}),
    backendRequest<unknown>('principal.me', {}),
  ]);
  // A refusal on either read wins over a concurrent timeout on the other.
  for (const result of [hello, principal]) {
    if (result.status === 'rejected' && !isRetryablePrincipalError(result.reason))
      throw result.reason;
  }
  if (hello.status === 'rejected') throw hello.reason;
  if (principal.status === 'rejected') throw principal.reason;
  const snapshot = parsePrincipalSnapshot(hello.value, principal.value);
  if (!snapshot)
    throw new IncompatiblePrincipalResponse('Incompatible principal discovery response');
  return snapshot;
}
