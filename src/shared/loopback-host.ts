/**
 * Loopback host detection, shared main + renderer. A loopback address is
 * only ever reachable from the machine it names, so it is useless as a
 * fleet-wide connection candidate: the self-publish flow must never write
 * one into the keychain-synced connections registry, and the multi-host
 * connect race must never dial one that a legacy synced record still
 * carries (it would connect to the WRONG machine's local daemon).
 */

/**
 * Whether a host string names the local loopback interface: `localhost`,
 * any IPv4 `127.0.0.0/8` address, IPv6 `::1` (with or without brackets),
 * or an IPv4-mapped IPv6 loopback (`::ffff:127.x.y.z`). Purely syntactic —
 * no DNS resolution — so a hostname that merely resolves to loopback is
 * not detected; the daemon's `localIps` and synced records carry literal
 * IPs, which this covers.
 */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (h === 'localhost' || h === '::1' || h === '[::1]') return true;
  // IPv4-mapped IPv6 loopback: ::ffff:127.x.y.z (optionally bracketed).
  const unmapped = h.replace(/^\[?::ffff:/, '').replace(/\]$/, '');
  return /^127(\.\d{1,3}){3}$/.test(unmapped);
}
