/**
 * Display label for a remote connection: prefer its configured name, with
 * captured hostname and raw address retained as legacy fallbacks. The local
 * entry is labeled elsewhere.
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
