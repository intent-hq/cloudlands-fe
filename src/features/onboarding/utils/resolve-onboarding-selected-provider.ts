/**
 * Pure helper deriving which onboarding card should render as "selected".
 *
 * Mirrors the provider-picking priority used by
 * `resolveOnboardingModel` for the common no-override case, so the
 * highlighted card on first render matches the provider the initial
 * onboarding agent will actually launch with:
 *
 *   1. the currently active provider (or the provider of an active
 *      profile), if it is ready
 *   2. the settings-derived default provider, if designated and ready
 *      ('' — unresolved — never matches a ready id)
 *   3. the first ready provider in the caller-supplied order
 *
 * "Ready" here means installed + authenticated (and, for Auggie, on a
 * supported version) — determined by the caller from Redux state so this
 * helper stays a pure function suitable for unit testing.
 */
import { providerRefBaseId } from '$shared/provider-profiles';

export interface ResolveOnboardingSelectedProviderInput {
  activeProviderId: string | undefined;
  defaultProviderId: string;
  /** IDs of providers that are ready (installed + authenticated), in
   *  the render order used by the grid. */
  readyProviderIds: readonly string[];
}

export function resolveOnboardingSelectedProvider(
  input: ResolveOnboardingSelectedProviderInput,
): string | undefined {
  const { activeProviderId, defaultProviderId, readyProviderIds } = input;
  if (readyProviderIds.length === 0) return undefined;
  const activeBase = activeProviderId ? providerRefBaseId(activeProviderId) : undefined;
  if (activeBase && readyProviderIds.includes(activeBase)) {
    return activeBase;
  }
  if (readyProviderIds.includes(defaultProviderId)) {
    return defaultProviderId;
  }
  return readyProviderIds[0];
}
