import { isTcAddress } from '$shared/tc-address';

/**
 * Redact pairing credentials (`token=`, `tc=`, whole `intent://pair` links,
 * bare Tailcat addresses) and the one-time invite secret (`secret=`,
 * `intent://invite`) in free-form diagnostics, never in connection inputs.
 *
 * Keys are matched AFTER percent-decoding and case-folding, because the URI
 * parsers go through `URLSearchParams`, which accepts `%73ecret=` or
 * `SECRET=` as `secret` — so any spelling the parser redeems, this redacts.
 */

/** One `key=value` pair as it appears in a query string or free-form text. */
const QUERY_PAIR = /([^&=?#\s"'<>]+)=([^&#\s"'<>]*)/g;

/** Decoded, case-folded key suffixes that carry a credential. */
const CREDENTIAL_KEY = /(token|secret|tc)$/i;

function isCredentialKey(rawKey: string): boolean {
  let decoded = rawKey;
  try {
    decoded = decodeURIComponent(rawKey.replace(/\+/g, ' '));
  } catch {
    // Malformed escape — fall back to the raw spelling.
  }
  return CREDENTIAL_KEY.test(decoded.trim());
}

export function scrubToken(text: string): string {
  // Drop whole pairing links (even malformed ones), including encoded query
  // keys and credentials in host=. Tailcat payloads can embed a pre-shared key.
  // i18n-ignore (log scrubbing constant, never user-facing)
  return text
    .replace(/intent:\/\/pair[^\s"'<>]*/gi, 'intent://pair:REDACTED')
    .replace(QUERY_PAIR, (pair, rawKey: string) =>
      isCredentialKey(rawKey) ? `${rawKey}=REDACTED` : pair,
    )
    .replace(/tc[A-Za-z0-9_-]{50,}/g, (address) =>
      isTcAddress(address) ? 'tailcat:REDACTED' : address,
    );
}
