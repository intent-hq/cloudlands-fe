/**
 * Centralized Configuration for File Tracking System
 *
 * This file consolidates all configuration settings for the file tracking,
 * activity logging, and change detection systems.
 */

export const TRACKING_CONFIG = {
  // Change Detection Settings
  changeDetection: {
    // Polling intervals (ms) - fallback when FSEvents unavailable (EMFILE/resource exhaustion)
    // Keep default ≤15s to avoid staleness; large repos use longer intervals as a tradeoff
    gitPollingInterval: 15000, // 15 seconds fallback when FSEvents unavailable
    gitPollingIntervalLargeRepo: 30000, // 30 seconds fallback for large repos when FSEvents unavailable
    fileWatcherDebounce: 300, // Increased from 100 to batch more changes
    immediateCheckDebounce: 500,

    // Performance limits
    maxParallelFileProcessing: 5,
    maxParallelFileProcessingStartup: 10,
    batchEmissionDelay: 10,

    // Memory management
    maxSnapshotSize: 100,
    maxEmissionTrackerSize: 1000,
    cleanupInterval: 60000, // 1 minute

    // Error handling
    maxGitErrors: 5,
    gitErrorResetTime: 300000, // 5 minutes
    gitRetryDelay: 1000,
    maxGitRetries: 3,

    // Large repo threshold (number of files)
    largeRepoThreshold: 1000,

    // File watching
    disableFileWatcher: false, // Re-enabled with proper resource management
    gitPollingOnly: false, // Use both file watching and git polling for better detection

    // Ignored patterns (in addition to .gitignore)
    additionalIgnorePatterns: ['.augment/**', '.workspace-notes/**', '.workspace-notes.backup/**'],
  },

  // Remote Change Detection (for remote workspaces)
  remoteChangeDetection: {
    enabled: true,
    adaptivePolling: true,
    minPollingInterval: 500,
    maxPollingInterval: 5000,
    activityBoostDuration: 30000, // 30 seconds
    idleThreshold: 60000, // 1 minute
  },

  // File Tracking Service Settings
  fileTracking: {
    // Debounce settings
    saveDebounce: 1000,
    updateDebounce: 500, // Debounce UI updates to reduce jank during rapid changes

    // Stage transitions
    autoStageDelay: 2000, // Auto-stage after 2 seconds
    autoCommitDelay: 5000, // Auto-commit after 5 seconds (if enabled)
    autoCommitEnabled: false,

    // Storage settings
    storageKey: 'file-tracking',
    maxStorageSize: 10 * 1024 * 1024, // 10MB
    compressionEnabled: true,

    // Performance
    maxTrackedFiles: 1000,
    maxHistoryPerFile: 100,
  },

  // Git Integration Settings
  gitIntegration: {
    // Sync settings
    minSyncInterval: 1000, // Minimum time between syncs to prevent rapid syncs
    syncDebounce: 2000, // Debounce for batching multiple sync requests
    queueProcessDebounce: 1000, // Debounce for processing change queue
  },

  // Line Changes Tracking
  lineChanges: {
    enabled: true,
    trackingGranularity: 'line', // 'line' | 'hunk' | 'file'
    maxLineHistory: 1000,
    aggregationInterval: 1000,

    // Statistics
    calculateStats: true,
    statsUpdateInterval: 5000,
  },

  // Activity Log Settings
  activityLog: {
    // Display settings
    maxVisibleEvents: 100,
    virtualScrolling: true,
    scrollBuffer: 10,

    // Filtering
    defaultFilters: {
      excludeSystemEvents: false,
      excludeFileEvents: false,
      excludeAgentEvents: false,
    },

    // Performance
    renderDebounce: 100,
    updateBatchSize: 10,

    // Search
    searchDebounce: 300,
    maxSearchResults: 50,
  },

  // Event System Settings
  events: {
    // Event Bus
    maxListeners: 100,
    eventQueueSize: 1000,

    // Event Store
    persistEvents: true,
    maxPersistedEvents: 10000,
    compressionEnabled: true,
    storageKey: 'workspace-events',

    // Event batching
    batchingEnabled: true,
    batchInterval: 100,
    maxBatchSize: 50,

    // Deduplication
    deduplicationEnabled: true,
    deduplicationWindow: 1000,
    // Fields used to generate deduplication key:
    // - id: event ID (unique per event) — ensures genuinely different events are never
    //   collapsed, even when they share the same type/actor. Without this, rapid
    //   agent:idle events (e.g., coordinator finishes, is woken by subscription,
    //   finishes again within 1s) are silently dropped because the content-based key
    //   is identical. The id field still catches true duplicates (same event object
    //   flowing through multiple bus paths keeps its id).
    // - type: event type (e.g., agent:created, file:changed)
    // - actor.id: who performed the action (for file events)
    // - metadata.filePath: which file was affected (for file events)
    // - data.filterDescription: for agent subscription events (changes when agents are added to delegation group)
    // - data.agentId: for agent events (e.g., agent:created, agent:idle) - ensures events about the same agent are deduplicated
    deduplicationFields: ['id', 'type', 'actor.id', 'metadata.filePath', 'data.filterDescription', 'data.agentId'],
    maxDeduplicationCacheSize: 1000, // Maximum number of events to track for deduplication
  },

  // Attribution Engine Settings
  attribution: {
    // Context TTL
    defaultContextTTL: 300000, // 5 minutes
    agentContextTTL: 600000, // 10 minutes
    userContextTTL: 60000, // 1 minute

    // Provenance tracking
    trackProvenance: true,
    includeStackTrace: false, // Only in debug mode
    maxProvenanceDepth: 5,
  },

  // Performance Monitoring
  performance: {
    enabled: true,
    metricsInterval: 60000, // 1 minute
    slowOperationThreshold: 1000, // 1 second

    // Memory monitoring
    memoryCheckInterval: 30000, // 30 seconds
    memoryWarningThreshold: 100 * 1024 * 1024, // 100MB
    memoryCriticalThreshold: 200 * 1024 * 1024, // 200MB
  },

  // Error Handling Settings
  errorHandling: {
    // Retry settings
    maxRetries: 3,
    retryDelay: 1000,
    retryBackoff: 2,

    // Recovery
    enableAutoRecovery: true,
    recoveryCheckInterval: 60000, // 1 minute

    // Logging
    logErrors: true,
    errorLogLevel: 'error',
    includeStackTrace: process.env.NODE_ENV === 'development',
  },

  // Debug Settings
  debug: {
    enabled: process.env.NODE_ENV === 'development',
    logLevel: 'info', // 'debug' | 'info' | 'warn' | 'error'
    logFileChanges: false,
    logGitOperations: false,
    logEventFlow: false,
    logPerformanceMetrics: false,

    // Test mode settings
    testMode: process.env.NODE_ENV === 'test',
    mockFileSystem: false,
    mockGitOperations: false,
  },
} as const;

