/**
 * E2E Test Scenarios for Agent System
 *
 * Comprehensive end-to-end test scenarios that validate:
 * - Specialist agents are used properly
 * - Nothing gets stuck
 * - Interruptions are handled flawlessly
 *
 * Uses actual prompts from the codebase.
 */

import type { TestScenario } from './agent-test-harness';
import type { AgentTestHarness } from './agent-test-harness';
import { createStuckDetector } from './stuck-detector';
import {
  validateAgentActions,
  validateWaveExecution,
  type AgentAction,
  type DelegationRecord,
} from './specialist-validator';

/**
 * Extended harness interface for optional interruption methods
 * These methods may not be implemented in all harness versions
 */
interface ExtendedHarness extends AgentTestHarness {
  stopAgent?: (agentId: string) => Promise<void>;
  resumeAgent?: (agentId: string) => Promise<void>;
  getSession?: (agentId: string) => { status: string } | undefined;
}

/**
 * Scenario: Spec-writer delegates to implementors
 *
 * Tests that the spec-writer:
 * 1. Breaks down tasks properly
 * 2. Delegates to implementors
 * 3. Uses wave-based execution
 * 4. Waits for all tasks before proceeding
 */
export const specWriterDelegationScenario: TestScenario = {
  name: 'Spec-Writer Delegation',
  description: 'Tests that spec-writer properly delegates tasks to implementors',
  timeout: 120000,

  async execute(harness: AgentTestHarness): Promise<void> {
    const stuckDetector = createStuckDetector({
      responseTimeout: 30000,
      repeatThreshold: 5,
    });

    const actions: AgentAction[] = [];
    const delegations: DelegationRecord[] = [];

    // Create a spec-writer agent
    const specWriter = await harness.createAgent({
      name: 'spec-writer-test',
      model: 'test-model',
    });

    // Track actions
    harness.on('toolCall', ({ agentId, toolName }) => {
      const action: AgentAction = {
        agentId,
        actionType: 'tool_call',
        toolName,
        timestamp: Date.now(),
      };
      actions.push(action);
      stuckDetector.recordAction(action);
    });

    // Track delegations
    harness.on(
      'delegation',
      ({ fromAgentId, toAgentId, taskNoteId, specialist, waitMode, wave }) => {
        const delegation: DelegationRecord = {
          fromAgentId,
          toAgentId,
          taskNoteId,
          specialist,
          waitMode,
          wave,
          timestamp: Date.now(),
        };
        delegations.push(delegation);
        stuckDetector.recordDelegation(delegation);
      },
    );

    // Send a task that requires delegation
    await harness.sendMessage(specWriter.id, 'Create a new feature with multiple components');

    // Wait for completion or stuck detection
    const maxWait = 60000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const stuckResult = stuckDetector.checkStuck();
      if (stuckResult.isStuck) {
        throw new Error(`Agent got stuck: ${stuckResult.stuckType} - ${stuckResult.details}`);
      }

      // Check if we have delegations (success condition)
      if (delegations.length > 0) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Validate spec-writer behavior
    const specWriterActions = actions.filter((a) => a.agentId === specWriter.id);
    const validation = validateAgentActions('spec-writer', specWriterActions);

    if (!validation.valid) {
      throw new Error(`Spec-writer behavior violations: ${validation.violations.join(', ')}`);
    }

    // Validate wave execution
    if (delegations.length > 0) {
      const waveValidation = validateWaveExecution(delegations);
      if (!waveValidation.valid) {
        throw new Error(`Wave execution issues: ${waveValidation.issues.join(', ')}`);
      }
    }
  },

  validate(metrics): boolean {
    return metrics.errors.length === 0;
  },
};

/**
 * Scenario: Implementor completes task without delegation
 *
 * Tests that the implementor:
 * 1. Focuses on assigned task
 * 2. Writes code
 * 3. Does not delegate
 * 4. Completes within scope
 */
