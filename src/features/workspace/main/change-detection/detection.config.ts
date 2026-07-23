/**
 * Change-detection layer configuration.
 *
 * Home for the sub-configs consumed by the FE change-detection / infra
 * survivors (`snapshot-manager`, `change-detector-refactored`,
 * `event-coordinator`, `recovery-manager`).
 * Extracted out of the retiring `features/file-tracking/tracking.config.ts`.
 * Values mirror the originals byte-for-byte to preserve runtime behaviour.
 * Change detection is driven by intentd `file:*` events; there is no local
 * file watcher or periodic git polling, so no intervals for those live here.
 */

export const CHANGE_DETECTION_CONFIG = {
  immediateCheckDebounce: 500,

  maxParallelFileProcessing: 5,
  maxParallelFileProcessingStartup: 10,
  batchEmissionDelay: 10,

  maxSnapshotSize: 100,
  maxEmissionTrackerSize: 1000,
  cleanupInterval: 60000,

  maxGitErrors: 5,
  gitErrorResetTime: 300000,
  gitRetryDelay: 1000,
  maxGitRetries: 3,

  largeRepoThreshold: 1000,

  additionalIgnorePatterns: ['.workspace-notes/**', '.workspace-notes.backup/**'],
} as const;

export const EVENT_BUS_CONFIG = {
  maxListeners: 100,
  eventQueueSize: 1000,

  persistEvents: true,
  maxPersistedEvents: 10000,
  compressionEnabled: true,
  storageKey: 'workspace-events',

  batchingEnabled: true,
  batchInterval: 100,
  maxBatchSize: 50,

  deduplicationEnabled: true,
  deduplicationWindow: 1000,
  deduplicationFields: [
    'id',
    'type',
    'actor.id',
    'metadata.filePath',
    'data.filterDescription',
    'data.agentId',
  ],
  maxDeduplicationCacheSize: 1000,
} as const;

export const RECOVERY_CONFIG = {
  maxRetries: 3,
  retryDelay: 1000,
  retryBackoff: 2,

  enableAutoRecovery: true,
  recoveryCheckInterval: 60000,

  logErrors: true,
  errorLogLevel: 'error',
  includeStackTrace: process.env.NODE_ENV === 'development',
} as const;

export type ChangeDetectionConfig = typeof CHANGE_DETECTION_CONFIG;
export type EventBusConfig = typeof EVENT_BUS_CONFIG;
export type RecoveryConfig = typeof RECOVERY_CONFIG;
