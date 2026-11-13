import { isProviderDisabledInSettings } from '$lib/components/chat/input/model-picker-utils';

/** The provider a specialist is pinned to (its own `codingAgent`), if any. */
export function specialistPinnedProvider(
  specialists: ReadonlyArray<{ id: string; codingAgent?: string }>,
  specialistId: string | null,
): string | undefined {
  if (!specialistId) return undefined;
  return specialists.find((s) => s.id === specialistId)?.codingAgent || undefined;
}

/**
 * The turned-off provider a workspace suggestion card's agent is pinned to,
 * or `null`. A pin is never switched silently (decision D1(B)), so the card
 * asks the user instead. Only the pin counts: when the request carries its
 * own provider (the proposal's, or an adopted remembered setup) the daemon
 * uses that one and never resolves the pin.
 */
export function disabledPinnedProvider({
  specialistId,
  specialists,
  requestProvider,
  enabledProviders,
}: {
  specialistId: string | null;
  specialists: ReadonlyArray<{ id: string; codingAgent?: string }>;
  requestProvider: string | undefined;
  enabledProviders: Readonly<Record<string, boolean>>;
}): string | null {
  if (requestProvider) return null;
  const pinned = specialistPinnedProvider(specialists, specialistId);
  if (!pinned) return null;
  return isProviderDisabledInSettings({ ...enabledProviders }, pinned) ? pinned : null;
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
