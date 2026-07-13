/**
 * Unit tests for the restart policy state machine.
 *
 * Covers backoff progression, cap, healthy-uptime reset, intentional-stop
 * suppression, and give-up on max attempts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RestartPolicy } from './restart-policy';

describe('RestartPolicy', () => {
  let policy: RestartPolicy;

  beforeEach(() => {
    policy = new RestartPolicy();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('exponential backoff', () => {
    it('progresses backoff delays exponentially: 1s → 2s → 4s → 8s → 16s', () => {
      const baseTime = Date.now();
      vi.setSystemTime(baseTime);

      // Attempt 1: 1s
      policy.onSpawn();
      vi.setSystemTime(baseTime + 500); // Crash after 500ms
      const decision1 = policy.onExit(1, null);
      expect(decision1.shouldRestart).toBe(true);
      expect(decision1.delayMs).toBe(1000);

      // Attempt 2: 2s
      vi.setSystemTime(baseTime + 1500);
      policy.onSpawn();
      vi.setSystemTime(baseTime + 2000); // Crash after 500ms
      const decision2 = policy.onExit(1, null);
      expect(decision2.shouldRestart).toBe(true);
      expect(decision2.delayMs).toBe(2000);

      // Attempt 3: 4s
      vi.setSystemTime(baseTime + 4000);
      policy.onSpawn();
      vi.setSystemTime(baseTime + 4500);
      const decision3 = policy.onExit(1, null);
      expect(decision3.shouldRestart).toBe(true);
      expect(decision3.delayMs).toBe(4000);

      // Attempt 4: 8s
      vi.setSystemTime(baseTime + 8500);
      policy.onSpawn();
      vi.setSystemTime(baseTime + 9000);
      const decision4 = policy.onExit(1, null);
      expect(decision4.shouldRestart).toBe(true);
      expect(decision4.delayMs).toBe(8000);

      // Attempt 5: 16s
      vi.setSystemTime(baseTime + 17000);
      policy.onSpawn();
      vi.setSystemTime(baseTime + 17500);
      const decision5 = policy.onExit(1, null);
      expect(decision5.shouldRestart).toBe(true);
      expect(decision5.delayMs).toBe(16000);
    });

    it('caps backoff delay at 30s', () => {
      const baseTime = Date.now();
      vi.setSystemTime(baseTime);

      // Use custom config with higher max attempts to test cap
      const customPolicy = new RestartPolicy({ maxAttempts: 10 });

      // Crash 6 times quickly to reach the cap
      for (let i = 0; i < 5; i++) {
        customPolicy.onSpawn();
        vi.setSystemTime(baseTime + i * 1000 + 500);
        customPolicy.onExit(1, null);
      }

      // Attempt 6 would be 32s (2^5) but should cap at 30s
      customPolicy.onSpawn();
      const decision = customPolicy.onExit(1, null);
      expect(decision.shouldRestart).toBe(true);
      expect(decision.delayMs).toBe(30000);
    });
  });

  describe('max attempts', () => {
    it('gives up after 5 attempts', () => {
      const baseTime = Date.now();
      vi.setSystemTime(baseTime);

      // First 5 attempts should restart
      for (let i = 1; i <= 5; i++) {
        policy.onSpawn();
        vi.setSystemTime(baseTime + i * 1000);
        const decision = policy.onExit(1, null);
        expect(decision.shouldRestart).toBe(true);
        expect(decision.remainingAttempts).toBe(5 - i);
      }

      // 6th attempt should give up
      policy.onSpawn();
      vi.setSystemTime(baseTime + 6000);
      const finalDecision = policy.onExit(1, null);
      expect(finalDecision.shouldRestart).toBe(false);
      expect(finalDecision.reason).toContain('Max restart attempts');
      expect(finalDecision.reason).toContain('5');
    });
  });

  describe('healthy uptime reset', () => {
    it('resets attempt counter after ≥60s healthy uptime', () => {
      const baseTime = Date.now();
      vi.setSystemTime(baseTime);

      // Crash twice quickly
      policy.onSpawn();
      vi.setSystemTime(baseTime + 500);
      const decision1 = policy.onExit(1, null);
      expect(decision1.delayMs).toBe(1000);

      policy.onSpawn();
      vi.setSystemTime(baseTime + 1500);
      const decision2 = policy.onExit(1, null);
      expect(decision2.delayMs).toBe(2000);
      expect(policy.getAttemptCount()).toBe(2);

      // Now run healthy for 60s+ and crash
      policy.onSpawn();
      vi.setSystemTime(baseTime + 63000); // 61.5s uptime
      const decision3 = policy.onExit(1, null);

      // Attempt counter should have been reset, so back to 1s delay
      expect(decision3.delayMs).toBe(1000);
      expect(decision3.reason).toContain('Restart attempt 1/5');
    });

    it('does not reset if uptime is <60s', () => {
      const baseTime = Date.now();
      vi.setSystemTime(baseTime);

      // Crash twice quickly
      policy.onSpawn();
      vi.setSystemTime(baseTime + 500);
      policy.onExit(1, null);

      policy.onSpawn();
      vi.setSystemTime(baseTime + 1500);
      policy.onExit(1, null);
      expect(policy.getAttemptCount()).toBe(2);

      // Run for 59s and crash (just below threshold)
      policy.onSpawn();
      vi.setSystemTime(baseTime + 60500); // 59s uptime
      const decision = policy.onExit(1, null);

      // Should NOT reset, so attempt 3 with 4s delay
      expect(decision.delayMs).toBe(4000);
      expect(decision.reason).toContain('Restart attempt 3/5');
    });
  });

  describe('intentional stop', () => {
    it('suppresses restart after markIntentionalStop', () => {
      policy.onSpawn();
      policy.markIntentionalStop();

      const decision = policy.onExit(0, null);
      expect(decision.shouldRestart).toBe(false);
      expect(decision.reason).toContain('Intentional stop');
    });

    it('resets state after intentional stop', () => {
      const baseTime = Date.now();
      vi.setSystemTime(baseTime);

      // Crash twice to build up attempt count
      policy.onSpawn();
      vi.setSystemTime(baseTime + 500);
      policy.onExit(1, null);

      policy.onSpawn();
      vi.setSystemTime(baseTime + 1500);
      policy.onExit(1, null);
      expect(policy.getAttemptCount()).toBe(2);

      // Intentional stop should reset everything
      policy.markIntentionalStop();
      policy.onExit(0, null);
      expect(policy.getAttemptCount()).toBe(0);
      expect(policy.isIntentionalStop()).toBe(false);
    });
  });

  describe('custom config', () => {
    it('respects custom baseDelayMs', () => {
      const customPolicy = new RestartPolicy({ baseDelayMs: 2000 });
      customPolicy.onSpawn();
      const decision = customPolicy.onExit(1, null);
      expect(decision.delayMs).toBe(2000);
    });

    it('respects custom maxDelayMs', () => {
      const customPolicy = new RestartPolicy({ maxDelayMs: 10000, maxAttempts: 10 });
      // Crash enough times to exceed 10s
      for (let i = 0; i < 4; i++) {
        customPolicy.onSpawn();
        customPolicy.onExit(1, null);
      }
      customPolicy.onSpawn();
      const decision = customPolicy.onExit(1, null);
      expect(decision.shouldRestart).toBe(true);
      expect(decision.delayMs).toBe(10000); // 2^4 = 16s, capped at 10s
    });

    it('respects custom maxAttempts', () => {
      const customPolicy = new RestartPolicy({ maxAttempts: 3 });

      // First 3 attempts should restart
      for (let i = 1; i <= 3; i++) {
        customPolicy.onSpawn();
        const decision = customPolicy.onExit(1, null);
        expect(decision.shouldRestart).toBe(true);
      }

      // 4th should give up
      customPolicy.onSpawn();
      const finalDecision = customPolicy.onExit(1, null);
      expect(finalDecision.shouldRestart).toBe(false);
      expect(finalDecision.reason).toContain('Max restart attempts (3)');
    });

    it('respects custom healthyUptimeMs', () => {
      const customPolicy = new RestartPolicy({ healthyUptimeMs: 30000 });
      const baseTime = Date.now();
      vi.setSystemTime(baseTime);

      // Crash twice
      customPolicy.onSpawn();
      vi.setSystemTime(baseTime + 500);
      customPolicy.onExit(1, null);

      customPolicy.onSpawn();
      vi.setSystemTime(baseTime + 1500);
      customPolicy.onExit(1, null);
      expect(customPolicy.getAttemptCount()).toBe(2);

      // Run for 30s (meets custom threshold)
      customPolicy.onSpawn();
      vi.setSystemTime(baseTime + 31500);
      const decision = customPolicy.onExit(1, null);

      // Should reset
      expect(decision.delayMs).toBe(1000);
      expect(decision.reason).toContain('Restart attempt 1/5');
    });
  });

  describe('reset', () => {
    it('clears all state', () => {
      const baseTime = Date.now();
      vi.setSystemTime(baseTime);

      // Build up some state
      policy.onSpawn();
      vi.setSystemTime(baseTime + 500);
      policy.onExit(1, null);

      policy.onSpawn();
      vi.setSystemTime(baseTime + 1500);
      policy.onExit(1, null);

      policy.markIntentionalStop();
      expect(policy.getAttemptCount()).toBe(2);
      expect(policy.isIntentionalStop()).toBe(true);

      // Reset should clear everything
      policy.reset();
      expect(policy.getAttemptCount()).toBe(0);
      expect(policy.isIntentionalStop()).toBe(false);
    });
  });
});
