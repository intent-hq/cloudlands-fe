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
 * or an IPv4-mapped IPv6 loopback in either the dotted (`::ffff:127.x.y.z`)
 * or hexadecimal (`::ffff:7fxx:yyzz`) spelling. Purely syntactic — no DNS
 * resolution — so a hostname that merely resolves to loopback is not
 * detected; the daemon's `localIps` and synced records carry literal IPs,
 * which this covers.
 */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (h === 'localhost' || h === '::1' || h === '[::1]') return true;
  // IPv4-mapped IPv6 loopback (optionally bracketed): ::ffff:127.x.y.z, or
  // the hex spelling ::ffff:7fxx:yyzz (0x7f high byte = 127.0.0.0/8; the
  // high group is always 4 hex digits since 0x7f00 >= 0x1000).
  const mapped = /^\[?::ffff:([0-9a-f:.]+?)\]?$/.exec(h);
  if (mapped && /^7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(mapped[1])) return true;
  const unmapped = mapped ? mapped[1] : h;
  return /^127(\.\d{1,3}){3}$/.test(unmapped);
}
