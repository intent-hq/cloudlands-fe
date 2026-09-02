/**
 * tailcat tunnel address helpers (PROTOCOL §12.3). A tc address is the
 * daemon-minted stable tunnel endpoint identifier (`tc-…`, e.g. `tc-key-…`),
 * carried in pairing URIs (`tc=`), `system.status.tcAddress`, and
 * `server.pairingInfo.tcAddress`. Shared main + renderer so manual-entry
 * detection and main-process tunnel routing agree on the same predicate.
 */

// i18n-ignore (wire constant, PROTOCOL §12.3 tc address prefix)
const TC_ADDRESS_PREFIX = 'tc-';

/**
 * Whether a user-entered host string is a tailcat tunnel address rather than
 * a hostname/IP. tc addresses are daemon-minted with the `tc-` prefix; no
 * real-world hostname label starts with `tc-` followed by the daemon's key
 * encoding, but the check stays a cheap prefix test on purpose — the tunnel
 * dial itself is the authoritative validation.
 */
export function isTcAddress(host: string): boolean {
  return host.trim().toLowerCase().startsWith(TC_ADDRESS_PREFIX);
}
