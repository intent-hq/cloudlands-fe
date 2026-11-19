import { isIP } from 'node:net';
import { parse } from 'tldts';

export type FrameOriginCheck =
  | { ok: true; origin: string; host: string }
  | { ok: false; name: 'NotAllowedError' | 'SecurityError'; message: string };

function isLocalhostName(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost');
}

function isLoopbackAddress(host: string): boolean {
  return host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

/**
 * Checks the browser-process origins of the calling frame. `frameOrigin` and
 * `topOrigin` come from `event.senderFrame`, never from the page.
 */
export function checkFrameOrigin(frameOrigin: string, topOrigin: string): FrameOriginCheck {
  if (frameOrigin !== topOrigin) {
    return {
      ok: false,
      name: 'NotAllowedError',
      message: 'Passkeys are not available in cross-origin frames.',
    };
  }
  let url: URL;
  try {
    url = new URL(frameOrigin);
  } catch {
    return { ok: false, name: 'SecurityError', message: 'The document has no valid origin.' };
  }
  const host = url.hostname.toLowerCase();
  const secure =
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && (isLocalhostName(host) || isLoopbackAddress(host)));
  if (!secure) {
    return { ok: false, name: 'SecurityError', message: 'Passkeys need a secure context.' };
  }
  return { ok: true, origin: url.origin, host };
}

/**
 * WebAuthn RP ID rule: the RP ID equals the origin host or is a registrable
 * suffix of it, never a public suffix (public suffix list, private section
 * included) and never an IP address.
 */
export function isValidRpIdForHost(rpId: string, host: string): boolean {
  const id = rpId.toLowerCase();
  if (!id || id.startsWith('.') || id.endsWith('.')) return false;
  if (isIP(id) || isIP(host.replace(/^\[|\]$/g, ''))) return false;
  if (id !== host && !host.endsWith(`.${id}`)) return false;
  if (isLocalhostName(host)) return id === host || id === 'localhost';
  const parsed = parse(id, { allowPrivateDomains: true });
  if (!parsed.domain || parsed.publicSuffix === id) return false;
  return true;
}
