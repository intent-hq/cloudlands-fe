/** The provider a specialist is pinned to (its own `codingAgent`), if any. */
export function specialistPinnedProvider(
  specialists: ReadonlyArray<{ id: string; codingAgent?: string }>,
  specialistId: string | null,
): string | undefined {
  if (!specialistId) return undefined;
  return specialists.find((s) => s.id === specialistId)?.codingAgent || undefined;
}

const NOT_ENABLED_PATTERN = /\bis not enabled\b/i;
const PROVIDER_ID_PATTERN = /provider "([^"]+)"/i;

/**
 * Whether `workspace.create` refused the initial agent's provider as turned
 * off (intentd `ensure_provider_enabled`), and the provider it named:
 * `undefined` = not that refusal, `null` = that refusal without a provider id.
 */
export function providerNotEnabledFromError(
  error: string | null | undefined,
): string | null | undefined {
  if (!error || !NOT_ENABLED_PATTERN.test(error)) return undefined;
  return PROVIDER_ID_PATTERN.exec(error)?.[1] ?? null;
}
