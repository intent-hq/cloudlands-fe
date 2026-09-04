/**
 * Setup Prompt Utils
 */

import {
  isProviderAuthenticationReady,
  type ProviderStatus,
} from '$shared/types/provider-availability';

/**
 * A provider counts as ready when it is installed and not explicitly
 * unauthenticated — the same gate the onboarding provider picker applies.
 */
export function hasReadyProvider(statusMap: Record<string, ProviderStatus>): boolean {
  return Object.entries(statusMap).some(
    ([id, status]) => status.available && isProviderAuthenticationReady(id, status.authenticated),
  );
}
