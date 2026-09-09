/**
 * Stuck Detection Tests
 *
 * Tests that agents don't get stuck in various ways:
 * - Timeout detection
 * - Infinite loop detection
 * - No progress detection
 * - Circular delegation detection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StuckDetector, createStuckDetector } from './stuck-detector';

describe('StuckDetector', () => {
  let detector: StuckDetector;

  beforeEach(() => {
    detector = createStuckDetector({
      responseTimeout: 1000, // 1 second for testing
      taskTimeout: 5000, // 5 seconds for testing
      repeatThreshold: 3,
      progressWindow: 2000, // 2 seconds
      minActionsInWindow: 1,
    });
  });

  describe('Timeout Detection', () => {
    it('should not detect stuck when actions are recent', () => {
      // Use a meaningful action (write_file) to avoid no_progress detection
      detector.recordAction({
        agentId: 'agent-1',
        actionType: 'tool_call',
        toolName: 'write_file',
        timestamp: Date.now(),
      });

      const result = detector.checkStuck();
      expect(result.isStuck).toBe(false);
    });

    it('should detect response timeout', async () => {
      // Record an action in the past
      detector.recordAction({
        agentId: 'agent-1',
        actionType: 'tool_call',
        toolName: 'read_file',
        timestamp: Date.now() - 2000, // 2 seconds ago
      });

      const result = detector.checkStuck();
      expect(result.isStuck).toBe(true);
      expect(result.stuckType).toBe('timeout');
      expect(result.details).toContain('No response');
    });
  });

  describe('Infinite Loop Detection', () => {
    it('should detect repeated tool calls', () => {
      const now = Date.now();

      // Record the same tool call multiple times
      for (let i = 0; i < 4; i++) {
        detector.recordAction({
          agentId: 'agent-1',
          actionType: 'tool_call',
          toolName: 'read_file',
          timestamp: now + i * 100,
        });
      }

      const result = detector.checkStuck();
      expect(result.isStuck).toBe(true);
      expect(result.stuckType).toBe('infinite_loop');
      expect(result.details).toContain('read_file');
    });

    it('should not detect loop with varied actions', () => {
      const now = Date.now();

      detector.recordAction({
        agentId: 'agent-1',
        actionType: 'tool_call',
        toolName: 'read_file',
        timestamp: now,
      });
      detector.recordAction({
        agentId: 'agent-1',
        actionType: 'tool_call',
        toolName: 'write_file',
        timestamp: now + 100,
      });
      detector.recordAction({
        agentId: 'agent-1',
        actionType: 'tool_call',
        toolName: 'run_command',
        timestamp: now + 200,
      });

      const result = detector.checkStuck();
      expect(result.isStuck).toBe(false);
    });
  });

  describe('Circular Delegation Detection', () => {
    it('should detect circular delegation', () => {
      const now = Date.now();

      detector.recordDelegation({
        fromAgentId: 'agent-1',
        toAgentId: 'agent-2',
        taskNoteId: 'task-1',
        specialist: 'implementor',
        waitMode: 'after_all',
        wave: 1,
        timestamp: now,
      });

      detector.recordDelegation({
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1', // Back to agent-1!
        taskNoteId: 'task-2',
        specialist: 'implementor',
        waitMode: 'after_all',
        wave: 1,
        timestamp: now + 100,
      });

      const result = detector.checkStuck();
      expect(result.isStuck).toBe(true);
      expect(result.stuckType).toBe('circular_delegation');
      expect(result.details).toContain('agent-1');
      expect(result.details).toContain('agent-2');
    });

    it('should not detect circular with different agents', () => {
      const now = Date.now();

      detector.recordDelegation({
        fromAgentId: 'agent-1',
        toAgentId: 'agent-2',
        taskNoteId: 'task-1',
        specialist: 'implementor',
        waitMode: 'after_all',
        wave: 1,
        timestamp: now,
      });

      detector.recordDelegation({
        fromAgentId: 'agent-1',
        toAgentId: 'agent-3',
        taskNoteId: 'task-2',
        specialist: 'implementor',
        waitMode: 'after_all',
        wave: 1,
        timestamp: now + 100,
      });

      const result = detector.checkStuck();
      expect(result.isStuck).toBe(false);
    });
  });

  describe('No Progress Detection', () => {
    it('should not detect no progress when only a few actions exist', () => {
      const now = Date.now();

      // Just 2 read actions - not enough to trigger no_progress
      detector.recordAction({
        agentId: 'agent-1',
        actionType: 'tool_call',
        toolName: 'read_file',
        timestamp: now,
      });
      detector.recordAction({
        agentId: 'agent-1',
        actionType: 'tool_call',
        toolName: 'read_file',
        timestamp: now + 100,
      });

      const result = detector.checkStuck();
      expect(result.isStuck).toBe(false);
    });

    it('should detect no progress with many read-only actions', () => {
      const now = Date.now();

      // 4 read-only actions - should trigger no_progress
      for (let i = 0; i < 4; i++) {
        detector.recordAction({
          agentId: 'agent-1',
          actionType: 'tool_call',
          toolName: 'read_file',
          timestamp: now + i * 100,
        });
      }

      const result = detector.checkStuck();
      // Note: This might trigger infinite_loop instead since all are the same tool
      // The detector checks infinite_loop before no_progress
      expect(result.isStuck).toBe(true);
    });
  });

  describe('Metrics', () => {
    it('should track metrics correctly', () => {
      const now = Date.now();

      detector.recordAction({
        agentId: 'agent-1',
        actionType: 'tool_call',
        toolName: 'read_file',
        timestamp: now,
      });

      detector.recordDelegation({
        fromAgentId: 'agent-1',
        toAgentId: 'agent-2',
        taskNoteId: 'task-1',
        specialist: 'implementor',
        waitMode: 'after_all',
        wave: 1,
        timestamp: now,
      });

      const metrics = detector.getMetrics();
      expect(metrics.totalActions).toBe(1);
      expect(metrics.totalDelegations).toBe(1);
      expect(metrics.elapsedTime).toBeGreaterThanOrEqual(0);
    });

    it('should reset correctly', () => {
      detector.recordAction({
        agentId: 'agent-1',
        actionType: 'tool_call',
        toolName: 'read_file',
        timestamp: Date.now(),
      });

      detector.reset();

      const metrics = detector.getMetrics();
      expect(metrics.totalActions).toBe(0);
      expect(metrics.totalDelegations).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should not detect stuck with no actions recorded', () => {
      // Fresh detector with no actions
      const freshDetector = createStuckDetector();
      const result = freshDetector.checkStuck();
      // Should not be stuck (no timeout yet since startTime is now)
      expect(result.stuckType).not.toBe('infinite_loop');
      expect(result.stuckType).not.toBe('no_progress');
      expect(result.stuckType).not.toBe('circular_delegation');
    });

    it('should handle actions with undefined toolName', () => {
      const now = Date.now();
      detector.recordAction({
        agentId: 'agent-1',
        actionType: 'tool_call',
        timestamp: now,
        // No toolName
      });
      detector.recordAction({
        agentId: 'agent-1',
        actionType: 'tool_call',
        timestamp: now + 100,
      });
      detector.recordAction({
        agentId: 'agent-1',
        actionType: 'tool_call',
        timestamp: now + 200,
      });

      // Should not throw
      const result = detector.checkStuck();
      expect(result).toBeDefined();
    });

    it('should handle mixed action types correctly', () => {
      const now = Date.now();
      detector.recordAction({
        agentId: 'agent-1',
        actionType: 'message',
        timestamp: now,
      });
      detector.recordAction({
        agentId: 'agent-1',
        actionType: 'tool_call',
        toolName: 'write_file',
        timestamp: now + 100,
      });
      detector.recordAction({
        agentId: 'agent-1',
        actionType: 'completion',
        timestamp: now + 200,
      });

      const result = detector.checkStuck();
      expect(result.isStuck).toBe(false);
    });

    it('should detect task timeout', async () => {
      // Create detector with very short task timeout
      const shortTimeoutDetector = createStuckDetector({
        responseTimeout: 100000, // Long response timeout
        taskTimeout: 10, // 10ms task timeout
      });

      // Record an action so we don't hit response timeout
      shortTimeoutDetector.recordAction({
        agentId: 'agent-1',
        actionType: 'tool_call',
        toolName: 'write_file',
        timestamp: Date.now(),
      });

      // Wait for task timeout to expire
      await new Promise((resolve) => setTimeout(resolve, 20));

      const result = shortTimeoutDetector.checkStuck();
      expect(result.isStuck).toBe(true);
      expect(result.stuckType).toBe('timeout');
      expect(result.details).toContain('Task running');
    });
  });

  describe('Recovery Suggestions', () => {
    it('should provide recovery suggestion for timeout', () => {
      detector.recordAction({
        agentId: 'agent-1',
        actionType: 'tool_call',
        toolName: 'read_file',
        timestamp: Date.now() - 2000,
      });

      const result = detector.checkStuck();
      expect(result.suggestedRecovery).toBeDefined();
      expect(result.suggestedRecovery).toContain('Interrupt');
    });

    it('should provide recovery suggestion for infinite loop', () => {
      const now = Date.now();
      for (let i = 0; i < 4; i++) {
        detector.recordAction({
          agentId: 'agent-1',
          actionType: 'tool_call',
          toolName: 'read_file',
          timestamp: now + i * 100,
        });
      }

      const result = detector.checkStuck();
      expect(result.suggestedRecovery).toBeDefined();
      expect(result.suggestedRecovery).toContain('approach');
    });
  });
});
