/**
 * Streaming configuration types, constants, and pure helpers.
 *
 * This module is safe for main, renderer, preload, and shared imports.
 */

export type StreamingTimeoutConfig = {
  /** Completion detection timeout (ms) */
  completionDetection: number;
  /** Stalled stream detection timeout (ms) */
  stalledStreamDetection: number;
  /** Chunk flush interval (ms) */
  chunkFlushInterval: number;
  /** Save interval during streaming (ms) */
  saveInterval: number;
  /** Maximum time to wait for a stream to complete (ms) */
  maxStreamDuration: number;
  /** Time to wait before considering a stream abandoned (ms) */
  abandonedStreamTimeout: number;
  /** Progressive backoff multiplier for retries */
  backoffMultiplier: number;
  /** Maximum backoff time (ms) */
  maxBackoffTime: number;
};

export type StreamingProfile = {
  name: string;
  description: string;
  config: StreamingTimeoutConfig;
};

export type StreamingProfileName = 'fast' | 'standard' | 'longRunning' | 'toolHeavy';

export const STREAMING_PROFILES: Record<StreamingProfileName, StreamingProfile> = {
  fast: {
    name: 'Fast',
    description: 'Quick responses, suitable for simple queries',
    config: {
      completionDetection: 5 * 60 * 1000,
      stalledStreamDetection: 2 * 60 * 1000,
      chunkFlushInterval: 16,
      saveInterval: 3000,
      maxStreamDuration: 30 * 60 * 1000,
      abandonedStreamTimeout: 10 * 60 * 1000,
      backoffMultiplier: 1.5,
      maxBackoffTime: 2 * 60 * 1000,
    },
  },
  standard: {
    name: 'Standard',
    description: 'Balanced settings for most use cases',
    config: {
      completionDetection: 5 * 60 * 1000,
      stalledStreamDetection: 2 * 60 * 1000,
      chunkFlushInterval: 25,
      saveInterval: 5000,
      maxStreamDuration: 30 * 60 * 1000,
      abandonedStreamTimeout: 10 * 60 * 1000,
      backoffMultiplier: 1.5,
      maxBackoffTime: 2 * 60 * 1000,
    },
  },
  longRunning: {
    name: 'Long Running',
    description: 'Extended timeouts for complex operations',
    config: {
      completionDetection: 10 * 60 * 1000,
      stalledStreamDetection: 5 * 60 * 1000,
      chunkFlushInterval: 50,
      saveInterval: 10000,
      maxStreamDuration: 2 * 60 * 60 * 1000,
      abandonedStreamTimeout: 30 * 60 * 1000,
      backoffMultiplier: 2,
      maxBackoffTime: 5 * 60 * 1000,
    },
  },
  toolHeavy: {
    name: 'Tool Heavy',
    description: 'Optimized for operations with many tool calls',
    config: {
      completionDetection: 10 * 60 * 1000,
      stalledStreamDetection: 5 * 60 * 1000,
      chunkFlushInterval: 35,
      saveInterval: 7500,
      maxStreamDuration: 60 * 60 * 1000,
      abandonedStreamTimeout: 20 * 60 * 1000,
      backoffMultiplier: 2,
      maxBackoffTime: 5 * 60 * 1000,
    },
  },
};

export const DEFAULT_PROFILE: StreamingProfileName = 'standard';

export const STREAMING_PROFILE_STORAGE_KEY = 'streaming-profile';

export type StreamingConfigState = {
  currentProfile: StreamingProfileName;
  customConfig: Partial<StreamingTimeoutConfig> | null;
  /** Session-specific profile overrides (sessionId → profileName) */
  sessionProfiles: Record<string, StreamingProfileName>;
};

export function resolveStreamingConfig(
  profileName: StreamingProfileName,
  customConfig?: Partial<StreamingTimeoutConfig> | null,
): StreamingTimeoutConfig {
  const baseConfig = STREAMING_PROFILES[profileName]?.config ?? STREAMING_PROFILES.standard.config;
  if (customConfig) {
    return { ...baseConfig, ...customConfig };
  }
  return baseConfig;
}

export function calculateBackoff(
  attemptNumber: number,
  config: StreamingTimeoutConfig,
): number {
  return Math.min(
    Math.pow(config.backoffMultiplier, attemptNumber) * 1000,
    config.maxBackoffTime,
  );
}