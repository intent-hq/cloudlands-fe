// Electron-free parsing of daemon route fields, shared by the desktop app and intent-web.

/**
 * Pull the daemon's tailcat tunnel endpoint (`tcAddress`, PROTOCOL §12.3) out
 * of a `system.status` or `server.pairingInfo` result (both carry the same
 * field with the same semantics). Returns `null` when the field is absent,
 * empty, or malformed.
 *
 * The wire shape cannot tell "tunnel disabled" from "tunnel sidecar
 * momentarily down": both omit the field, including the daemon's restart
 * backoff after an unexpected sidecar exit. The address itself is stable (it
 * derives from a key persisted in the daemon data dir), so the remote-record
 * refreshes treat `null` as "no news" and keep the last known address: a
 * cleared address would sync fleet-wide and strand a device that can only
 * dial through the tunnel. The cost of a genuinely disabled tunnel is one
 * failing race candidate. A certificate change still clears it.
 */
export function extractTcAddress(result: unknown): string | null {
  if (result && typeof result === 'object') {
    const value = (result as { tcAddress?: unknown }).tcAddress;
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

/**
 * Pull the local-IP list out of a `server.pairingInfo` result (PROTOCOL §2 —
 * returns `{ token, certFingerprint, port, path, localIps, hostname }`) or a
 * `system.status` result (same `localIps` field name; note that surface may
 * include loopback entries — callers filter). Returns the non-empty string
 * entries, else `null` when the shape is absent or malformed.
 */
export function extractLocalIps(result: unknown): string[] | null {
  if (result && typeof result === 'object') {
    const value = (result as { localIps?: unknown }).localIps;
    if (Array.isArray(value)) {
      const ips = value.filter((ip): ip is string => typeof ip === 'string' && ip.trim() !== '');
      if (ips.length > 0) return ips;
    }
  }
  return null;
}
