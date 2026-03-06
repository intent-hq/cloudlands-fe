/**
 * Specialist Delegation Tests
 *
 * Tests that specialist agents (spec-writer, implementor, verifier)
 * are used properly and delegate correctly.
 *
 * Uses actual prompts from the codebase to ensure tests stay in sync.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadInstruction,
  loadInstructionWithCommon,
  getSpecialists,
  getSpecialist,
  analyzePrompt,
  validatePromptContent,
  validateSpecialistPrompt,
  SPECIALIST_PATTERNS,
} from './prompt-loader';
import {
  validateAgentActions,
  validateWaveExecution,
  getSpecialistBehavior,
  type AgentAction,
  type DelegationRecord,
} from './specialist-validator';
import { SPECIALISTS } from '$lib/constants/specialists';

describe('Specialist Prompts', () => {
  describe('Prompt Loading', () => {
    it('should load all specialist prompts', () => {
      const specialists = getSpecialists();
      expect(specialists).toHaveLength(8);
      expect(specialists.map((s) => s.id)).toEqual([
        'spec-writer',
        'implementor',
        'verifier',
        'pr-reviewer',
        'pr-shepherd',
        'ui-designer',
        'developer',
        'ralph',
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

    it('should load verifier behavior prompt', () => {
      const verifier = getSpecialist('verifier');
      expect(verifier).toBeDefined();
      expect(verifier!.defaultBehaviorPrompt).toBeDefined();
      expect(verifier!.defaultBehaviorPrompt.length).toBeGreaterThan(100);
    });
  });

  describe('Prompt Content Validation', () => {
    it('spec-writer prompt should mention delegation', () => {
      const specWriter = getSpecialist('spec-writer');
      const result = validateSpecialistPrompt('spec-writer', specWriter!.defaultBehaviorPrompt);
      expect(result.valid).toBe(true);
    });

    it('implementor prompt should mention implementation', () => {
      const implementor = getSpecialist('implementor');
      const result = validateSpecialistPrompt('implementor', implementor!.defaultBehaviorPrompt);
      expect(result.valid).toBe(true);
    });

    it('verifier prompt should mention verification', () => {
      const verifier = getSpecialist('verifier');
      const result = validateSpecialistPrompt('verifier', verifier!.defaultBehaviorPrompt);
      expect(result.valid).toBe(true);
    });
  });

  describe('Prompt Metadata Analysis', () => {
    it('should analyze task-loop instruction', () => {
      const content = loadInstruction('task-loop');
      const metadata = analyzePrompt(content, 'task-loop');

      expect(metadata.id).toBe('task-loop');
      expect(metadata.estimatedTokens).toBeGreaterThan(0);
      expect(metadata.sections.length).toBeGreaterThan(0);
    });

    it('should detect tool instructions in prompts', () => {
      const content = loadInstruction('task-loop');
      const metadata = analyzePrompt(content, 'task-loop');

      expect(metadata.hasToolInstructions).toBe(true);
    });
  });
});

describe('Specialist Behavior Validation', () => {
  describe('Spec-Writer Behavior', () => {
    it('should expect delegation from spec-writer', () => {
      const behavior = getSpecialistBehavior('spec-writer');
      expect(behavior).toBeDefined();
      expect(behavior!.delegationExpected).toBe(true);
      expect(behavior!.implementationExpected).toBe(false);
    });

    it('should flag spec-writer writing files as violation', () => {
      const actions: AgentAction[] = [
        { agentId: 'agent-1', actionType: 'tool_call', toolName: 'read_note', timestamp: 1 },
        { agentId: 'agent-1', actionType: 'tool_call', toolName: 'write_file', timestamp: 2 },
      ];

      const result = validateAgentActions('spec-writer', actions);
      expect(result.valid).toBe(false);
      expect(result.violations).toContain(
        'spec-writer agent performed forbidden action: write_file',
      );
    });

    it('should pass when spec-writer only delegates', () => {
      const actions: AgentAction[] = [
        { agentId: 'agent-1', actionType: 'tool_call', toolName: 'read_note', timestamp: 1 },
        { agentId: 'agent-1', actionType: 'tool_call', toolName: 'delegate_task', timestamp: 2 },
        { agentId: 'agent-1', actionType: 'delegation', timestamp: 3 },
      ];

      const result = validateAgentActions('spec-writer', actions);
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

  describe('Verifier Behavior', () => {
    it('should not expect implementation from verifier', () => {
      const behavior = getSpecialistBehavior('verifier');
      expect(behavior).toBeDefined();
      expect(behavior!.delegationExpected).toBe(false);
      expect(behavior!.implementationExpected).toBe(false);
    });

    it('should flag verifier modifying files as violation', () => {
      const actions: AgentAction[] = [
        { agentId: 'agent-1', actionType: 'tool_call', toolName: 'read_file', timestamp: 1 },
        { agentId: 'agent-1', actionType: 'tool_call', toolName: 'edit_file', timestamp: 2 },
      ];

      const result = validateAgentActions('verifier', actions);
      expect(result.valid).toBe(false);
      expect(result.violations).toContain('verifier agent performed forbidden action: edit_file');
    });

    it('should pass when verifier only reads and comments', () => {
      const actions: AgentAction[] = [
        { agentId: 'agent-1', actionType: 'tool_call', toolName: 'read_file', timestamp: 1 },
        { agentId: 'agent-1', actionType: 'tool_call', toolName: 'run_tests', timestamp: 2 },
        { agentId: 'agent-1', actionType: 'tool_call', toolName: 'add_comment', timestamp: 3 },
        { agentId: 'agent-1', actionType: 'completion', timestamp: 4 },
      ];

      const result = validateAgentActions('verifier', actions);
      expect(result.valid).toBe(true);
    });
  });
});

describe('Edge Cases', () => {
  describe('Empty Inputs', () => {
    it('should handle empty actions array', () => {
      const result = validateAgentActions('spec-writer', []);
      // Empty actions means no delegation happened, which is a violation for spec-writer
      expect(result.violations.some((v) => v.includes('expected to delegate'))).toBe(true);
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
        specialist: 'verifier',
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
