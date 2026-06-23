export const KNOWN_NON_AUGGIE_PROVIDER_IDS = new Set([
  'claude-code',
  'codex',
  'opencode',
  'droid',
  'cortex',
  'pi',
]);

export function isKnownNonAuggieProvider(providerId: string | undefined): providerId is string {
  return providerId !== undefined && KNOWN_NON_AUGGIE_PROVIDER_IDS.has(providerId);
}