// Type exports for better type safety
export type TrackingConfig = typeof TRACKING_CONFIG;
export type ChangeDetectionConfig = typeof TRACKING_CONFIG.changeDetection;
export type FileTrackingConfig = typeof TRACKING_CONFIG.fileTracking;
export type GitIntegrationConfig = typeof TRACKING_CONFIG.gitIntegration;
export type EventsConfig = typeof TRACKING_CONFIG.events;
export type ActivityLogConfig = typeof TRACKING_CONFIG.activityLog;

// Helper function to get config with overrides (useful for testing)
export function getTrackingConfig(overrides?: Partial<TrackingConfig>): TrackingConfig {
  if (!overrides) {
    return TRACKING_CONFIG;
  }

  return {
    ...TRACKING_CONFIG,
    ...overrides,
    changeDetection: {
      ...TRACKING_CONFIG.changeDetection,
      ...(overrides.changeDetection || {}),
    },
    remoteChangeDetection: {
      ...TRACKING_CONFIG.remoteChangeDetection,
      ...(overrides.remoteChangeDetection || {}),
    },
    fileTracking: {
      ...TRACKING_CONFIG.fileTracking,
      ...(overrides.fileTracking || {}),
    },
    gitIntegration: {
      ...TRACKING_CONFIG.gitIntegration,
      ...(overrides.gitIntegration || {}),
    },
    lineChanges: {
      ...TRACKING_CONFIG.lineChanges,
      ...(overrides.lineChanges || {}),
    },
    activityLog: {
      ...TRACKING_CONFIG.activityLog,
      ...(overrides.activityLog || {}),
    },
    events: {
      ...TRACKING_CONFIG.events,
      ...(overrides.events || {}),
    },
    attribution: {
      ...TRACKING_CONFIG.attribution,
      ...(overrides.attribution || {}),
    },
    performance: {
      ...TRACKING_CONFIG.performance,
      ...(overrides.performance || {}),
    },
    errorHandling: {
      ...TRACKING_CONFIG.errorHandling,
      ...(overrides.errorHandling || {}),
    },
    debug: {
      ...TRACKING_CONFIG.debug,
      ...(overrides.debug || {}),
    },
  };
}

// Environment-specific config adjustments
export function getEnvironmentConfig(): any {
  const env = process.env.NODE_ENV;

  switch (env) {
    case 'production':
      return {
        debug: {
          ...TRACKING_CONFIG.debug,
          enabled: false,
          logLevel: 'warn' as any,
        },
        performance: {
          ...TRACKING_CONFIG.performance,
          metricsInterval: 300000 as any, // 5 minutes in production
        },
      };

    case 'test':
      return {
        changeDetection: {
          ...TRACKING_CONFIG.changeDetection,
          gitPollingInterval: 100 as any, // Faster for tests
          immediateCheckDebounce: 10 as any,
        },
        events: {
          ...TRACKING_CONFIG.events,
          persistEvents: false as any, // Don't persist in tests
          batchInterval: 10 as any, // Faster batching for tests
        },
        debug: {
          ...TRACKING_CONFIG.debug,
          testMode: true as any,
          mockFileSystem: true as any,
          mockGitOperations: true as any,
        },
      };

    default:
      return {};
  }
}

// Get final config with environment adjustments
export function getFinalTrackingConfig(): TrackingConfig {
  return getTrackingConfig(getEnvironmentConfig());
}