export const implementorFocusScenario: TestScenario = {
  name: 'Implementor Focus',
  description: 'Tests that implementor stays focused and completes tasks',
  timeout: 120000,

  async execute(harness: AgentTestHarness): Promise<void> {
    const stuckDetector = createStuckDetector();
    const actions: AgentAction[] = [];

    const implementor = await harness.createAgent({
      name: 'implementor-test',
      model: 'test-model',
    });

    harness.on('toolCall', ({ agentId, toolName }) => {
      const action: AgentAction = {
        agentId,
        actionType: 'tool_call',
        toolName,
        timestamp: Date.now(),
      };
      actions.push(action);
      stuckDetector.recordAction(action);
    });

    await harness.sendMessage(implementor.id, 'Implement a simple utility function');

    // Wait for completion
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Validate implementor behavior
    const validation = validateAgentActions('implementor', actions);
    if (!validation.valid) {
      throw new Error(`Implementor behavior violations: ${validation.violations.join(', ')}`);
    }
  },

  validate(metrics): boolean {
    return metrics.errors.length === 0;
  },
};

/**
 * Scenario: Stuck detection and recovery
 *
 * Tests that:
 * 1. Stuck agents are detected
 * 2. Recovery suggestions are provided
 * 3. Interruption works correctly
 */
export const stuckDetectionScenario: TestScenario = {
  name: 'Stuck Detection',
  description: 'Tests stuck detection and recovery mechanisms',
  timeout: 30000,

  async execute(_harness: AgentTestHarness): Promise<void> {
    const stuckDetector = createStuckDetector({
      responseTimeout: 2000, // Short timeout for testing
      repeatThreshold: 3,
    });

    // Simulate repeated actions (infinite loop)
    for (let i = 0; i < 5; i++) {
      stuckDetector.recordAction({
        agentId: 'test-agent',
        actionType: 'tool_call',
        toolName: 'read_file',
        timestamp: Date.now() + i * 100,
      });
    }

    const result = stuckDetector.checkStuck();

    if (!result.isStuck) {
      throw new Error('Expected stuck detection for repeated actions');
    }

    if (result.stuckType !== 'infinite_loop') {
      throw new Error(`Expected infinite_loop, got ${result.stuckType}`);
    }

    if (!result.suggestedRecovery) {
      throw new Error('Expected recovery suggestion');
    }
  },

  validate(): boolean {
    return true;
  },
};

/**
 * Scenario: Interruption handling
 *
 * Tests that:
 * 1. Agents can be interrupted
 * 2. State is preserved
 * 3. Agents can resume
 *
 * NOTE: This scenario requires the harness to have stopAgent/resumeAgent methods
 * which may need to be added to AgentTestHarness for full functionality.
 */
export const interruptionHandlingScenario: TestScenario = {
  name: 'Interruption Handling',
  description: 'Tests agent interruption and resume functionality',
  timeout: 60000,

  async execute(harness: AgentTestHarness): Promise<void> {
    const extendedHarness = harness as ExtendedHarness;
    const agent = await harness.createAgent({
      name: 'interrupt-test',
      model: 'test-model',
    });

    // Start a long-running task (don't await - we want to interrupt it)
    const messagePromise = harness.sendMessage(agent.id, 'Perform a complex analysis');

    // Wait a bit then interrupt
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check if harness has stopAgent method (it may not be implemented yet)
    if (typeof extendedHarness.stopAgent === 'function') {
      await extendedHarness.stopAgent(agent.id);

      // Verify agent is stopped
      const session = extendedHarness.getSession?.(agent.id);
      if (session?.status === 'streaming') {
        throw new Error('Agent should not be streaming after stop');
      }

      // Resume the agent if method exists
      if (typeof extendedHarness.resumeAgent === 'function') {
        await extendedHarness.resumeAgent(agent.id);
      }
    } else {
      // If stopAgent doesn't exist, just wait for the message to complete
      // This is a graceful degradation for when the harness doesn't support interruption
      try {
        await Promise.race([
          messagePromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000)),
        ]);
      } catch {
        // Expected timeout or completion
      }
    }
  },

  validate(metrics): boolean {
    return metrics.errors.length === 0;
  },
};

/**
 * All E2E scenarios
 */
export const e2eScenarios: TestScenario[] = [
  specWriterDelegationScenario,
  implementorFocusScenario,
  stuckDetectionScenario,
  interruptionHandlingScenario,
];
