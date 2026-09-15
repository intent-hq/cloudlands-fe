/**
 * The connection's own principal id, read once from `principal.me` and cached
 * for the process (a renderer talks to one daemon as one principal). Presence
 * rows are stamped by the daemon, so this is the only way a client can tell
 * its own viewer row from a peer's. Resolves `undefined` when the daemon
 * predates principals (no id in the reply); a failed read REJECTS and is not
 * cached, so the caller can tell "no identity" from "not yet known" and retry.
 */
import { backendRequest } from '$lib/client/live/backend-transport';

let ownPrincipalIdPromise: Promise<string | undefined> | null = null;

export function resolveOwnPrincipalId(): Promise<string | undefined> {
  if (!ownPrincipalIdPromise) {
    const attempt = backendRequest<{ id?: unknown }>('principal.me', {}).then((result) =>
      typeof result?.id === 'string' ? result.id : undefined,
    );
    attempt.catch(() => {
      if (ownPrincipalIdPromise === attempt) ownPrincipalIdPromise = null;
    });
    ownPrincipalIdPromise = attempt;
  }
  return ownPrincipalIdPromise;
}

/** Test seam: forget the cached identity. */
export function resetOwnPrincipalIdForTests(): void {
  ownPrincipalIdPromise = null;
}
