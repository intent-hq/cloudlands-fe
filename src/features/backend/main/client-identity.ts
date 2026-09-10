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
import { hostname as osHostname } from 'node:os';
import { getLocalPref, setLocalPref } from '../../../main/local-prefs';
import { isDetectedDeviceKind, type DetectedDeviceKind } from '../../../shared/types/connections';

/** local-prefs key holding the persisted §5.17 clientId. */
const PREF_KEY = 'backendClientId';

/**
 * Wire name of the desktop app on `client.hello` (REV-2, §5.17). The host
 * identification travels in the separate `hostname` / `prettyHostname` /
 * `deviceKind` fields, so the name itself stays a plain product label.
 */
export const DESKTOP_CLIENT_NAME = 'Intent Desktop'; // i18n-ignore (wire client identity)

/**
 * The desktop app's own host identification, mirroring the daemon's
 * `host.status` triple. `hostname` is the OS hostname; `prettyHostname` /
 * `deviceKind` are learned from the LOCAL daemon's `host.status` (the same
 * source the FE already uses for server identification) and are absent
 * until that capture lands.
 */
export interface ClientHostIdentity {
  hostname: string;
  prettyHostname?: string;
  deviceKind?: DetectedDeviceKind;
}

/**
 * Identity fields the main pooled client presents on `client.hello`: the
 * stable `clientId` plus the REV-2 additions — `name`, the host triple, and
 * `capabilities.browserExec`, which makes this connection an eligible target
 * for agent-initiated `browser.exec` reverse RPCs.
 */
export interface MainClientHelloParams extends ClientHostIdentity {
  clientId: string;
  name: string;
  capabilities: { browserExec: true };
}

let localHostIdentity: Pick<ClientHostIdentity, 'prettyHostname' | 'deviceKind'> = {};

/**
 * Record the local daemon's view of this machine (`host.status` →
 * `prettyHostname` / `deviceKind`). Returns `true` when either value changed,
 * so the caller can re-hello and let the daemon refresh its client row.
 */
export function setLocalHostIdentity(result: unknown): boolean {
  const obj = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  const pretty =
    typeof obj.prettyHostname === 'string' && obj.prettyHostname.trim() !== ''
      ? obj.prettyHostname.trim()
      : undefined;
  const kind = isDetectedDeviceKind(obj.deviceKind) ? obj.deviceKind : undefined;
  const changed =
    pretty !== localHostIdentity.prettyHostname || kind !== localHostIdentity.deviceKind;
  localHostIdentity = {
    ...(pretty === undefined ? {} : { prettyHostname: pretty }),
    ...(kind === undefined ? {} : { deviceKind: kind }),
  };
  return changed;
}

/** This app's host identification as presented on `client.hello`. */
export function getClientHostIdentity(): ClientHostIdentity {
  return { hostname: osHostname(), ...localHostIdentity };
}

/**
 * Build the main pooled client's `client.hello` params (REV-2). Auxiliary
 * clients (setup session, transfer relay, quit confirmation) present only the
 * `clientId` — they must never advertise `browserExec`, since the capability
 * marks exactly the connection that serves the `browser.exec` reverse handler.
 */
export async function buildMainClientHelloParams(): Promise<MainClientHelloParams> {
  return {
    clientId: await getOrCreateClientId(),
    name: DESKTOP_CLIENT_NAME,
    capabilities: { browserExec: true },
    ...getClientHostIdentity(),
  };
}

/** Test-only: drop the cached local host identity. */
export function __resetLocalHostIdentityForTesting(): void {
  localHostIdentity = {};
}

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
