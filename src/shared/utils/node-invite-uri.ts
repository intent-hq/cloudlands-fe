/**
 * Parse an `intent://node` link (`intentd pair --node`):
 * `intent://node?v=1&host=<ip[,ip...]>&port=<p>&fp=<sha256>&invite=<id>&secret=<s>[&tc=<addr>]`.
 *
 * It carries routes, the certificate pin and a single-use invite secret,
 * never an owner token (a `token=` param is ignored). Missing or invalid
 * fields come back `null` so the caller can say what is missing.
 */

import { isPairingUri } from './pairing-uri';

export interface ParsedNodeInviteUri {
  /** `v=`; null when absent, NaN when not a number. */
  version: number | null;
  hosts: string[];
  port: number | null;
  fingerprint: string | null;
  tcAddress: string | null;
  inviteId: string | null;
  /** Single-use invite secret. Never log or show it. */
  secret: string | null;
}

// i18n-ignore (wire constant, node invite link scheme)
const NODE_PREFIX = 'intent://node';

export function isNodeInviteUri(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized.startsWith(NODE_PREFIX)) return false;
  const next = normalized.charAt(NODE_PREFIX.length);
  return next === '' || next === '?' || next === '/' || next === '#';
}

/** Pair and node links carry credentials: main handles them, never the renderer's load URL. */
export function isMainOnlyLinkUri(text: string): boolean {
  return isPairingUri(text) || isNodeInviteUri(text);
}

export function parseNodeInviteUri(raw: string): ParsedNodeInviteUri | null {
  const text = raw.trim();
  if (!isNodeInviteUri(text)) return null;
  let parsed: URL;
  try {
    parsed = new URL(text.replace(/^intent:\/\//i, 'http://'));
  } catch {
    return null;
  }
  const params = parsed.searchParams;
  const value = (key: string) => params.get(key)?.trim() || null;
  const versionRaw = value('v');
  const portRaw = value('port') ?? '';
  const portNumber = /^\d+$/.test(portRaw) ? Number(portRaw) : NaN;
  return {
    version: versionRaw === null ? null : /^\d+$/.test(versionRaw) ? Number(versionRaw) : NaN,
    hosts: (params.get('host') ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter((host) => host.length > 0),
    port: Number.isInteger(portNumber) && portNumber > 0 && portNumber <= 65535 ? portNumber : null,
    fingerprint: value('fp'),
    tcAddress: value('tc'),
    inviteId: value('invite'),
    secret: value('secret'),
  };
}

function decodedKey(key: string): string {
  try {
    return decodeURIComponent(key.replace(/\+/g, ' ')).trim().toLowerCase();
  } catch {
    return key.trim().toLowerCase();
  }
}

/**
 * The link with every invite secret replaced, safe to show on screen. Keys are
 * read as the parser reads them: tab and newlines dropped, percent-decoded
 * (`%73ecret=`), any case, every repeat.
 */
export function maskNodeInviteUri(raw: string): string {
  const text = raw.trim().replace(/[\t\n\r]/g, '');
  const queryAt = text.indexOf('?');
  if (queryAt < 0) return text;
  const hashAt = text.indexOf('#', queryAt);
  const query = text.slice(queryAt + 1, hashAt < 0 ? undefined : hashAt);
  const masked = query
    .split('&')
    .map((pair) => {
      const equals = pair.indexOf('=');
      const key = equals < 0 ? pair : pair.slice(0, equals);
      return decodedKey(key) === 'secret' ? `${key}=••••` : pair;
    })
    .join('&');
  return `${text.slice(0, queryAt + 1)}${masked}${hashAt < 0 ? '' : text.slice(hashAt)}`;
}
