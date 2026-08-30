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
