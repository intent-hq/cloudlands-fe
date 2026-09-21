/**
 * Pure helper deriving which onboarding card should render as "selected".
 *
 * Mirrors the provider-picking priority used by
 * `resolveOnboardingModel` for the common no-override case, so the
 * highlighted card on first render matches the provider the initial
 * onboarding agent will actually launch with:
 *
 *   1. the currently active provider, if it is ready
 *   2. the settings-derived default provider, if designated and ready
 *      ('' — unresolved — never matches a ready id)
 *   3. the first ready non-opt-in provider in the caller-supplied order
 *
 * "Ready" here means installed + authenticated (and, for Auggie, on a
 * supported version) — determined by the caller from Redux state so this
 * helper stays a pure function suitable for unit testing.
 */
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
  if (activeProviderId === 'antigravity' && !readyProviderIds.includes(activeProviderId)) {
    return undefined;
  }
  if (readyProviderIds.length === 0) return undefined;
  if (activeProviderId && readyProviderIds.includes(activeProviderId)) {
    return activeProviderId;
  }
  if (readyProviderIds.includes(defaultProviderId)) {
    return defaultProviderId;
  }
  // Detection alone is not consent to use Antigravity. A card click writes
  // activeProviderId; a saved default is already an explicit preference.
  return readyProviderIds.find((providerId) => providerId !== 'antigravity');
}
