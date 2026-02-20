/**
 * Streaming Configuration Service
 *
 * Provides configurable timeouts and settings for streaming operations.
 * Allows dynamic adjustment based on use case and network conditions.
 */

import { Logger } from '$shared/logger';

const logger = new Logger('StreamingConfig');

export interface StreamingTimeoutConfig {
  // Completion detection timeout (ms)
  completionDetection: number;
  // Stalled stream detection timeout (ms)
  stalledStreamDetection: number;
  // Chunk flush interval (ms)
  chunkFlushInterval: number;
  // Save interval during streaming (ms)
  saveInterval: number;
  // Maximum time to wait for a stream to complete (ms)
  maxStreamDuration: number;
  // Time to wait before considering a stream abandoned (ms)
  abandonedStreamTimeout: number;
  // Progressive backoff multiplier for retries
  backoffMultiplier: number;
  // Maximum backoff time (ms)
  maxBackoffTime: number;
}

export interface StreamingProfile {
  name: string;
  description: string;
  config: StreamingTimeoutConfig;
}

// Predefined profiles for different use cases
// NOTE: Timeouts are set generously to allow agents to work as long as they need.
// Streams should complete naturally when the agent finishes, not be forcibly terminated.
// Stalled stream detection is only for truly dead streams (no activity at all).
const STREAMING_PROFILES: Record<string, StreamingProfile> = {
  fast: {
    name: 'Fast',
    description: 'Quick responses, suitable for simple queries',
    config: {
      // NOTE: Even "fast" profile needs generous timeouts because tool calls
      // can take a long time (e.g., cloning repos, running builds).
      // 5 minutes allows for long tool executions between streaming chunks.
      completionDetection: 5 * 60 * 1000, // 5 minutes - tools can take time
      stalledStreamDetection: 2 * 60 * 1000, // 2 minutes
      chunkFlushInterval: 16, // Match backend's 16ms for snappy feel
      saveInterval: 3000,
      maxStreamDuration: 30 * 60 * 1000, // 30 minutes - allow long tasks
      abandonedStreamTimeout: 10 * 60 * 1000, // 10 minutes
      backoffMultiplier: 1.5,
      maxBackoffTime: 2 * 60 * 1000,
    },
  },
  standard: {
    name: 'Standard',
    description: 'Balanced settings for most use cases',
    config: {
      // Allow 5 minutes of inactivity before assuming stream is stalled
      // This is only for detecting truly dead streams, not for limiting work time
      completionDetection: 5 * 60 * 1000, // 5 minutes
      stalledStreamDetection: 2 * 60 * 1000, // 2 minutes
      chunkFlushInterval: 25,
      saveInterval: 5000,
      maxStreamDuration: 30 * 60 * 1000, // 30 minutes - agents can work as long as needed
      abandonedStreamTimeout: 10 * 60 * 1000, // 10 minutes
      backoffMultiplier: 1.5,
      maxBackoffTime: 2 * 60 * 1000,
    },
  },
  longRunning: {
    name: 'Long Running',
    description: 'Extended timeouts for complex operations',
    config: {
      // Very generous timeouts for long-running operations
      completionDetection: 10 * 60 * 1000, // 10 minutes
      stalledStreamDetection: 5 * 60 * 1000, // 5 minutes
      chunkFlushInterval: 50,
      saveInterval: 10000,
      maxStreamDuration: 2 * 60 * 60 * 1000, // 2 hours
      abandonedStreamTimeout: 30 * 60 * 1000, // 30 minutes
      backoffMultiplier: 2,
      maxBackoffTime: 5 * 60 * 1000,
    },
  },
  toolHeavy: {
    name: 'Tool Heavy',
    description: 'Optimized for operations with many tool calls',
    config: {
      // Tool-heavy operations may have long gaps between tool calls
      completionDetection: 10 * 60 * 1000, // 10 minutes
      stalledStreamDetection: 5 * 60 * 1000, // 5 minutes
      chunkFlushInterval: 35,
      saveInterval: 7500,
      maxStreamDuration: 60 * 60 * 1000, // 1 hour
      abandonedStreamTimeout: 20 * 60 * 1000, // 20 minutes
      backoffMultiplier: 2,
      maxBackoffTime: 5 * 60 * 1000,
    },
  },
};

export class StreamingConfigService {
  private static instance: StreamingConfigService;
  private currentProfile: string = 'standard';
  private customConfig?: Partial<StreamingTimeoutConfig>;
  private sessionProfiles = new Map<string, string>();

