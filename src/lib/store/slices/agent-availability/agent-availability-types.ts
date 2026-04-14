/**
 * Agent Availability Types
 *
 * Types for the agent-availability Redux slice.
 * Safe to import from any process.
 */

import type { ProviderStatus } from '$shared/types/provider-availability';

export type { ProviderStatus };

export type AgentAvailabilityState = {
  /** Per-provider status results (e.g. availability, auth details). */
  providerStatusMap: Record<string, ProviderStatus>;
  /** Per-provider in-flight availability-check flags. */
  providerLoadingMap: Record<string, boolean>;
  /** Per-provider in-flight user-info lookup flags. */
  providerUserInfoLoadingMap: Record<string, boolean>;
  /** True once the first bulk check has resolved. */
  hasCheckedOnce: boolean;
  /** Terminal IDs spawned by install-command cards we're watching for refresh. */
  watchedTerminalIds: string[];
};
