/**
 * Parse the daemon's `intent://pair` pairing URI (PROTOCOL §5 `pairing.getInfo`:
 * `intent://pair?v=1&host=<ip[,ip...]>&port=<p>&fp=<sha256>&token=<t>[&tc=<addr>]`)
 * into its component fields so the connect flow can prefill host/port/token —
 * and capture the optional tailcat tunnel address (`tc=`, PROTOCOL §12.3) that
 * manual entry has no other way to learn before the first connect.
 *
 * Tolerant by design: unknown query params are ignored (the `tc=` param itself
 * is additive), and the legacy `certFingerprint=` spelling produced by older
 * QR payloads is accepted alongside `fp=`. Returns `null` when the text is not
 * a pairing URI at all; missing/invalid component fields come back `null`
 * individually so callers can use what is present.
 */

export interface ParsedPairingUri {
  /** Candidate hosts from `host=` (comma-separated); empty when absent. */
  hosts: string[];
  /** WSS port from `port=`; `null` when absent or not a valid port. */
  port: number | null;
  /** TLS cert fingerprint from `fp=` (or legacy `certFingerprint=`). */
  fingerprint: string | null;
  /** Bearer token from `token=`. */
  token: string | null;
  /** tailcat tunnel address from `tc=` (PROTOCOL §12.3). */
  tcAddress: string | null;
}

// i18n-ignore (wire constant, PROTOCOL §5 pairing URI scheme)
const PAIRING_PREFIX = 'intent://pair';

/** Whether the text looks like a pairing URI (cheap pre-check for paste handlers). */
export function isPairingUri(text: string): boolean {
  return text.trim().toLowerCase().startsWith(PAIRING_PREFIX);
}

/** Parse a pairing URI; `null` when the text is not one. */
export function parsePairingUri(raw: string): ParsedPairingUri | null {
  const text = raw.trim();
  if (!isPairingUri(text)) return null;
  let parsed: URL;
  try {
    // URL cannot parse the custom scheme's host component directly.
    parsed = new URL(text.replace(/^intent:\/\//i, 'http://'));
  } catch {
    return null;
  }
  const params = parsed.searchParams;
  const hosts = (params.get('host') ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
  const portRaw = params.get('port')?.trim() ?? '';
  const portNumber = /^\d+$/.test(portRaw) ? Number(portRaw) : NaN;
  const port =
    Number.isInteger(portNumber) && portNumber > 0 && portNumber <= 65535 ? portNumber : null;
  const fingerprint = (params.get('fp') ?? params.get('certFingerprint'))?.trim() || null;
  const token = params.get('token')?.trim() || null;
  const tcAddress = params.get('tc')?.trim() || null;
  return { hosts, port, fingerprint, token, tcAddress };
}