  private constructor() {
    this.loadSavedProfile();
  }

  static getInstance(): StreamingConfigService {
    if (!StreamingConfigService.instance) {
      StreamingConfigService.instance = new StreamingConfigService();
    }
    return StreamingConfigService.instance;
  }

  /**
   * Get current configuration
   */
  getConfig(): StreamingTimeoutConfig {
    const baseConfig = STREAMING_PROFILES[this.currentProfile].config;

    // Apply custom overrides if any
    if (this.customConfig) {
      return { ...baseConfig, ...this.customConfig };
    }

    return baseConfig;
  }

  /**
   * Get configuration for a specific session
   */
  getSessionConfig(sessionId: string): StreamingTimeoutConfig {
    const profileName = this.sessionProfiles.get(sessionId) || this.currentProfile;
    const baseConfig = STREAMING_PROFILES[profileName].config;

    // Apply custom overrides if any
    if (this.customConfig) {
      return { ...baseConfig, ...this.customConfig };
    }

    return baseConfig;
  }

  /**
   * Set profile for all sessions
   */
  setProfile(profileName: string): void {
    if (!STREAMING_PROFILES[profileName]) {
      logger.warn(`Unknown profile: ${profileName}, using standard`);
      profileName = 'standard';
    }

    this.currentProfile = profileName;
    this.saveProfile();

    logger.info(`Streaming profile set to: ${profileName}`, {
      config: STREAMING_PROFILES[profileName].config,
    });
  }

  /**
   * Set profile for a specific session
   */
  setSessionProfile(sessionId: string, profileName: string): void {
    if (!STREAMING_PROFILES[profileName]) {
      logger.warn(`Unknown profile: ${profileName}, using standard`);
      profileName = 'standard';
    }

    this.sessionProfiles.set(sessionId, profileName);

    logger.info(`Session ${sessionId} profile set to: ${profileName}`);
  }

  /**
   * Apply custom configuration overrides
   */
  setCustomConfig(config: Partial<StreamingTimeoutConfig>): void {
    this.customConfig = config;

    logger.info('Custom streaming config applied', config);
  }

  /**
   * Reset to default configuration
   */
  resetConfig(): void {
    this.customConfig = undefined;
    this.currentProfile = 'standard';
    this.sessionProfiles.clear();
    this.saveProfile();

    logger.info('Streaming config reset to defaults');
  }

  /**
   * Get available profiles
   */
  getProfiles(): StreamingProfile[] {
    return Object.values(STREAMING_PROFILES);
  }

  /**
   * Get current profile name
   */
  getCurrentProfile(): string {
    return this.currentProfile;
  }

  /**
   * Calculate backoff time for retries
   */
  calculateBackoff(attemptNumber: number, sessionId?: string): number {
    const config = sessionId ? this.getSessionConfig(sessionId) : this.getConfig();

    const backoffTime = Math.min(
      Math.pow(config.backoffMultiplier, attemptNumber) * 1000,
      config.maxBackoffTime,
    );

    return backoffTime;
  }

  /**
   * Check if a stream should be considered stalled
   */
  isStreamStalled(lastActivityTime: number, sessionId?: string): boolean {
    const config = sessionId ? this.getSessionConfig(sessionId) : this.getConfig();
    const timeSinceActivity = Date.now() - lastActivityTime;

    return timeSinceActivity > config.stalledStreamDetection;
  }

  /**
   * Check if a stream should be abandoned
   */
  shouldAbandonStream(startTime: number, sessionId?: string): boolean {
    const config = sessionId ? this.getSessionConfig(sessionId) : this.getConfig();
    const streamDuration = Date.now() - startTime;

    return streamDuration > config.maxStreamDuration;
  }

  /**
   * Load saved profile from localStorage
   */
  private loadSavedProfile(): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = localStorage.getItem('streaming-profile');
      if (saved && STREAMING_PROFILES[saved]) {
        this.currentProfile = saved;
      }
    }
  }

  /**
   * Save current profile to localStorage
   */
  private saveProfile(): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem('streaming-profile', this.currentProfile);
    }
  }

  /**
   * Clean up session-specific configurations
   */
  cleanupSession(sessionId: string): void {
    this.sessionProfiles.delete(sessionId);
  }
}

// Export singleton instance
export const streamingConfig = StreamingConfigService.getInstance();
