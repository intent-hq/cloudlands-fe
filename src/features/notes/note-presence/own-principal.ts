/**
 * The connection's own principal id, read once from `principal.me` and cached
 * for the process (a renderer talks to one daemon as one principal). Presence
 * rows are stamped by the daemon, so this is the only way a client can tell
 * its own viewer row from a peer's. Resolves `undefined` when the daemon
 * predates principals or the read fails; a failed read is not cached so the
 * next caller retries.
 */
import { backendRequest } from '$lib/client/live/backend-transport';

let ownPrincipalIdPromise: Promise<string | undefined> | null = null;

export function resolveOwnPrincipalId(): Promise<string | undefined> {
  if (!ownPrincipalIdPromise) {
    ownPrincipalIdPromise = backendRequest<{ id?: unknown }>('principal.me', {})
      .then((result) => (typeof result?.id === 'string' ? result.id : undefined))
      .catch(() => {
        ownPrincipalIdPromise = null;
        return undefined;
      });
  }
  return ownPrincipalIdPromise;
}

/** Test seam: forget the cached identity. */
export function resetOwnPrincipalIdForTests(): void {
  ownPrincipalIdPromise = null;
}
