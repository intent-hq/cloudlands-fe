/**
 * Parse the daemon's `intent://invite` URI (`workspace.invite.create`:
 * `intent://invite?v=1&host=<ip[,ip...]>&port=<p>&fp=<sha256>&inviteId=<id>&secret=<s>[&tc=<addr>]`)
 * into its component fields for the guest join flow. The envelope is the
 * pairing URI minus the bearer token: the `secret` is a one-time invite
 * secret redeemed over the unauthenticated `/invite` endpoint, never a
 * credential in itself.
 *
 * Tolerant like `pairing-uri.ts`: unknown query params are ignored and
 * missing/invalid component fields come back `null` individually. Returns
 * `null` when the text is not an invite URI at all.
 */

export interface ParsedInviteUri {
  /** Candidate hosts from `host=` (comma-separated); empty when absent. */
  hosts: string[];
  /** WSS port from `port=`; `null` when absent or not a valid port. */
  port: number | null;
  /** TLS cert fingerprint from `fp=`. */
  fingerprint: string | null;
  /** Invite id from `inviteId=`. */
  inviteId: string | null;
  /** One-time invite secret from `secret=`. */
  secret: string | null;
  /** tailcat tunnel address from `tc=` (PROTOCOL §12.3). */
  tcAddress: string | null;
}

// i18n-ignore (wire constant, invite URI scheme)
const INVITE_PREFIX = 'intent://invite';

/**
 * Characters the WHATWG `URL` parser removes from its input before parsing.
 * The classifier strips them too, so whatever the parser would redeem as an
 * invite (`intent://inv\nite?secret=…`) is routed as one — a mismatch would
 * let an invite carrying its secret fall through to the generic deep-link
 * path and its un-scrubbed logging.
 */
const URL_STRIPPED = /[\t\n\r]/g;

function normalizeInviteText(text: string): string {
  return text.replace(URL_STRIPPED, '').trim();
}

/** Whether the text looks like an invite URI (cheap pre-check for routing). */
export function isInviteUri(text: string): boolean {
  const normalized = normalizeInviteText(text).toLowerCase();
  if (!normalized.startsWith(INVITE_PREFIX)) return false;
  // The action must be exactly `invite` — reject e.g. `intent://invites?...`.
  const next = normalized.charAt(INVITE_PREFIX.length);
  return next === '' || next === '?' || next === '/' || next === '#';
}

/** Parse an invite URI; `null` when the text is not one. */
export function parseInviteUri(raw: string): ParsedInviteUri | null {
  const text = normalizeInviteText(raw);
  if (!isInviteUri(text)) return null;
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
  const fingerprint = params.get('fp')?.trim() || null;
  const inviteId = params.get('inviteId')?.trim() || null;
  const secret = params.get('secret')?.trim() || null;
  const tcAddress = params.get('tc')?.trim() || null;
  return { hosts, port, fingerprint, inviteId, secret, tcAddress };
}
