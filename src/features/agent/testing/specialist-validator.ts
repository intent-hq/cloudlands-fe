/**
 * Specialist Validator for Testing
 *
 * Validates that specialist agents (spec-writer, implementor, verifier)
 * behave according to their roles and delegate properly.
 *
 * Key validations:
 * - Spec-writer delegates tasks in waves, doesn't implement directly
 * - Implementor focuses on assigned tasks, doesn't expand scope
 * - Verifier reviews and validates, doesn't modify code
 */

import type { Specialist } from '$lib/constants/specialists';

/**
 * Delegation record for tracking agent delegations
 */
export interface DelegationRecord {
  fromAgentId: string;
  toAgentId: string;
  taskNoteId: string;
  specialist: Specialist['id'] | null;
  waitMode: 'none' | 'after_all' | 'fire_and_forget';
  wave: number;
  timestamp: number;
}

/**
 * Agent action record for behavior analysis
 */
export interface AgentAction {
  agentId: string;
  actionType: 'tool_call' | 'message' | 'delegation' | 'completion';
  toolName?: string;
  content?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * Specialist behavior pattern expectations
 */
export interface SpecialistBehavior {
  id: Specialist['id'];
  expectedActions: string[];
  forbiddenActions: string[];
  delegationExpected: boolean;
  implementationExpected: boolean;
}

const SPECIALIST_BEHAVIORS: SpecialistBehavior[] = [
  {
    id: 'spec-writer',
    expectedActions: ['read_note', 'delegate_task', 'create_agent', 'add_to_note', 'edit_note'],
    forbiddenActions: ['write_file', 'edit_file', 'apply_diff'],
    delegationExpected: true,
    implementationExpected: false,
  },
  {
    id: 'implementor',
    expectedActions: ['read_file', 'write_file', 'edit_file', 'apply_diff', 'run_command'],
    forbiddenActions: ['delegate_task', 'create_agent'],
    delegationExpected: false,
    implementationExpected: true,
  },
  {
    id: 'verifier',
    expectedActions: ['read_file', 'run_command', 'run_tests', 'add_comment'],
    forbiddenActions: ['write_file', 'edit_file', 'apply_diff'],
    delegationExpected: false,
    implementationExpected: false,
  },
  {
    id: 'pr-reviewer',
    expectedActions: ['read_file', 'read_note', 'add_comment', 'delegate_task', 'create_agent'],
    forbiddenActions: ['write_file', 'edit_file', 'apply_diff'],
    delegationExpected: true,
    implementationExpected: false,
  },
  {
    id: 'ui-designer',
    expectedActions: ['read_file', 'write_file', 'edit_file', 'apply_diff', 'run_command'],
    forbiddenActions: ['delegate_task', 'create_agent'],
    delegationExpected: false,
    implementationExpected: true,
  },
  {
    id: 'developer',
    expectedActions: ['read_file', 'write_file', 'edit_file', 'apply_diff', 'run_command', 'read_note', 'add_to_note', 'edit_note'],
    forbiddenActions: ['delegate_task', 'create_agent'],
    delegationExpected: false,
    implementationExpected: true,
  },
  {
    id: 'pr-shepherd',
    expectedActions: ['get_pr_status', 'list_pr_review_comments', 'create_agent', 'reply_to_pr_review_comment', 'resolve_pr_review_thread', 'post_pr_comment', 'launch-process', 'read_note', 'add_to_note', 'report_to_parent'],
    forbiddenActions: ['str_replace_editor', 'write_file', 'save_file', 'edit_file'],
    delegationExpected: true,
    implementationExpected: false,
  },
];

/**
 * Exported for testing purposes
 */
export { SPECIALIST_BEHAVIORS };

/**
 * Get expected behavior for a specialist
 */
export function getSpecialistBehavior(id: Specialist['id']): SpecialistBehavior | undefined {
  return SPECIALIST_BEHAVIORS.find((b) => b.id === id);
}

/**
 * Validate that an agent's actions match its specialist role
 *
 * @param specialistId - The specialist ID to validate against
 * @param actions - Array of actions to validate
 * @returns Validation result with any violations found
 *
 * Note: If specialistId is not a known specialist, returns valid:true with no violations
 * since we can't validate against unknown behavior patterns.
 */
export function validateAgentActions(
  specialistId: Specialist['id'],
  actions: AgentAction[],
): { valid: boolean; violations: string[]; warnings?: string[] } {
  const behavior = getSpecialistBehavior(specialistId);
  if (!behavior) {
    // Unknown specialist - can't validate, but warn about it
    return {
      valid: true,
      violations: [],
      warnings: [`Unknown specialist ID: ${specialistId} - no behavior validation applied`],
    };
  }

  const violations: string[] = [];
  const toolCalls = actions.filter((a) => a.actionType === 'tool_call');

  // Check for forbidden actions
  for (const action of toolCalls) {
    if (action.toolName && behavior.forbiddenActions.includes(action.toolName)) {
      violations.push(`${specialistId} agent performed forbidden action: ${action.toolName}`);
    }
  }

  // Check for expected delegation behavior
  const hasDelegation = actions.some((a) => a.actionType === 'delegation');
  if (behavior.delegationExpected && !hasDelegation) {
    violations.push(`${specialistId} agent was expected to delegate but didn't`);
  }
  if (!behavior.delegationExpected && hasDelegation) {
    violations.push(`${specialistId} agent was not expected to delegate but did`);
  }

  // Check for implementation actions when not expected
  const implementationTools = ['write_file', 'edit_file', 'apply_diff'];
  const hasImplementation = toolCalls.some(
    (a) => a.toolName && implementationTools.includes(a.toolName),
  );
  if (!behavior.implementationExpected && hasImplementation) {
    violations.push(`${specialistId} agent implemented code when not expected`);
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Validate wave-based execution pattern
 *
 * Spec-writers should delegate in waves:
 * - Wave 1: Foundation tasks (stores, utilities)
 * - Wave 2: Building tasks (components using Wave 1 outputs)
 * - Wave 3: Verification tasks (testing, review)
 */
export function validateWaveExecution(delegations: DelegationRecord[]): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  // Group delegations by wave
  const waves = new Map<number, DelegationRecord[]>();
  for (const d of delegations) {
    const wave = d.wave || 1;
    const existing = waves.get(wave);
    if (existing) {
      existing.push(d);
    } else {
      waves.set(wave, [d]);
    }
  }

  // Check that waves are executed in order
  const waveNumbers = Array.from(waves.keys()).sort((a, b) => a - b);
  for (let i = 1; i < waveNumbers.length; i++) {
    const prevWave = waves.get(waveNumbers[i - 1]);
    const currentWave = waves.get(waveNumbers[i]);

    if (!prevWave || !currentWave) continue;

    const prevWaveLatest = Math.max(...prevWave.map((d) => d.timestamp));
    const currentWaveEarliest = Math.min(...currentWave.map((d) => d.timestamp));

    if (currentWaveEarliest < prevWaveLatest) {
      issues.push(`Wave ${waveNumbers[i]} started before Wave ${waveNumbers[i - 1]} completed`);
    }
  }

  // Check that wait_mode="after_all" is used within waves
  for (const [wave, dels] of waves.entries()) {
    const withWaitMode = dels.filter((d) => d.waitMode === 'after_all');
    if (wave < waveNumbers[waveNumbers.length - 1] && withWaitMode.length === 0) {
      issues.push(`Wave ${wave} should use wait_mode="after_all" for coordination`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
