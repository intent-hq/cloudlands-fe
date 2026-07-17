/**
 * Agent Availability Types
 *
 * Types for the agent-availability Redux slice.
 * Safe to import from any process.
 */

import type {
  NpxStatus,
  ProviderStatus as SharedProviderStatus,
} from '$shared/types/provider-availability';

export type ManagedInstallState = 'not_installed' | 'installing' | 'installed' | 'failed' | 'unsupported';

export type ManagedInstallStatus = {
  managedInstallState: ManagedInstallState;
  version?: string;
  downloadProgress?: number;
  error?: string;
  usingFallback?: boolean;
};

export type ProviderStatus = SharedProviderStatus & Partial<ManagedInstallStatus>;

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
  /** npx availability status for npx-fallback providers. */
  npxStatus: NpxStatus | null;
};
