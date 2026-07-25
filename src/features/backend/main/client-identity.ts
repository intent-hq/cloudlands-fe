/**
 * Stable §5.17 client identity for the desktop app.
 *
 * The daemon keys client-scoped state (`drafts.*`, §5.16) by the `clientId`
 * presented on `client.hello`. Without a persisted identity, every app
 * restart or renderer reload minted a fresh daemon-side id and orphaned the
 * previous identity's state (the New Workspace draft-loss bug). This module
 * mints a UUID once per install, persists it in the FE-local prefs file
 * (`local-prefs.json` under userData — FE-only per §5.12), and hands it to
 * the shared main-process JsonRpcClient to present on every (re)connect.
 */

import { randomUUID } from 'crypto';
import { getLocalPref, setLocalPref } from '../../../main/local-prefs';

/** local-prefs key holding the persisted §5.17 clientId. */
const PREF_KEY = 'backendClientId';

/** In-flight/settled resolution so concurrent callers share one mint. */
let cached: Promise<string> | null = null;

/**
 * Return the persisted clientId, minting and persisting a fresh UUID on
 * first use. Concurrent callers share a single resolution so two racing
 * connects can never mint two identities.
 */
export function getOrCreateClientId(): Promise<string> {
  if (!cached) {
    cached = (async () => {
      const existing = await getLocalPref<string>(PREF_KEY);
      if (typeof existing === 'string' && existing.length > 0) return existing;
      const minted = randomUUID();
      await setLocalPref(PREF_KEY, minted);
      return minted;
    })();
    // A failed read/mint must not poison every future connect with a
    // rejected cache entry.
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}

/**
 * Persist a daemon-returned clientId (the daemon mints one when the client
 * presented none, §5.17) so it is re-presented on every later hello.
 *
 * The in-memory cache is updated regardless of whether the disk write
 * succeeds (`setLocalPref` logs-and-swallows failures): this session must
 * keep presenting the id the daemon just confirmed. If the write did fail,
 * the only consequence is that the NEXT launch re-runs first-run minting —
 * a degraded-but-safe outcome; connects are never blocked on prefs I/O.
 */
export async function persistClientId(clientId: string): Promise<void> {
  cached = Promise.resolve(clientId);
  await setLocalPref(PREF_KEY, clientId);
}
