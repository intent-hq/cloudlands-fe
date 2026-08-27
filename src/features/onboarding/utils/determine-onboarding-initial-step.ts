/**
 * Initial-step decision for `/workspace/new` (OnboardingPage).
 *
 * Once the host-requirements gate settles green, the page jumps to the step
 * the provider-setup state warrants instead of always walking the full flow:
 * a ready provider (or existing workspaces) means setup is done → 'project';
 * the persisted `hasCompletedProviderSetup` flag is a local fast-path taken
 * while the bulk provider check is still pending — provisional, and corrected
 * back to 'welcome' if the check settles with no ready provider and no
 * workspaces exist. When the check has ALREADY settled with neither, the
 * persisted flag is ignored outright: the backend factually has no ready
 * provider, so provider setup ('welcome') is the only correct landing step.
 */

export type OnboardingInitialStepDecision = {
  step: 'welcome' | 'project';
  /**
   * True when 'project' was chosen on the persisted flag alone (no confirmed
   * ready provider / workspaces yet) — the caller must watch the provider
   * check and correct via `resolveFastPathSettlement`.
   */
  viaLocalFastPath: boolean;
};

export function determineOnboardingInitialStep(inputs: {
  /** Explicit "show the full flow" request (e.g. Command Palette). */
  fullFlowRequested: boolean;
  /** A provider is installed and not explicitly unauthenticated. */
  hasReadyProvider: boolean;
  /** Persisted local flag: the user completed provider setup before. */
  hasCompletedProviderSetup: boolean;
  /**
   * At least one ACTIVE (non-chief, non-archived/deleted) workspace already
   * exists — compute with `hasAvailableWorkspace`, not a bare length check.
   */
  hasWorkspaces: boolean;
  /**
   * True once a bulk provider check has COMPLETED (full sweep settled) with
   * at least one status landed — not merely the first status arriving.
   */
  providersCheckedOnce: boolean;
}): OnboardingInitialStepDecision {
  if (inputs.fullFlowRequested) return { step: 'welcome', viaLocalFastPath: false };
  if (inputs.hasReadyProvider || inputs.hasWorkspaces) {
    return { step: 'project', viaLocalFastPath: false };
  }
  // Settled with no ready provider and no workspaces: the persisted flag is
  // stale for this backend — land on provider setup, no provisional step.
  if (inputs.providersCheckedOnce) return { step: 'welcome', viaLocalFastPath: false };
  if (inputs.hasCompletedProviderSetup) return { step: 'project', viaLocalFastPath: true };
  return { step: 'welcome', viaLocalFastPath: false };
}

export type FastPathSettlement = 'pending' | 'keep' | 'correct';

/**
 * Resolve a provisional local fast-path against the (possibly settled) bulk
 * provider check: 'keep' once a ready provider or workspaces confirm it,
 * 'correct' (route back to provider setup) when the check settled with
 * neither, 'pending' while no bulk check has completed yet.
 */
export function resolveFastPathSettlement(inputs: {
  hasReadyProvider: boolean;
  /**
   * True once a bulk provider check has COMPLETED (full sweep settled) with
   * at least one status landed — not merely the first status arriving.
   */
  providersCheckedOnce: boolean;
  hasWorkspaces: boolean;
}): FastPathSettlement {
  if (inputs.hasReadyProvider || inputs.hasWorkspaces) return 'keep';
  if (!inputs.providersCheckedOnce) return 'pending';
  return 'correct';
}
