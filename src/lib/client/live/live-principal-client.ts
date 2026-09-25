import { parsePrincipalSnapshot, type PrincipalSnapshot } from '$shared/types/principal';
import { backendRequest } from './backend-transport';

export class IncompatiblePrincipalResponse extends Error {}

/** No process cache: both reads must belong to the window's current connection. */
export async function readConnectedPrincipal(): Promise<PrincipalSnapshot> {
  const [hello, principal] = await Promise.allSettled([
    backendRequest<unknown>('client.hello', {}),
    backendRequest<unknown>('principal.me', {}),
  ]);
  if (hello.status === 'rejected') throw hello.reason;
  if (principal.status === 'rejected') throw principal.reason;
  const snapshot = parsePrincipalSnapshot(hello.value, principal.value);
  if (!snapshot)
    throw new IncompatiblePrincipalResponse('Incompatible principal discovery response');
  return snapshot;
}
