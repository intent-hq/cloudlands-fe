/**
 * Specialist Delegation Tests
 *
 * Tests that specialist agents (Lead and Implementor)
 * are used properly and delegate correctly.
 *
 * Uses actual prompts from the codebase to ensure tests stay in sync.
 */

import { describe, it, expect } from 'vitest';
import { getSpecialists, getSpecialist } from './prompt-loader';
import {
  validateAgentActions,
  validateWaveExecution,
  getSpecialistBehavior,
  type AgentAction,
  type DelegationRecord,
} from './specialist-validator';

describe('Specialist Prompts', () => {
  describe('Prompt Loading', () => {
    it('should load all specialist prompts', () => {
      const specialists = getSpecialists();
      expect(specialists).toHaveLength(7);
      expect(specialists.map((s) => s.id)).toEqual([
        'spec-writer',
        'implementor',
        'pr-reviewer',
        'ui-designer',
        'vulnerability-scanner',
        'developer',
        'chief-of-staff',
      ]);
    });

    it('should load spec-writer behavior prompt', () => {
      const specWriter = getSpecialist('spec-writer');
      expect(specWriter).toBeDefined();
      expect(specWriter!.defaultBehaviorPrompt).toBeDefined();
      expect(specWriter!.defaultBehaviorPrompt.length).toBeGreaterThan(100);
    });

    it('should load implementor behavior prompt', () => {
      const implementor = getSpecialist('implementor');
      expect(implementor).toBeDefined();
      expect(implementor!.defaultBehaviorPrompt).toBeDefined();
      expect(implementor!.defaultBehaviorPrompt.length).toBeGreaterThan(100);
    });
  });
});

describe('Specialist Behavior Validation', () => {
  describe('Lead Behavior', () => {
    it('allows optional delegation and direct implementation from Lead', () => {
      const behavior = getSpecialistBehavior('spec-writer');
      expect(behavior).toBeDefined();
      expect(behavior!.delegationExpected).toBeUndefined();
      expect(behavior!.implementationExpected).toBe(true);
    });

    it.each(['spec-writer', 'developer'])('allows %s to implement without delegation', (id) => {
      const actions: AgentAction[] = [
        { agentId: 'agent-1', actionType: 'tool_call', toolName: 'read_note', timestamp: 1 },
        { agentId: 'agent-1', actionType: 'tool_call', toolName: 'write_file', timestamp: 2 },
      ];

      const result = validateAgentActions(id, actions);
      expect(result.valid).toBe(true);
      expect(result.violations).toEqual([]);
    });

    it.each(['spec-writer', 'developer'])('allows %s to delegate', (id) => {
      const actions: AgentAction[] = [
        { agentId: 'agent-1', actionType: 'tool_call', toolName: 'read_note', timestamp: 1 },
        { agentId: 'agent-1', actionType: 'tool_call', toolName: 'delegate_task', timestamp: 2 },
        { agentId: 'agent-1', actionType: 'delegation', timestamp: 3 },
      ];

      const result = validateAgentActions(id, actions);
      expect(result.valid).toBe(true);
    });
  });

  describe('Implementor Behavior', () => {
    it('should expect implementation from implementor', () => {
      const behavior = getSpecialistBehavior('implementor');
      expect(behavior).toBeDefined();
      expect(behavior!.delegationExpected).toBe(false);
      expect(behavior!.implementationExpected).toBe(true);
    });

    it('should flag implementor delegating as violation', () => {
      const actions: AgentAction[] = [
        { agentId: 'agent-1', actionType: 'tool_call', toolName: 'read_file', timestamp: 1 },
        { agentId: 'agent-1', actionType: 'tool_call', toolName: 'delegate_task', timestamp: 2 },
        { agentId: 'agent-1', actionType: 'delegation', timestamp: 3 },
      ];

      const result = validateAgentActions('implementor', actions);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes('forbidden action'))).toBe(true);
    });

    it('should pass when implementor writes code', () => {
      const actions: AgentAction[] = [
        { agentId: 'agent-1', actionType: 'tool_call', toolName: 'read_file', timestamp: 1 },
        { agentId: 'agent-1', actionType: 'tool_call', toolName: 'write_file', timestamp: 2 },
        { agentId: 'agent-1', actionType: 'completion', timestamp: 3 },
      ];

      const result = validateAgentActions('implementor', actions);
      expect(result.valid).toBe(true);
    });
  });
});

describe('Edge Cases', () => {
  describe('Empty Inputs', () => {
    it('should handle empty actions array', () => {
      const result = validateAgentActions('spec-writer', []);
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
      const result = validateAgentActions('spec-writer', actions);
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
        specialist: 'implementor',
        waitMode: 'after_all',
        wave: 1,
        timestamp: 100,
      },
      {
        fromAgentId: 'a1',
        toAgentId: 'a3',
        taskNoteId: 't2',
        specialist: 'implementor',
        waitMode: 'after_all',
        wave: 1,
        timestamp: 110,
      },
      {
        fromAgentId: 'a1',
        toAgentId: 'a4',
        taskNoteId: 't3',
        specialist: 'implementor',
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
        specialist: 'implementor',
        waitMode: 'after_all',
        wave: 1,
        timestamp: 100,
      },
      {
        fromAgentId: 'a1',
        toAgentId: 'a3',
        taskNoteId: 't2',
        specialist: 'implementor',
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
        specialist: 'implementor',
        waitMode: 'none',
        wave: 1,
        timestamp: 100,
      },
      {
        fromAgentId: 'a1',
        toAgentId: 'a3',
        taskNoteId: 't2',
        specialist: 'implementor',
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
