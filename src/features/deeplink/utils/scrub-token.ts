/**
 * Redact the pairing bearer token (`token=` query param, PROTOCOL §5 pairing
 * URI) and the one-time invite secret (`secret=`, `intent://invite`) in
 * free-form text destined for a log line. The deep-link entry points log the
 * URLs they receive, and both link kinds carry a credential-grade value —
 * every such log site must pass the text through this first.
 *
 * The text is normalized the way the WHATWG `URL` parser normalizes its
 * input before any matching: ASCII tab, LF and CR are stripped wherever they
 * appear (so `sec\nret=` or `secret\t=` IS `secret=` to the parser), and keys
 * are matched AFTER percent-decoding and case-folding, because the URI parsers
 * go through `URLSearchParams`, which accepts `%73ecret=` or `SECRET=` as
 * `secret` — so any spelling the parser redeems, this redacts. The scrubbed
 * text is only ever a log line, so dropping those characters loses nothing.
 */

/** Characters the WHATWG URL parser removes from its input before parsing. */
const URL_STRIPPED = /[\t\n\r]/g;

/** One `key=value` pair as it appears in a query string or free-form text. */
const QUERY_PAIR = /([^&=?#\s"'<>]+)=([^&#\s"'<>]*)/g;

/** Decoded, case-folded key suffixes that carry a credential. */
const CREDENTIAL_KEY = /(token|secret)$/i;

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
  return text.replace(URL_STRIPPED, '').replace(QUERY_PAIR, (pair, rawKey: string) =>
    // i18n-ignore (log scrubbing constant, never user-facing)
    isCredentialKey(rawKey) ? `${rawKey}=REDACTED` : pair,
  );
}
