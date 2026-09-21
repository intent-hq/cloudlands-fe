// i18n-ignore (wire constant, intent:// URL scheme)
const INTENT_SCHEME_PREFIX = 'intent://';

/**
 * Find the first `intent://` URL among command-line arguments. The scheme
 * match is case-insensitive (mirroring `isPairingUri`'s tolerance), so e.g.
 * an uppercase `INTENT://PAIR...` link is not silently dropped on the
 * cold-start and second-instance argv paths.
 */
export function findIntentUrl(args: readonly string[]): string | undefined {
  return args.find((arg) => arg.trim().toLowerCase().startsWith(INTENT_SCHEME_PREFIX));
}
