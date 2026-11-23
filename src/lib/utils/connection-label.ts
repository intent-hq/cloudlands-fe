import { m } from '$shared/paraglide/messages.js';
import { isTcAddress } from '$shared/tc-address';
import { normalizeCollaborationMachineName } from '$shared/collaboration-machine-name';

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
 * Display label for the local entry: "This computer" on screen. The stored
 * fallback label ("This machine (local)") is never shown as is.
 */
export function formatLocalMachineLabel(_conn: { machineName?: string | null }): string {
  return m.layout_daemonStatus_localConnection_label();
}

/**
 * Settings → Machines row label: the local entry reads "This computer"; every
 * saved connection reads its plain name (the host on screen shows Current).
 */
export function formatMachineRowLabel(
  conn: {
    id: string;
    isLocal: boolean;
    machineName?: string | null;
    hostname?: string | null;
    host: string | null;
    port: number | null;
    label: string;
  },
  _windowBackendId: string,
): string {
  if (conn.isLocal) return formatLocalMachineLabel(conn);
  return formatConnectionLabel(conn);
}

/**
 * Primary display label for a guest session: the captured machine name
 * (`hostname`, the pretty hostname when the host reports one) wins; until it
 * arrives the stored join-time `label` (the dialled host) shows. A Tailcat
 * `tc…` address is an opaque encoded blob, not something a person can read,
 * so it reads "Unknown host" instead. The stored `label` is never rewritten.
 */
export function formatGuestSessionLabel(session: {
  hostname: string | null;
  label: string;
}): string {
  const hostname = normalizeCollaborationMachineName(session.hostname ?? '');
  if (hostname) return hostname;
  return isTcAddress(session.label) ? m.connection_unknownHost_label() : session.label;
}

/**
 * Secondary address text for a guest session — the join-time `label` (host)
 * once the hostname has taken over as the primary label, so the row reads
 * `hostname (address)` like a remote connection. `null` while the address is
 * still the primary label (nothing to repeat), and for a Tailcat `tc…`
 * address, which is never shown.
 */
export function formatGuestSessionAddress(session: {
  hostname: string | null;
  label: string;
}): string | null {
  const address = session.label.trim();
  if (!address || isTcAddress(address)) return null;
  return address !== formatGuestSessionLabel(session) ? address : null;
}
