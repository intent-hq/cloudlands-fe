/**
 * Display label for a remote connection: the Name (`label`) wins outright.
 * The main-process store defaults an uncustomized Name to the backend pretty
 * hostname on capture, so post-migration records carry the pretty name in
 * `label` itself. For unmigrated records (never reconnected since), a label
 * equal to the `host:port` address still defers to the captured hostname,
 * then falls back to the raw address. The local entry is labeled elsewhere.
 */
export function formatConnectionLabel(conn: {
  hostname?: string | null;
  host: string | null;
  port: number | null;
  label: string;
}): string {
  const label = conn.label.trim();
  const address = conn.host && conn.port != null ? `${conn.host}:${conn.port}` : '';
  const configuredName = label && label !== address ? label : '';
  return configuredName || conn.hostname?.trim() || label || address;
}

/**
 * Primary display label for a guest session: the captured machine name
 * (`hostname`, the pretty hostname when the host reports one) wins; until it
 * arrives the stored join-time `label` (the dialled tc address / host) shows.
 * The stored `label` is never rewritten — it stays the address.
 */
export function formatGuestSessionLabel(session: {
  hostname: string | null;
  label: string;
}): string {
  return session.hostname?.trim() || session.label;
}

/**
 * Secondary address text for a guest session — the join-time `label` (tc
 * address / host) once the hostname has taken over as the primary label, so
 * the row reads `hostname (address)` like a remote connection. `null` while
 * the address is still the primary label (nothing to repeat).
 */
export function formatGuestSessionAddress(session: {
  hostname: string | null;
  label: string;
}): string | null {
  const address = session.label.trim();
  return address && address !== formatGuestSessionLabel(session) ? address : null;
}
