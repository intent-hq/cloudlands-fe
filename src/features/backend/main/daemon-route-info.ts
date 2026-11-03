// Electron-free parsing of daemon route fields, shared by the desktop app and intent-web.

/**
 * Pull the daemon's tailcat tunnel endpoint (`tcAddress`, PROTOCOL §12.3) out
 * of a `system.status` or `server.pairingInfo` result (both carry the same
 * field with the same semantics). Returns `null` when the field is absent,
 * empty, or malformed — a conclusive "no tunnel" for a successful response.
 *
 * Known trade-off: the wire shape cannot distinguish "tunnel disabled" from
 * "tunnel sidecar momentarily down" — `system.status` omits the field in both
 * cases (including the daemon's restart-backoff window after an unexpected
 * sidecar exit). A reconnect landing in that window therefore clears a stored
 * address that would have come back on its own; it is re-learned from the
 * next post-connect status once the sidecar recovers. Now that the address is
 * keychain-synced, the blast radius is fleet-wide: the clear bumps the LWW
 * clock and propagates, so a device that can ONLY dial through the tunnel
 * loses its route until any directly-connected device reconnects after the
 * sidecar recovers and re-captures the address (the tunnel-only device cannot
 * rediscover it on its own). Deliberately accepted
 * over retaining stale values: a kept address whose tunnel was genuinely
 * disabled would add a perpetually-failing race candidate to every connect,
 * and the field's contract ("never advertises a route nothing is serving")
 * argues for mirroring it faithfully. Distinguishing the two states needs a
 * protocol change (tracked upstream), not FE-side guessing.
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
