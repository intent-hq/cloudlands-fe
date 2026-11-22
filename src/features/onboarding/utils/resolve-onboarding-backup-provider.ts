/**
 * The provider onboarding enables as a free backup when the user continues
 * from the welcome step with another provider: OpenCode, whose free models
 * need no account, so a usable model is always in the picker. It is enabled
 * but never made active, and only on that explicit advance (decision D1(B)).
 */
const BACKUP_PROVIDER_ID = 'opencode';

export interface ResolveOnboardingBackupProviderInput {
  /** The provider the welcome step commits; undefined when nothing is ready. */
  selectedProviderId: string | undefined;
  statusMap: Record<string, { available?: boolean; authenticated?: boolean } | undefined>;
  /** Saved enablement: an explicit `false` means the user turned it off. */
  enabledProviders: Record<string, boolean>;
  /** An orchestrator runs no local providers; onboarding offers profiles only. */
  orchestrator?: boolean;
}

export function resolveOnboardingBackupProvider(
  input: ResolveOnboardingBackupProviderInput,
): string | undefined {
  const { selectedProviderId, statusMap, enabledProviders, orchestrator } = input;
  if (!selectedProviderId || orchestrator) return undefined;
  if (selectedProviderId === BACKUP_PROVIDER_ID) return undefined;
  if (enabledProviders[BACKUP_PROVIDER_ID] === false) return undefined;
  const status = statusMap[BACKUP_PROVIDER_ID];
  if (status?.available !== true || status.authenticated === false) return undefined;
  return BACKUP_PROVIDER_ID;
}
