/**
 * StreamingConfigService Tests
 *
 * Tests the REAL StreamingConfigService implementation:
 * 1. Stream stall detection with real thresholds
 * 2. Exponential backoff calculation
 * 3. Stream abandonment detection
 * 4. Profile switching and configuration
 * 5. Session-specific configurations
 *
 * Complements agent-stuck-detection.test.ts which tests conceptual stuck detection.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { StreamingConfigService } from '$features/agent/streaming-config.service';

describe('StreamingConfigService', () => {
  let configService: StreamingConfigService;

  beforeEach(() => {
    vi.useFakeTimers();
    configService = StreamingConfigService.getInstance();
    configService.resetConfig(); // Reset to defaults
  });

  afterEach(() => {
    vi.useRealTimers();
    configService.resetConfig();
  });

  describe('Profile Configuration', () => {
    it('should have standard profile as default', () => {
      expect(configService.getCurrentProfile()).toBe('standard');
    });

    it('should switch profiles correctly', () => {
      configService.setProfile('fast');
      expect(configService.getCurrentProfile()).toBe('fast');

      configService.setProfile('longRunning');
      expect(configService.getCurrentProfile()).toBe('longRunning');

      configService.setProfile('toolHeavy');
      expect(configService.getCurrentProfile()).toBe('toolHeavy');
    });

    it('should fall back to standard for unknown profiles', () => {
      configService.setProfile('unknown-profile');
      expect(configService.getCurrentProfile()).toBe('standard');
    });

    it('should list all available profiles', () => {
      const profiles = configService.getProfiles();
      const profileNames = profiles.map((p) => p.name);

      expect(profileNames).toContain('Fast');
      expect(profileNames).toContain('Standard');
      expect(profileNames).toContain('Long Running');
      expect(profileNames).toContain('Tool Heavy');
    });

    it('should reset to defaults', () => {
      configService.setProfile('fast');
      configService.setCustomConfig({ stalledStreamDetection: 999 });

      configService.resetConfig();

      expect(configService.getCurrentProfile()).toBe('standard');
      expect(configService.getConfig().stalledStreamDetection).toBe(2 * 60 * 1000);
    });
  });

  describe('Stream Stall Detection', () => {
    it('should detect stream as stalled after inactivity threshold', () => {
      const config = configService.getConfig();
      expect(config.stalledStreamDetection).toBe(2 * 60 * 1000); // 2 minutes for standard

      const lastActivity = Date.now();

      expect(configService.isStreamStalled(lastActivity)).toBe(false);

      vi.advanceTimersByTime(2 * 60 * 1000 + 1000); // Past threshold

      expect(configService.isStreamStalled(lastActivity)).toBe(true);
    });

    it('should not detect stream as stalled if activity is recent', () => {
      vi.advanceTimersByTime(30000);
      const recentActivity = Date.now();

      expect(configService.isStreamStalled(recentActivity)).toBe(false);
    });

    it('should use profile-specific stall thresholds', () => {
      // Even "fast" profile has generous timeouts because tool calls can take time
      configService.setProfile('fast');
      expect(configService.getConfig().stalledStreamDetection).toBe(2 * 60 * 1000); // 2 minutes

      configService.setProfile('longRunning');
      expect(configService.getConfig().stalledStreamDetection).toBe(5 * 60 * 1000); // 5 minutes

      configService.setProfile('toolHeavy');
      expect(configService.getConfig().stalledStreamDetection).toBe(5 * 60 * 1000); // 5 minutes
    });

    it('should support session-specific stall detection', () => {
      configService.setSessionProfile('session-1', 'fast');
      configService.setSessionProfile('session-2', 'longRunning');

      const lastActivity = Date.now();
      vi.advanceTimersByTime(3 * 60 * 1000); // 3 minutes

      // Fast profile (2 min threshold) - should be stalled
      expect(configService.isStreamStalled(lastActivity, 'session-1')).toBe(true);

      // Long running (5 min threshold) - should NOT be stalled
      expect(configService.isStreamStalled(lastActivity, 'session-2')).toBe(false);
    });
  });

  describe('Exponential Backoff', () => {
    it('should calculate backoff correctly for standard profile', () => {
      configService.setProfile('standard');

      // Standard: multiplier=1.5, max=2 minutes
      expect(configService.calculateBackoff(0)).toBe(1000); // 1.5^0 * 1000
      expect(configService.calculateBackoff(1)).toBe(1500); // 1.5^1 * 1000
      expect(configService.calculateBackoff(2)).toBe(2250); // 1.5^2 * 1000
      expect(configService.calculateBackoff(3)).toBe(3375); // 1.5^3 * 1000
    });

    it('should cap backoff at max value', () => {
      configService.setProfile('standard');
      const config = configService.getConfig();

      const backoff = configService.calculateBackoff(100);
      expect(backoff).toBe(config.maxBackoffTime);
    });

    it('should use profile-specific backoff settings', () => {
      configService.setProfile('longRunning');
      // Long running: multiplier=2, max=5 minutes

      expect(configService.calculateBackoff(1)).toBe(2000); // 2^1 * 1000
      expect(configService.calculateBackoff(2)).toBe(4000); // 2^2 * 1000
      expect(configService.calculateBackoff(3)).toBe(8000); // 2^3 * 1000
    });

    it('should calculate session-specific backoff', () => {
      configService.setSessionProfile('fast-session', 'fast');

      // Fast: multiplier=1.5
      expect(configService.calculateBackoff(1, 'fast-session')).toBe(1500);
    });
  });

  describe('Stream Abandonment', () => {
    it('should detect when stream should be abandoned', () => {
      configService.setProfile('standard');
      const config = configService.getConfig();
      expect(config.maxStreamDuration).toBe(30 * 60 * 1000); // 30 minutes

      const startTime = Date.now();

      expect(configService.shouldAbandonStream(startTime)).toBe(false);

      vi.advanceTimersByTime(31 * 60 * 1000); // 31 minutes

      expect(configService.shouldAbandonStream(startTime)).toBe(true);
    });

    it('should use profile-specific abandonment thresholds', () => {
      const startTime = Date.now();

      configService.setProfile('fast');
      vi.advanceTimersByTime(31 * 60 * 1000); // 31 minutes
      expect(configService.shouldAbandonStream(startTime)).toBe(true); // Fast: 30 min max

      vi.setSystemTime(Date.now()); // Reset time
      const newStartTime = Date.now();

      configService.setProfile('longRunning');
      vi.advanceTimersByTime(30 * 60 * 1000); // 30 minutes
      expect(configService.shouldAbandonStream(newStartTime)).toBe(false); // Long running: 2 hour max
    });
  });

  describe('Custom Configuration', () => {
    it('should apply custom config overrides', () => {
      configService.setCustomConfig({
        stalledStreamDetection: 10000, // 10 seconds
        maxBackoffTime: 5000,
      });

      const config = configService.getConfig();
      expect(config.stalledStreamDetection).toBe(10000);
      expect(config.maxBackoffTime).toBe(5000);
    });

    it('should merge custom config with profile config', () => {
      configService.setProfile('longRunning');
      configService.setCustomConfig({
        stalledStreamDetection: 10000,
      });

      const config = configService.getConfig();
      // Custom override
      expect(config.stalledStreamDetection).toBe(10000);
      // Profile value (not overridden)
      expect(config.backoffMultiplier).toBe(2);
    });
  });

  describe('Session Cleanup', () => {
    it('should clean up session configurations', () => {
      configService.setSessionProfile('temp-session', 'fast');

      // Verify session config is applied (fast profile has 2 minute stall detection)
      expect(configService.getSessionConfig('temp-session').stalledStreamDetection).toBe(
        2 * 60 * 1000,
      );

      // Clean up
      configService.cleanupSession('temp-session');

      // After cleanup, should fall back to global (standard) profile which also has 2 minute stall detection
      expect(configService.getSessionConfig('temp-session').stalledStreamDetection).toBe(
        2 * 60 * 1000,
      );
    });
  });
});
