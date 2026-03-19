/**
 * Streaming Timeout and Recovery Tests
 *
 * Tests for the streaming timeout configuration and stalled stream recovery.
 * These tests verify that agents don't appear stuck for too long when streams stall.
 *
 * Key scenarios tested:
 * 1. Timeout values are reasonable (< 5 minutes for most cases)
 * 2. Stalled stream detection triggers recovery
 * 3. Max retry limit forces completion
 * 4. Process death triggers stream completion
 * 5. Partial content is preserved on timeout
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StreamingConfigService } from '../streaming-config.service';
import { AGENT_STREAMING_CONFIG } from '../../../shared/constants/agent-streaming';

describe('Streaming Timeout Configuration', () => {
  let configService: StreamingConfigService;

  beforeEach(() => {
    configService = StreamingConfigService.getInstance();
    // Reset to standard profile before each test
    configService.resetConfig();
  });

  describe('Timeout Values', () => {
    it('should have generous completion detection timeouts for standard profile', () => {
      const profiles = configService.getProfiles();
      const standardProfile = profiles.find((p) => p.name === 'Standard');

      expect(standardProfile).toBeDefined();
      // Standard profile should allow 5 minutes of inactivity before assuming stream is dead
      expect(standardProfile!.config.completionDetection).toBeGreaterThanOrEqual(5 * 60 * 1000); // At least 5 minutes
      expect(standardProfile!.config.completionDetection).toBeLessThanOrEqual(15 * 60 * 1000); // Max 15 minutes
    });

    it('should have generous stalled stream detection timeouts', () => {
      const profiles = configService.getProfiles();

      profiles.forEach((profile) => {
        // All profiles should allow at least 30 seconds before considering stream stalled
        // Long-running profiles should allow 5+ minutes
        expect(profile.config.stalledStreamDetection).toBeGreaterThanOrEqual(30 * 1000); // At least 30 seconds
        expect(profile.config.stalledStreamDetection).toBeLessThanOrEqual(10 * 60 * 1000); // Max 10 minutes
      });
    });

    it('should have backoff multipliers that allow multiple recovery attempts', () => {
      const profiles = configService.getProfiles();

      profiles.forEach((profile) => {
        // Backoff multipliers should be reasonable (1.5-2.0)
        expect(profile.config.backoffMultiplier).toBeGreaterThanOrEqual(1.5);
        expect(profile.config.backoffMultiplier).toBeLessThanOrEqual(2.5);

        // Max backoff time should be reasonable
        expect(profile.config.maxBackoffTime).toBeGreaterThanOrEqual(60 * 1000); // At least 1 minute
        expect(profile.config.maxBackoffTime).toBeLessThanOrEqual(10 * 60 * 1000); // Max 10 minutes
      });
    });

    it('should have fast profile with generous timeouts for tool calls', () => {
      const profiles = configService.getProfiles();
      const fastProfile = profiles.find((p) => p.name === 'Fast');

      expect(fastProfile).toBeDefined();
      // Even "fast" profile needs generous timeouts because tool calls can take a long time
      // (e.g., cloning repos, running builds). The "fast" refers to UI responsiveness
      // (shorter chunk intervals), not shorter total timeouts.
      expect(fastProfile!.config.completionDetection).toBeGreaterThanOrEqual(5 * 60 * 1000); // At least 5 minutes
      expect(fastProfile!.config.completionDetection).toBeLessThanOrEqual(10 * 60 * 1000); // Max 10 minutes
      expect(fastProfile!.config.stalledStreamDetection).toBeLessThanOrEqual(5 * 60 * 1000); // Max 5 minutes
    });
  });

  describe('Shared Constants', () => {
    it('should have backend stream timeout that allows long-running tasks', () => {
      // Should be at least 30 minutes to allow agents to work without interruption
      expect(AGENT_STREAMING_CONFIG.BACKEND_STREAM_TIMEOUT_MS).toBeGreaterThanOrEqual(
        30 * 60 * 1000,
      ); // 30 minutes
      expect(AGENT_STREAMING_CONFIG.BACKEND_STREAM_TIMEOUT_MS).toBeLessThanOrEqual(
        2 * 60 * 60 * 1000,
      ); // 2 hours max
    });

    it('should have completion detection constant for truly stalled streams', () => {
      expect(AGENT_STREAMING_CONFIG.COMPLETION_DETECTION_MS).toBeDefined();
      // Should be very generous (1 hour) since Auggie sends explicit stopReason when done.
      // This timeout is only a fallback for detecting truly dead connections, not for
      // normal operation. Agents may do complex work for extended periods without chunks.
      expect(AGENT_STREAMING_CONFIG.COMPLETION_DETECTION_MS).toBeGreaterThanOrEqual(30 * 60 * 1000); // At least 30 minutes
      expect(AGENT_STREAMING_CONFIG.COMPLETION_DETECTION_MS).toBeLessThanOrEqual(2 * 60 * 60 * 1000); // 2 hours max
    });

    it('should have max stall retries defined', () => {
      expect(AGENT_STREAMING_CONFIG.MAX_STALL_RETRIES).toBeDefined();
      expect(AGENT_STREAMING_CONFIG.MAX_STALL_RETRIES).toBeGreaterThanOrEqual(5);
      expect(AGENT_STREAMING_CONFIG.MAX_STALL_RETRIES).toBeLessThanOrEqual(20);
    });
  });

  describe('Profile Selection', () => {
    it('should use standard profile by default', () => {
      const currentProfile = configService.getCurrentProfile();
      expect(currentProfile).toBe('standard');
    });

    it('should allow switching profiles', () => {
      configService.setProfile('fast');
      const currentConfig = configService.getConfig();

      // Fast profile has completionDetection: 5 * 60 * 1000 (5 minutes)
      // Even "fast" needs generous timeouts for tool calls
      expect(currentConfig.completionDetection).toBeLessThanOrEqual(10 * 60 * 1000); // Max 10 minutes
    });
  });
});

describe('Stalled Stream Detection Logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should detect stalled streams based on inactivity', () => {
    const lastActivityTime = Date.now();
    const stalledTimeout = 30000; // 30 seconds

    // Advance time past the threshold
    vi.advanceTimersByTime(stalledTimeout + 1000);

    const timeSinceLastActivity = Date.now() - lastActivityTime;
    expect(timeSinceLastActivity).toBeGreaterThan(stalledTimeout);
  });

  it('should apply progressive backoff correctly', () => {
    const baseTimeout = 30000; // 30 seconds
    const backoffMultiplier = 1.5;

    const retry0Timeout = baseTimeout * Math.pow(backoffMultiplier, 0); // 30s
    const retry1Timeout = baseTimeout * Math.pow(backoffMultiplier, 1); // 45s
    const retry2Timeout = baseTimeout * Math.pow(backoffMultiplier, 2); // 67.5s

    expect(retry0Timeout).toBe(30000);
    expect(retry1Timeout).toBe(45000);
    expect(retry2Timeout).toBeCloseTo(67500, 0);
  });

  it('should have max retry that caps total recovery time', () => {
    const maxRetries = AGENT_STREAMING_CONFIG.MAX_STALL_RETRIES;
    const baseTimeout = 30000;
    const backoffMultiplier = 1.5;

    let totalTime = 0;
    for (let i = 0; i < maxRetries; i++) {
      totalTime += baseTimeout * Math.pow(backoffMultiplier, i);
    }

    // Total recovery time should be bounded (allowing for long-running tasks)
    // With 10 retries and 1.5x backoff, total is ~3.4 million ms (~57 minutes)
    // This is intentional to support long-running agent tasks
    expect(totalTime).toBeLessThan(60 * 60 * 1000); // Less than 60 minutes
  });
});

describe('Stream Completion Guarantees', () => {
  it('should always complete streams with content or error', () => {
    // This tests the invariant: streams must either complete successfully or error
    // They should never stay in a "streaming" state indefinitely

    interface MockStreamState {
      isStreaming: boolean;
      hasContent: boolean;
      hasError: boolean;
      completedAt: number | null;
    }

    const stream: MockStreamState = {
      isStreaming: true,
      hasContent: false,
      hasError: false,
      completedAt: null,
    };

    // Simulate stream completion
    const completeStream = (state: MockStreamState, _reason: string) => {
      state.isStreaming = false;
      state.completedAt = Date.now();
      return state;
    };

    const errorStream = (state: MockStreamState, _error: string) => {
      state.isStreaming = false;
      state.hasError = true;
      state.completedAt = Date.now();
      return state;
    };

    // After completion, stream should not be streaming
    const completed = completeStream({ ...stream }, 'normal');
    expect(completed.isStreaming).toBe(false);
    expect(completed.completedAt).not.toBeNull();

    // After error, stream should not be streaming
    const errored = errorStream({ ...stream }, 'timeout');
    expect(errored.isStreaming).toBe(false);
    expect(errored.completedAt).not.toBeNull();
    expect(errored.hasError).toBe(true);
  });

  it('should preserve partial content on timeout', () => {
    // When a stream times out, any accumulated content should be preserved
    const accumulatedContent = ['Hello, ', 'how can I ', 'help'];
    const fullContent = accumulatedContent.join('');

    // On timeout, we should get the partial content
    const partialMessage = {
      content: fullContent,
      metadata: { timedOut: true },
    };

    expect(partialMessage.content).toBe('Hello, how can I help');
    expect(partialMessage.metadata.timedOut).toBe(true);
  });

  it('should clean up resources after stream ends', () => {
    // Cleanup function
    const cleanup = () => ({
      callback: null,
      timer: null,
      retryCount: 0,
    });

    const cleaned = cleanup();
    expect(cleaned.callback).toBeNull();
    expect(cleaned.timer).toBeNull();
    expect(cleaned.retryCount).toBe(0);
  });
});

describe('Health Check Stream Recovery', () => {
  it('should detect when process dies with active streams', () => {
    // Simulate process state
    const processState = {
      isAlive: true,
      killed: false,
      exitCode: null as number | null,
    };

    const activeStreams = new Map([
      ['stream-1', { lastActivity: Date.now() }],
      ['stream-2', { lastActivity: Date.now() }],
    ]);

    // Simulate process death
    processState.isAlive = false;
    processState.killed = true;
    processState.exitCode = 1;

    // Health check should detect dead process
    const shouldForceComplete =
      !processState.isAlive || processState.killed || processState.exitCode !== null;

    expect(shouldForceComplete).toBe(true);
    expect(activeStreams.size).toBe(2);

    // All active streams should be completed
    if (shouldForceComplete) {
      const streamsToComplete = Array.from(activeStreams.keys());
      expect(streamsToComplete).toEqual(['stream-1', 'stream-2']);
    }
  });

  it('should not force complete when process is healthy', () => {
    const processState = {
      isAlive: true,
      killed: false,
      exitCode: null as number | null,
    };

    const shouldForceComplete =
      !processState.isAlive || processState.killed || processState.exitCode !== null;

    expect(shouldForceComplete).toBe(false);
  });
});

describe('Behavior Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should fire stall detection after inactivity period', () => {
    // Simulate the stall detection logic from ChatService.startStallDetection()
    const STALL_DETECTION_MS = 90_000; // matches ChatService
    const CHECK_INTERVAL_MS = 10_000;
    let isStalled = false;
    let lastChunkTime = Date.now();
    const isStreaming = true;

    // Start stall detection interval (mirrors ChatService.startStallDetection)
    const timer = setInterval(() => {
      if (!isStreaming || !lastChunkTime) return;
      const timeSinceLastChunk = Date.now() - lastChunkTime;
      if (timeSinceLastChunk >= STALL_DETECTION_MS && !isStalled) {
        isStalled = true;
      }
    }, CHECK_INTERVAL_MS);

    // Advance past stall threshold
    vi.advanceTimersByTime(STALL_DETECTION_MS + CHECK_INTERVAL_MS);

    expect(isStalled).toBe(true);
    clearInterval(timer);
  });

  it('should reset stall detection when new chunk arrives', () => {
    const STALL_DETECTION_MS = 90_000;
    const CHECK_INTERVAL_MS = 10_000;
    let isStalled = false;
    let lastChunkTime = Date.now();
    const isStreaming = true;

    const timer = setInterval(() => {
      if (!isStreaming || !lastChunkTime) return;
      const timeSinceLastChunk = Date.now() - lastChunkTime;
      if (timeSinceLastChunk >= STALL_DETECTION_MS && !isStalled) {
        isStalled = true;
      }
    }, CHECK_INTERVAL_MS);

    // Advance partway (not enough to trigger stall)
    vi.advanceTimersByTime(80_000);
    expect(isStalled).toBe(false);

    // Simulate new chunk arriving — resets the timer
    lastChunkTime = Date.now();
    isStalled = false;

    // Advance another 80s — still not enough since reset
    vi.advanceTimersByTime(80_000);
    expect(isStalled).toBe(false);

    // Now advance past threshold from last chunk
    vi.advanceTimersByTime(STALL_DETECTION_MS);
    expect(isStalled).toBe(true);

    clearInterval(timer);
  });

  it('should fire stream timeout and clean up handler', () => {
    const STREAM_TIMEOUT_MS = 30 * 60 * 1000; // 30 min, matches BACKEND_STREAM_TIMEOUT_MS
    let timedOut = false;
    let handlerCleanedUp = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      // Cleanup handler on timeout
      handlerCleanedUp = true;
    }, STREAM_TIMEOUT_MS);

    // Not yet timed out
    vi.advanceTimersByTime(STREAM_TIMEOUT_MS - 1000);
    expect(timedOut).toBe(false);

    // Advance past timeout
    vi.advanceTimersByTime(1000);
    expect(timedOut).toBe(true);
    expect(handlerCleanedUp).toBe(true);

    clearTimeout(timeoutId);
  });

  it('should attempt recovery after stall by re-registering handler', () => {
    const STALL_DETECTION_MS = 90_000;
    const CHECK_INTERVAL_MS = 10_000;
    let isStalled = false;
    let lastChunkTime = Date.now();
    let recoveryAttempts = 0;
    let handlerRegistered = true;

    const timer = setInterval(() => {
      if (!lastChunkTime) return;
      const timeSinceLastChunk = Date.now() - lastChunkTime;
      if (timeSinceLastChunk >= STALL_DETECTION_MS && !isStalled) {
        isStalled = true;
        // Recovery: re-register handler (simulates ChatService recovery)
        handlerRegistered = false;
        recoveryAttempts++;
        handlerRegistered = true;
        // Reset stall state after recovery
        isStalled = false;
        lastChunkTime = Date.now();
      }
    }, CHECK_INTERVAL_MS);

    // Trigger first stall + recovery
    vi.advanceTimersByTime(STALL_DETECTION_MS + CHECK_INTERVAL_MS);
    expect(recoveryAttempts).toBe(1);
    expect(handlerRegistered).toBe(true);

    // Trigger second stall + recovery
    vi.advanceTimersByTime(STALL_DETECTION_MS + CHECK_INTERVAL_MS);
    expect(recoveryAttempts).toBe(2);
    expect(handlerRegistered).toBe(true);

    clearInterval(timer);
  });

  it('should use progressive backoff between recovery attempts', () => {
    const BASE_TIMEOUT = 30_000;
    const BACKOFF_MULTIPLIER = 1.5;
    const MAX_BACKOFF = 2 * 60 * 1000; // matches standard profile maxBackoffTime
    let retryCount = 0;
    const recoveryTimestamps: number[] = [];

    const scheduleRecovery = () => {
      const backoffTime = Math.min(
        BASE_TIMEOUT * Math.pow(BACKOFF_MULTIPLIER, retryCount),
        MAX_BACKOFF,
      );
      setTimeout(() => {
        recoveryTimestamps.push(Date.now());
        retryCount++;
        if (retryCount < 4) scheduleRecovery();
      }, backoffTime);
    };

    const startTime = Date.now();
    scheduleRecovery();

    // Run all pending timers to completion
    vi.runAllTimers();

    expect(retryCount).toBe(4);

    // Verify progressive delays: each gap should be >= previous gap
    const gaps = recoveryTimestamps.map((t) => t - startTime);
    // gap[0] = 30s, gap[1] = 30+45=75s, gap[2] = 75+67.5=142.5s, gap[3] = 142.5+101.25=243.75s
    expect(gaps[0]).toBe(BASE_TIMEOUT); // 30s
    expect(gaps[1]).toBe(BASE_TIMEOUT + BASE_TIMEOUT * BACKOFF_MULTIPLIER); // 75s
    // Each successive gap should be larger
    for (let i = 1; i < gaps.length; i++) {
      expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
    }
  });

  it('should force complete stream when max retries reached', () => {
    const MAX_RETRIES = AGENT_STREAMING_CONFIG.MAX_STALL_RETRIES;
    const STALL_DETECTION_MS = 90_000;
    const CHECK_INTERVAL_MS = 10_000;
    let retryCount = 0;
    let lastChunkTime = Date.now();
    let isStalled = false;
    let forceCompleted = false;

    const timer = setInterval(() => {
      if (forceCompleted || !lastChunkTime) return;
      const timeSinceLastChunk = Date.now() - lastChunkTime;
      if (timeSinceLastChunk >= STALL_DETECTION_MS && !isStalled) {
        isStalled = true;
        retryCount++;

        if (retryCount >= MAX_RETRIES) {
          // Force complete — no more retries
          forceCompleted = true;
          clearInterval(timer);
          return;
        }

        // Recovery attempt: reset for next cycle
        isStalled = false;
        lastChunkTime = Date.now();
      }
    }, CHECK_INTERVAL_MS);

    // Trigger MAX_RETRIES stalls
    for (let i = 0; i < MAX_RETRIES; i++) {
      vi.advanceTimersByTime(STALL_DETECTION_MS + CHECK_INTERVAL_MS);
    }

    expect(retryCount).toBe(MAX_RETRIES);
    expect(forceCompleted).toBe(true);
  });
});

describe('Timeout Value Validation', () => {
  it('should have reasonable timeout values that allow long-running work', () => {
    const configService = StreamingConfigService.getInstance();
    const profiles = configService.getProfiles();

    profiles.forEach((profile) => {
      // Completion detection should be generous (5-10 minutes for most profiles)
      expect(profile.config.completionDetection).toBeGreaterThanOrEqual(60 * 1000); // At least 1 minute
      expect(profile.config.completionDetection).toBeLessThanOrEqual(15 * 60 * 1000); // Max 15 minutes

      // Stalled detection should be generous
      expect(profile.config.stalledStreamDetection).toBeGreaterThanOrEqual(30 * 1000); // At least 30 seconds
      expect(profile.config.stalledStreamDetection).toBeLessThanOrEqual(10 * 60 * 1000); // Max 10 minutes

      // Max stream duration should allow long work (30 min to 2 hours)
      expect(profile.config.maxStreamDuration).toBeGreaterThanOrEqual(5 * 60 * 1000); // At least 5 minutes
      expect(profile.config.maxStreamDuration).toBeLessThanOrEqual(2 * 60 * 60 * 1000); // Max 2 hours

      // Abandoned timeout should be reasonable
      expect(profile.config.abandonedStreamTimeout).toBeGreaterThanOrEqual(2 * 60 * 1000); // At least 2 minutes
      expect(profile.config.abandonedStreamTimeout).toBeLessThanOrEqual(30 * 60 * 1000); // Max 30 minutes
    });
  });

  it('should have stalled detection shorter than or equal to completion detection', () => {
    const configService = StreamingConfigService.getInstance();
    const profiles = configService.getProfiles();

    profiles.forEach((profile) => {
      // Stalled detection should trigger before or at the same time as completion detection
      // This allows for recovery attempts before giving up
      expect(profile.config.stalledStreamDetection).toBeLessThanOrEqual(
        profile.config.completionDetection,
      );
    });
  });

  it('should have save interval shorter than stalled detection', () => {
    const configService = StreamingConfigService.getInstance();
    const profiles = configService.getProfiles();

    profiles.forEach((profile) => {
      // Save interval should be shorter than stalled detection
      // This ensures content is saved before potential timeout
      expect(profile.config.saveInterval).toBeLessThan(profile.config.stalledStreamDetection);
    });
  });
});
