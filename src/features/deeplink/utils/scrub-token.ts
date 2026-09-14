import { isTcAddress } from '$shared/tc-address';

/**
 * Redact pairing credentials and the one-time invite secret (`secret=`,
 * `intent://invite`) in free-form diagnostics, never in connection inputs.
 */
export function scrubToken(text: string): string {
  // Drop whole pairing links (even malformed ones), including encoded query
  // keys and credentials in host=. Tailcat payloads can embed a pre-shared key.
  // i18n-ignore (log scrubbing constant, never user-facing)
  return text
    .replace(/intent:\/\/pair[^\s"'<>]*/gi, 'intent://pair:REDACTED')
    .replace(/(token|tc)=[^&\s"']*/gi, '$1=REDACTED')
    .replace(/secret=[^&\s"']*/gi, 'secret=REDACTED')
    .replace(/tc[A-Za-z0-9_-]{50,}/g, (address) =>
      isTcAddress(address) ? 'tailcat:REDACTED' : address,
    );
}
