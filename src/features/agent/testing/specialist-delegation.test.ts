/**
 * Specialist Delegation Tests
 *
 * Tests that specialist agents
 * are used properly and delegate correctly.
 */

import { describe, it, expect } from 'vitest';
import {
  validateAgentActions,
  validateWaveExecution,
  getSpecialistBehavior,
  type AgentAction,
  type DelegationRecord,
} from './specialist-validator';

describe('Specialist Behavior Validation', () => {
  describe('Developer Behavior', () => {
    it('allows optional delegation and direct implementation from Developer', () => {
      const behavior = getSpecialistBehavior('developer');
      expect(behavior).toBeDefined();
      expect(behavior!.delegationExpected).toBeUndefined();
      expect(behavior!.implementationExpected).toBe(true);
    });

    it.each(['developer'])('allows %s to implement without delegation', (id) => {
      const actions: AgentAction[] = [
        { agentId: 'agent-1', actionType: 'tool_call', toolName: 'read_note', timestamp: 1 },
        { agentId: 'agent-1', actionType: 'tool_call', toolName: 'write_file', timestamp: 2 },
      ];

      const result = validateAgentActions(id, actions);
      expect(result.valid).toBe(true);
      expect(result.violations).toEqual([]);
    });

    it.each(['developer'])('allows %s to delegate', (id) => {
      const actions: AgentAction[] = [
        { agentId: 'agent-1', actionType: 'tool_call', toolName: 'read_note', timestamp: 1 },
        { agentId: 'agent-1', actionType: 'tool_call', toolName: 'delegate_task', timestamp: 2 },
        { agentId: 'agent-1', actionType: 'delegation', timestamp: 3 },
      ];

      const result = validateAgentActions(id, actions);
      expect(result.valid).toBe(true);
    });
  });
});

describe('Edge Cases', () => {
  describe('Empty Inputs', () => {
    it('should handle empty actions array', () => {
      const result = validateAgentActions('developer', []);
      expect(result.valid).toBe(true);
      expect(result.violations).toEqual([]);
    });

    it('should handle unknown specialist ID with warning', () => {
      const actions: AgentAction[] = [
        { agentId: 'agent-1', actionType: 'tool_call', toolName: 'read_file', timestamp: 1 },
      ];
      // Unknown specialist should pass (no behavior defined) but with a warning
      const result = validateAgentActions('unknown-specialist' as any, actions);
      expect(result.valid).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some((w) => w.includes('Unknown specialist ID'))).toBe(true);
    });

    it('should handle empty delegations array in wave validation', () => {
      const result = validateWaveExecution([]);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('Null and Undefined Handling', () => {
    it('should handle action with undefined toolName', () => {
      const actions: AgentAction[] = [
        { agentId: 'agent-1', actionType: 'tool_call', timestamp: 1 }, // No toolName
        { agentId: 'agent-1', actionType: 'delegation', timestamp: 2 },
      ];
      const result = validateAgentActions('developer', actions);
      // Should not throw, should process normally
      expect(result).toBeDefined();
    });

    it('should handle delegation with null specialist', () => {
      const delegations: DelegationRecord[] = [
        {
          fromAgentId: 'a1',
          toAgentId: 'a2',
          taskNoteId: 't1',
          specialist: null,
          waitMode: 'after_all',
          wave: 1,
          timestamp: 100,
        },
      ];
      const result = validateWaveExecution(delegations);
      expect(result).toBeDefined();
    });
  });
});

describe('Wave Execution Validation', () => {
  it('should validate proper wave ordering', () => {
    const delegations: DelegationRecord[] = [
      {
        fromAgentId: 'a1',
        toAgentId: 'a2',
        taskNoteId: 't1',
        specialist: null,
        waitMode: 'after_all',
        wave: 1,
        timestamp: 100,
      },
      {
        fromAgentId: 'a1',
        toAgentId: 'a3',
        taskNoteId: 't2',
        specialist: null,
        waitMode: 'after_all',
        wave: 1,
        timestamp: 110,
      },
      {
        fromAgentId: 'a1',
        toAgentId: 'a4',
        taskNoteId: 't3',
        specialist: null,
        waitMode: 'after_all',
        wave: 2,
        timestamp: 200,
      },
    ];

    const result = validateWaveExecution(delegations);
    expect(result.valid).toBe(true);
  });

  it('should detect out-of-order wave execution', () => {
    const delegations: DelegationRecord[] = [
      {
        fromAgentId: 'a1',
        toAgentId: 'a2',
        taskNoteId: 't1',
        specialist: null,
        waitMode: 'after_all',
        wave: 1,
        timestamp: 100,
      },
      {
        fromAgentId: 'a1',
        toAgentId: 'a3',
        taskNoteId: 't2',
        specialist: null,
        waitMode: 'after_all',
        wave: 2,
        timestamp: 50,
      }, // Started before wave 1
    ];

    const result = validateWaveExecution(delegations);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('started before'))).toBe(true);
  });

  it('should warn about missing wait_mode in non-final waves', () => {
    const delegations: DelegationRecord[] = [
      {
        fromAgentId: 'a1',
        toAgentId: 'a2',
        taskNoteId: 't1',
        specialist: null,
        waitMode: 'none',
        wave: 1,
        timestamp: 100,
      },
      {
        fromAgentId: 'a1',
        toAgentId: 'a3',
        taskNoteId: 't2',
        specialist: null,
        waitMode: 'none',
        wave: 2,
        timestamp: 200,
      },
    ];

    const result = validateWaveExecution(delegations);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('wait_mode'))).toBe(true);
  });
});
