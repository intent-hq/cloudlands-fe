/**
 * Redact the pairing bearer token (`token=` query param, PROTOCOL §5 pairing
 * URI) in free-form text destined for a log line. The deep-link entry points
 * log the URLs they receive, and an `intent://pair` link carries a bearer
 * token — every such log site must pass the text through this first.
 */
export function scrubToken(text: string): string {
  // i18n-ignore (log scrubbing constant, never user-facing)
  return text.replace(/token=[^&\s"']*/gi, 'token=REDACTED');
}
