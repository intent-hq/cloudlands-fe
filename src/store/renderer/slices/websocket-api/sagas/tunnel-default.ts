/** The bind entries the way `loadSnapshot` reads them: a string or a list of non-empty strings. */
function bindEntries(bind: unknown): string[] {
  const list = Array.isArray(bind) ? bind : [bind];
  return list.filter((ip): ip is string => typeof ip === 'string' && ip.length > 0);
}

/** The eight 16-bit groups of an IPv6 address, or null when it is not one. */
function ipv6Groups(ip: string): number[] | null {
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string) => (part ? part.split(':') : []);
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

function isLoopback(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1].startsWith('127.');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip.startsWith('127.');
  const groups = ipv6Groups(ip);
  return groups !== null && groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1;
}

/** True when `server.bindAddress` serves loopback only (unset means the loopback default). */
export function bindIsLoopbackOnly(bind: unknown): boolean {
  return bindEntries(bind).every(isLoopback);
}

/**
 * Turning remote access on defaults to loopback plus the Tailcat tunnel: an
 * off tunnel is turned on while the bind is still loopback only. A bind the
 * user widened to other networks keeps their whole setup, tunnel included;
 * a daemon without the tunnel setting is left to the caller.
 */
export function tunnelDefaultApplies(settings: { path: string; value: unknown }[]): boolean {
  const value = (path: string) => settings.find((entry) => entry.path === path)?.value;
  return (
    value('server.tunnel.enabled') === false && bindIsLoopbackOnly(value('server.bindAddress'))
  );
}
