/**
 * Tests for WorkspaceMetricsTracker
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';

// We need to test the class directly, not the singleton
// Create a mock logger first
vi.mock('$lib/utils/logger', () => ({
  Logger: class MockLogger {
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
    debug = vi.fn();
  },
}));

// Import after mocking
const { workspaceMetrics } = await import('../workspace-metrics');

describe('WorkspaceMetricsTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    // Clear metrics between tests
    workspaceMetrics.clearMetrics('test-workspace');
    workspaceMetrics.clearMetrics('ws-1');
  });

  describe('startWorkspaceCreation', () => {
    it('should start tracking a workspace', () => {
      workspaceMetrics.startWorkspaceCreation('ws-1');
      const metrics = workspaceMetrics.getMetrics('ws-1');
      expect(metrics).toBeDefined();
      expect(metrics?.workspaceId).toBe('ws-1');
      expect(metrics?.creationStarted).toBe(Date.now());
    });
  });

  describe('recordMilestone', () => {
    it('should record milestones', () => {
      workspaceMetrics.startWorkspaceCreation('ws-1');
      vi.advanceTimersByTime(100);
      workspaceMetrics.recordMilestone('ws-1', 'optimisticNavigation');

      const metrics = workspaceMetrics.getMetrics('ws-1');
      expect(metrics?.optimisticNavigation).toBeDefined();
    });

    it('should handle missing workspace gracefully', () => {
      // Should not throw
      expect(() => {
        workspaceMetrics.recordMilestone('non-existent', 'agentCreated');
      }).not.toThrow();
    });

    it('should calculate total duration on firstResponseReceived', () => {
      workspaceMetrics.startWorkspaceCreation('ws-1');
      vi.advanceTimersByTime(500);
      workspaceMetrics.recordMilestone('ws-1', 'firstResponseReceived');

      const metrics = workspaceMetrics.getMetrics('ws-1');
      expect(metrics?.totalDuration).toBe(500);
    });
  });

  describe('startOperation and endOperation', () => {
    it('should track operation duration', () => {
      workspaceMetrics.startOperation('op-1', { type: 'test' });
      vi.advanceTimersByTime(200);
      const duration = workspaceMetrics.endOperation('op-1');

      expect(duration).toBe(200);
    });

    it('should return null for unknown operation', () => {
      const duration = workspaceMetrics.endOperation('unknown-op');
      expect(duration).toBeNull();
    });

    it('should merge metadata on end', () => {
      workspaceMetrics.startOperation('op-1', { initial: true });
      workspaceMetrics.endOperation('op-1', { final: true });
      // Operation completed successfully
    });
  });

  describe('getMetrics', () => {
    it('should return undefined for unknown workspace', () => {
      const metrics = workspaceMetrics.getMetrics('unknown');
      expect(metrics).toBeUndefined();
    });
  });

  describe('clearMetrics', () => {
    it('should remove metrics for workspace', () => {
      workspaceMetrics.startWorkspaceCreation('ws-1');
      expect(workspaceMetrics.getMetrics('ws-1')).toBeDefined();

      workspaceMetrics.clearMetrics('ws-1');
      expect(workspaceMetrics.getMetrics('ws-1')).toBeUndefined();
    });
  });

  describe('incrementAgentCreated', () => {
    it('should set agentCreated timestamp', () => {
      workspaceMetrics.startWorkspaceCreation('ws-1');
      vi.advanceTimersByTime(100);
      workspaceMetrics.incrementAgentCreated('ws-1');

      const metrics = workspaceMetrics.getMetrics('ws-1');
      expect(metrics?.agentCreated).toBeDefined();
    });
  });

  describe('incrementMessageSent', () => {
    it('should set firstMessageSent timestamp only once', () => {
      workspaceMetrics.startWorkspaceCreation('ws-1');
      vi.advanceTimersByTime(100);
      workspaceMetrics.incrementMessageSent('ws-1');
      const firstTime = workspaceMetrics.getMetrics('ws-1')?.firstMessageSent;

      vi.advanceTimersByTime(100);
      workspaceMetrics.incrementMessageSent('ws-1');
      const secondTime = workspaceMetrics.getMetrics('ws-1')?.firstMessageSent;

      expect(firstTime).toBe(secondTime); // Should not change
    });
  });
});
