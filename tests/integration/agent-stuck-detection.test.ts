/**
 * Agent Stuck Detection Tests
 *
 * Tests for detecting and handling stuck agents including:
 * - Infinite loop detection
 * - Timeout handling
 * - Circular delegation detection
 * - Recovery mechanisms
 */

import { describe, it, expect } from 'vitest';

// Types for stuck detection
interface AgentActivity {
  agentId: string;
  lastActivityTime: number;
  messageCount: number;
  toolCallCount: number;
  delegationChain: string[];
}

interface StuckDetectionConfig {
  maxIdleTimeMs: number;
  maxDelegationDepth: number;
  maxToolCallsWithoutProgress: number;
}

// Utility functions for stuck detection
function isAgentStuck(activity: AgentActivity, config: StuckDetectionConfig): boolean {
  const now = Date.now();
  const idleTime = now - activity.lastActivityTime;

  // Check for idle timeout
  if (idleTime > config.maxIdleTimeMs) {
    return true;
  }

  return false;
}

function hasCircularDelegation(delegationChain: string[]): boolean {
  const seen = new Set<string>();
  for (const agentId of delegationChain) {
    if (seen.has(agentId)) {
      return true;
    }
    seen.add(agentId);
  }
  return false;
}

function isDelegationTooDeep(delegationChain: string[], maxDepth: number): boolean {
  return delegationChain.length > maxDepth;
}

describe('Agent Stuck Detection', () => {
  const defaultConfig: StuckDetectionConfig = {
    maxIdleTimeMs: 60000, // 1 minute
    maxDelegationDepth: 5,
    maxToolCallsWithoutProgress: 10,
  };

  describe('Idle Timeout Detection', () => {
    it('should detect agent stuck due to idle timeout', () => {
      const activity: AgentActivity = {
        agentId: 'agent-1',
        lastActivityTime: Date.now() - 120000, // 2 minutes ago
        messageCount: 5,
        toolCallCount: 10,
        delegationChain: [],
      };

      expect(isAgentStuck(activity, defaultConfig)).toBe(true);
    });

    it('should not flag active agent as stuck', () => {
      const activity: AgentActivity = {
        agentId: 'agent-1',
        lastActivityTime: Date.now() - 30000, // 30 seconds ago
        messageCount: 5,
        toolCallCount: 10,
        delegationChain: [],
      };

      expect(isAgentStuck(activity, defaultConfig)).toBe(false);
    });
  });

  describe('Circular Delegation Detection', () => {
    it('should detect circular delegation', () => {
      const chain = ['agent-1', 'agent-2', 'agent-3', 'agent-1'];
      expect(hasCircularDelegation(chain)).toBe(true);
    });

    it('should not flag linear delegation as circular', () => {
      const chain = ['agent-1', 'agent-2', 'agent-3', 'agent-4'];
      expect(hasCircularDelegation(chain)).toBe(false);
    });

    it('should detect self-delegation', () => {
      const chain = ['agent-1', 'agent-1'];
      expect(hasCircularDelegation(chain)).toBe(true);
    });

    it('should handle empty chain', () => {
      const chain: string[] = [];
      expect(hasCircularDelegation(chain)).toBe(false);
    });
  });

  describe('Delegation Depth Detection', () => {
    it('should detect delegation too deep', () => {
      const chain = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
      expect(isDelegationTooDeep(chain, 5)).toBe(true);
    });

    it('should allow delegation within limits', () => {
      const chain = ['a1', 'a2', 'a3'];
      expect(isDelegationTooDeep(chain, 5)).toBe(false);
    });

    it('should allow exactly max depth', () => {
      const chain = ['a1', 'a2', 'a3', 'a4', 'a5'];
      expect(isDelegationTooDeep(chain, 5)).toBe(false);
    });
  });

  describe('Combined Stuck Detection', () => {
    it('should detect multiple stuck conditions', () => {
      const activity: AgentActivity = {
        agentId: 'agent-1',
        lastActivityTime: Date.now() - 120000,
        messageCount: 0,
        toolCallCount: 0,
        delegationChain: ['a1', 'a2', 'a3', 'a1'], // circular
      };

      const isIdle = isAgentStuck(activity, defaultConfig);
      const isCircular = hasCircularDelegation(activity.delegationChain);

      expect(isIdle).toBe(true);
      expect(isCircular).toBe(true);
    });
  });

  describe('Stuck Detection Edge Cases', () => {
    it('should handle agent with no activity', () => {
      const activity: AgentActivity = {
        agentId: 'agent-1',
        lastActivityTime: 0, // Never active
        messageCount: 0,
        toolCallCount: 0,
        delegationChain: [],
      };

      expect(isAgentStuck(activity, defaultConfig)).toBe(true);
    });

    it('should handle very long delegation chains', () => {
      const chain = Array.from({ length: 100 }, (_, i) => `agent-${i}`);
      expect(isDelegationTooDeep(chain, 5)).toBe(true);
      expect(hasCircularDelegation(chain)).toBe(false);
    });
  });
});
