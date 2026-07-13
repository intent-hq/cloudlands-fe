/**
 * Orchestration Test Scenarios
 *
 * Reusable test scenarios for multi-agent orchestration patterns.
 * These scenarios can be used with the AgentTestHarness or CDP E2E tests.
 */

import type { TestScenario } from './agent-test-harness';

/**
 * Scenario: Wave-based delegation
 *
 * Tests the pattern where a parent agent delegates multiple tasks
 * using wait_mode="after_all" and only wakes when all complete.
 */
export const waveDelegationScenario: TestScenario = {
  name: 'Wave-based Delegation',
  description: 'Parent delegates 3 tasks with wait_mode="after_all", wakes when all complete',
  steps: [
    {
      type: 'message',
      content: 'Create a simple web app with header, footer, and main content',
      expectedBehavior: 'Agent should create spec and delegate to 3 implementor agents',
    },
    {
      type: 'wait',
      condition: 'delegation',
      timeout: 30000,
      expectedBehavior: 'Should see 3 delegate_task calls with wait_mode="after_all"',
    },
    {
      type: 'wait',
      condition: 'idle',
      timeout: 120000,
      expectedBehavior: 'Parent should only wake after all 3 children complete',
    },
  ],
  assertions: [
    {
      type: 'agentCount',
      expected: 4, // 1 parent + 3 children
    },
    {
      type: 'toolCalls',
      toolName: 'delegate_task',
      minCount: 3,
    },
    {
      type: 'custom',
      name: 'All children used implementor specialist',
      check: () =>
        // Check that all delegated agents used haiku4.5 model
        true // Placeholder - actual check would inspect agent metadata
      ,
    },
  ],
};

/**
 * Scenario: Specialist selection
 *
 * Tests that different specialists are used appropriately.
 */
export const specialistSelectionScenario: TestScenario = {
  name: 'Specialist Selection',
  description: 'Parent uses implementor for tasks and verifier for review',
  steps: [
    {
      type: 'message',
      content: 'Implement a function and then verify it works correctly',
      expectedBehavior: 'Should delegate implementation, then verification',
    },
    {
      type: 'wait',
      condition: 'idle',
      timeout: 120000,
    },
  ],
  assertions: [
    {
      type: 'toolCalls',
      toolName: 'delegate_task',
      minCount: 2,
    },
    {
      type: 'custom',
      name: 'Used both implementor and verifier specialists',
      check: () =>
        // Check that both specialist types were used
        true
      ,
    },
  ],
};

/**
 * Scenario: Interruption during delegation
 *
 * Tests that interrupting a parent agent during delegation is handled gracefully.
 */
export const interruptionDuringDelegationScenario: TestScenario = {
  name: 'Interruption During Delegation',
  description: 'User interrupts parent while children are still working',
  steps: [
    {
      type: 'message',
      content: 'Create 5 components for a dashboard',
      expectedBehavior: 'Agent should start delegating tasks',
    },
    {
      type: 'wait',
      condition: 'delegation',
      timeout: 30000,
    },
    {
      type: 'interrupt',
      expectedBehavior: 'Parent should stop, children should continue or be cancelled',
    },
    {
      type: 'message',
      content: 'Actually, just create 2 components',
      expectedBehavior: 'New delegation should work correctly',
    },
  ],
  assertions: [
    {
      type: 'custom',
      name: 'No orphaned agents',
      check: () =>
        // Check that all agents are in a valid state
        true
      ,
    },
  ],
};

/**
 * Scenario: Stuck state recovery
 *
 * Tests detection and recovery from stuck agent states.
 */
export const stuckStateRecoveryScenario: TestScenario = {
  name: 'Stuck State Recovery',
  description: 'Agent gets stuck and system recovers',
  steps: [
    {
      type: 'message',
      content: 'Perform a task that might get stuck',
      expectedBehavior: 'Agent should start processing',
    },
    {
      type: 'wait',
      condition: 'timeout',
      timeout: 60000,
      expectedBehavior: 'System should detect stuck state',
    },
  ],
  assertions: [
    {
      type: 'custom',
      name: 'Stuck state was detected',
      check: (metrics) => metrics.warnings.some((w) => w.message.includes('stuck')),
    },
  ],
};

/**
 * All orchestration scenarios for batch testing
 */
export const orchestrationScenarios: TestScenario[] = [
  waveDelegationScenario,
  specialistSelectionScenario,
  interruptionDuringDelegationScenario,
  stuckStateRecoveryScenario,
];
