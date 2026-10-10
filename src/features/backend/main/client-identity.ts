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

import { createHmac, randomBytes, randomUUID } from 'crypto';
import type { BackendConnectionConfig } from './backend-connection';
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
  capabilities: { browserExec: true; desktopControl?: 1 };
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
export async function buildMainClientHelloParams(
  config?: BackendConnectionConfig,
): Promise<MainClientHelloParams> {
  const { desktopNativeAvailable } = await import('../../desktop/main/desktop-native');
  return {
    clientId: await getOrCreateClientId(config),
    name: DESKTOP_CLIENT_NAME,
    capabilities: {
      browserExec: true,
      ...(desktopNativeAvailable() ? { desktopControl: 1 as const } : {}),
    },
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
function getInstallClientId(): Promise<string> {
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
 * Canonical IDs are hints for one authenticated transport context, never routing
 * authority. Keep the legacy install seed opaque: it may already be scoped and
 * cannot safely be split or migrated to another principal's state.
 */
const CONTEXT_PREF_KEY = 'backendClientIdentitiesV1';
interface ContextIdentities {
  key: string;
  canonicalIds: Record<string, string>;
}
let contexts: Promise<ContextIdentities> | undefined;

function getContexts(): Promise<ContextIdentities> {
  return (contexts ??= (async () => {
    const saved = await getLocalPref<ContextIdentities>(CONTEXT_PREF_KEY);
    if (
      saved &&
      typeof saved.key === 'string' &&
      /^[a-f0-9]{64}$/.test(saved.key) &&
      saved.canonicalIds &&
      typeof saved.canonicalIds === 'object' &&
      !Array.isArray(saved.canonicalIds)
    ) {
      return {
        key: saved.key,
        canonicalIds: Object.fromEntries(
          Object.entries(saved.canonicalIds).filter(
            ([key, id]) => /^[a-f0-9]{64}$/.test(key) && typeof id === 'string' && id.length > 0,
          ),
        ),
      };
    }
    const initial = { key: randomBytes(32).toString('hex'), canonicalIds: {} };
    await setLocalPref(CONTEXT_PREF_KEY, initial);
    return initial;
  })());
}

/**
 * Bind to the endpoint AND credentials used by this connection, not its mutable
 * UI connection ID. WSS authenticates the certificate pin and bearer credential;
 * UDS uses the local OS/socket trust boundary. A changed endpoint, pin or token
 * conservatively starts from the install seed. Host-race candidates all use the
 * same pinned certificate/credential and therefore share the primary's context.
 * Only a keyed digest is stored: never persist tokens or credential-bearing URLs
 * here, log them, or parse an alleged principal out of a canonical client ID.
 */
function contextKey(config: BackendConnectionConfig, key: string): string {
  return createHmac('sha256', key)
    .update(
      JSON.stringify([
        config.transport,
        config.socketPath ?? null,
        config.host ?? null,
        config.port ?? null,
        config.wsUrl ?? null,
        config.tls ?? null,
        config.fingerprint?.replaceAll(':', '').toUpperCase() ?? null,
        config.token ?? null,
      ]),
    )
    .digest('hex');
}

/** Without a transport context, return only the unchanged install/legacy seed. */
export async function getOrCreateClientId(config?: BackendConnectionConfig): Promise<string> {
  if (config) {
    const capturedConfig = { ...config };
    const state = await getContexts();
    const canonical = state.canonicalIds[contextKey(capturedConfig, state.key)];
    if (canonical) return canonical;
  }
  return getInstallClientId();
}

/** Save an accepted hello only within its authenticated transport context. */
export async function persistClientId(
  clientId: string,
  config: BackendConnectionConfig,
): Promise<void> {
  const capturedConfig = { ...config };
  const state = await getContexts();
  state.canonicalIds[contextKey(capturedConfig, state.key)] = clientId;
  // Snapshot each write so concurrently completed hellos retain both entries.
  // local-prefs serializes disk writes; the session keeps its ID on I/O failure.
  await setLocalPref(CONTEXT_PREF_KEY, { key: state.key, canonicalIds: { ...state.canonicalIds } });
}
