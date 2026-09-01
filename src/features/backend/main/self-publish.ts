/**
 * Self-publish helpers (main process): publishing THIS machine's own intentd
 * backend into the connections store (and thus, via keychain sync, the user's
 * iCloud Keychain backend registry).
 *
 * Dependency-light by design (local-prefs only): the IPC orchestration lives
 * in backend.ipc.ts; this module owns the pieces shared across the publish,
 * self-detection, and freshness flows:
 *  - parsing/validating the local daemon's `server.pairingInfo` result,
 *  - the persisted self cert fingerprint (canonical "this is me" identity used
 *    to recognize the published self entry),
 *  - the persistent "do not auto-publish" marker set when this machine's
 *    entry was forgotten elsewhere or unpublished locally (spec: the
 *    originator honors the tombstone and never re-asserts; re-publishing is
 *    explicit only).
 */

import { deleteLocalPref, getLocalPref, setLocalPref } from '../../../main/local-prefs';

/** local-prefs key persisting this machine's daemon cert fingerprint. */
const SELF_FINGERPRINT_KEY = 'selfBackendFingerprint';

/**
 * local-prefs key for the persistent "do not auto-publish" marker. Present
 * (true) after this machine's published entry was forgotten anywhere (the
 * tombstone matched our fingerprint) or unpublished locally; cleared by an
 * explicit re-publish. Absent = auto-publish offers are allowed.
 */
const SELF_PUBLISH_SUPPRESSED_KEY = 'selfPublishSuppressed';

/**
 * Validated `server.pairingInfo` fields the publish flow consumes (PROTOCOL
 * §5 method catalog): bearer token, cert fingerprint, bound WSS port (null
 * when the listener is down), local IPs, hostname(s) for the label, and the
 * tailcat tunnel's tc address (when the tunnel is up).
 */
export interface SelfPairingInfo {
  token: string;
  certFingerprint: string;
  /** Bound WSS port, or null when the TCP (WSS) listener is not running. */
  port: number | null;
  localIps: string[];
  hostname: string | null;
  prettyHostname: string | null;
  /**
   * The tailcat tunnel's tc address (PROTOCOL §12.3), or null when the wire
   * field is absent/empty — the daemon omits it whenever the tunnel sidecar
   * is not running, so null is a conclusive "no tunnel advertised".
   */
  tcAddress: string | null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Parse a `server.pairingInfo` result into the fields the publish flow needs,
 * or `null` when the shape is absent/malformed (missing token/fingerprint).
 * A missing/invalid `port` maps to `null` (WSS listener down), and `localIps`
 * keeps only non-empty strings.
 */
export function extractSelfPairingInfo(result: unknown): SelfPairingInfo | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  const token = typeof r.token === 'string' && r.token !== '' ? r.token : null;
  const certFingerprint = nonEmptyString(r.certFingerprint);
  if (!token || !certFingerprint) return null;
  const port = typeof r.port === 'number' && Number.isInteger(r.port) && r.port > 0 ? r.port : null;
  const localIps = Array.isArray(r.localIps)
    ? r.localIps.map((ip) => (typeof ip === 'string' ? ip.trim() : '')).filter((ip) => ip !== '')
    : [];
  return {
    token,
    certFingerprint,
    port,
    localIps,
    hostname: nonEmptyString(r.hostname),
    prettyHostname: nonEmptyString(r.prettyHostname),
    tcAddress: nonEmptyString(r.tcAddress),
  };
}

/**
 * Normalized fingerprint comparison key (trimmed, case-insensitive), or null
 * when unusable — mirrors the connections store's dedupe normalization so
 * self detection matches records the same way the store collapses them.
 */
export function normalizeFingerprint(fingerprint: string | undefined | null): string | null {
  const key = (fingerprint ?? '').trim().toUpperCase();
  return key === '' ? null : key;
}

/** The persisted self cert fingerprint, or null when never published. */
export async function getStoredSelfFingerprint(): Promise<string | null> {
  return normalizeFingerprint(await getLocalPref<string>(SELF_FINGERPRINT_KEY));
}

/** Persist this machine's daemon cert fingerprint for self detection. */
export async function setStoredSelfFingerprint(fingerprint: string): Promise<void> {
  await setLocalPref(SELF_FINGERPRINT_KEY, fingerprint);
}

/** Whether the persistent "do not auto-publish" marker is set. */
export async function isAutoPublishSuppressed(): Promise<boolean> {
  return (await getLocalPref<boolean>(SELF_PUBLISH_SUPPRESSED_KEY)) === true;
}

/**
 * Set or clear the "do not auto-publish" marker. Clearing deletes the key
 * (absent = allowed) so a fresh install and an explicitly re-published
 * machine read identically.
 */
export async function setAutoPublishSuppressed(suppressed: boolean): Promise<void> {
  if (suppressed) {
    await setLocalPref(SELF_PUBLISH_SUPPRESSED_KEY, true);
  } else {
    await deleteLocalPref(SELF_PUBLISH_SUPPRESSED_KEY);
  }
}
