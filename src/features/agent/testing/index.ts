/**
 * Agent Testing Framework
 *
 * Comprehensive testing framework for the agent system.
 *
 * @module agent-testing
 */

import type { HarnessConfig, TestScenario, TestMetrics } from './agent-test-harness';
import { AgentTestHarness } from './agent-test-harness';
import { AgentTestRunner } from './agent-test-runner';
import type { TestReport } from './agent-test-runner';

// Core test harness
export {
  AgentTestHarness,
  type TestMetrics,
  type MemoryLeak,
  type OperationMetric,
  type TestError,
  type TestScenario,
  type HarnessConfig,
} from './agent-test-harness';

// Test runner
export {
  AgentTestRunner,
  type TestSuite,
  type TestResult,
  type TestReport,
  type TestSuiteReport,
} from './agent-test-runner';

// Test utilities
export {
  createMockSession,
  createMockMessage,
  createMockConfig,
  simulateStreaming,
  waitFor,
  takeMemorySnapshot,
  compareMemorySnapshots,
  forceGC,
  measureTime,
  createTestWorkspace,
  MockIPCChannel,
  createTestError,
  validateSession,
  generateTestData,
  delay,
  retry,
  cleanupTestResources,
  type MemorySnapshot,
} from './agent-test-utils';

// Test scenarios
export {
  basicLifecycleScenario,
  memoryLeakScenario,
  streamingPerformanceScenario,
  errorRecoveryScenario,
  concurrentOperationsScenario,
  longRunningSessionScenario,
  allScenarios,
  testScenarios,
  createCustomScenario,
} from './test-scenarios';

// Prompt loader for testing with actual prompts
export {
  loadInstruction,
  loadInstructionWithCommon,
  loadBaseSystemPrompt,
  loadCommonInstructions,
  loadWorkspaceInstructions,
  getAllInstructionIds,
  getSpecialists,
  getSpecialist,
  analyzePrompt,
  validatePromptContent,
  checkToolMentions,
  extractCodeExamples,
  validateSpecialistPrompt,
  loadAllPrompts,
  SPECIALIST_PATTERNS,
  type PromptMetadata,
} from './prompt-loader';

// Specialist validator for testing delegation patterns
export {
  getSpecialistBehavior,
  validateAgentActions,
  validateWaveExecution,
  SPECIALIST_BEHAVIORS,
  type DelegationRecord,
  type AgentAction,
  type SpecialistBehavior,
} from './specialist-validator';

// Stuck detector for testing agent behavior
export {
  StuckDetector,
  createStuckDetector,
  type StuckDetectorConfig,
  type StuckDetectionResult,
} from './stuck-detector';
// E2E test scenarios
export {
  specWriterDelegationScenario,
  implementorFocusScenario,
  stuckDetectionScenario,
  interruptionHandlingScenario,
  e2eScenarios,
} from './e2e-scenarios';

/**
 * Run all default agent system tests.
 * Executes a comprehensive test suite covering lifecycle, performance,
 * memory management, error recovery, and concurrent operations.
 *
 * @param scenarios - Test scenarios to run
 * @param config - Optional test harness configuration
 * @returns Test report with detailed results and metrics
 * @example
 * ```typescript
 * const report = await runDefaultTests(myScenarios, {
 *   verbose: true,
 *   timeout: 120000
 * });
 * console.log(`Tests passed: ${report.passed}/${report.total}`);
 * ```
 */
export async function runDefaultTests(
  scenarios: TestScenario[],
  config?: HarnessConfig,
): Promise<TestReport> {
  const runner = new AgentTestRunner();

  // Register default test suite
  runner.registerSuite({
    name: 'Default Agent Tests',
    description: 'Comprehensive test suite for agent system',
    scenarios,
    config,
    parallel: false,
    continueOnFailure: true,
  });

  return runner.runAll();
}

/**
 * Create a test harness with sensible defaults.
 * Configures memory tracking, performance monitoring, and error capture.
 *
 * @param config - Partial configuration to override defaults
 * @returns Configured AgentTestHarness instance
 * @example
 * ```typescript
 * const harness = createTestHarness({
 *   memoryLeakThreshold: 100 * 1024 * 1024, // 100MB
 *   verbose: true
 * });
 * ```
 */
export function createTestHarness(config?: Partial<HarnessConfig>): AgentTestHarness {
  return new AgentTestHarness({
    enableMemoryTracking: true,
    enablePerformanceTracking: true,
    enableErrorCapture: true,
    memoryCheckInterval: 1000,
    memoryLeakThreshold: 50 * 1024 * 1024, // 50MB
    performanceThreshold: 5000, // 5 seconds
    verbose: false,
    maxErrors: 100,
    timeout: 60000, // 60 seconds
    ...config,
  });
}

/**
 * Run a single test scenario with isolated harness.
 * Useful for debugging specific test cases or running targeted tests.
 *
 * @param scenario - Test scenario to execute
 * @param config - Optional harness configuration
 * @returns Test metrics including performance and memory data
 * @throws Will throw if scenario execution fails
 * @example
 * ```typescript
 * const metrics = await runScenario(memoryLeakScenario, {
 *   memoryCheckInterval: 500
 * });
 * if (metrics.memoryLeaks.length > 0) {
 *   console.error('Memory leaks detected!');
 * }
 * ```
 */
export async function runScenario(
  scenario: TestScenario,
  config?: HarnessConfig,
): Promise<TestMetrics> {
  const harness = createTestHarness(config);

  try {
    await harness.start();
    const metrics = await harness.runScenario(scenario);
    await harness.stop();
    return metrics;
  } finally {
    await harness.cleanup();
  }
}

/**
 * Monitor agent performance metrics in real-time.
 * Sets up continuous monitoring with periodic callbacks.
 * Useful for debugging performance issues or monitoring production agents.
 *
 * @param agentId - ID of the agent to monitor
 * @param callback - Function called with metrics at each interval
 * @param interval - Monitoring interval in milliseconds (default: 1000ms)
 * @returns Cleanup function to stop monitoring
 * @example
 * ```typescript
 * const stopMonitoring = monitorAgent('agent-123', (metrics) => {
 *   console.log(`Memory: ${metrics.memory.current / 1024 / 1024}MB`);
 *   console.log(`Operations: ${metrics.operations.length}`);
 * }, 2000);
 *
 * // Stop monitoring after 10 seconds
 * setTimeout(stopMonitoring, 10000);
 * ```
 */
export function monitorAgent(
  agentId: string,
  callback: (metrics: TestMetrics) => void,
  interval: number = 1000,
): () => void {
  const harness = createTestHarness({
    enableMemoryTracking: true,
    enablePerformanceTracking: true,
    memoryCheckInterval: interval,
  });

  const timer = setInterval(() => {
    callback(harness.getMetrics());
  }, interval);

  // Return cleanup function
  return () => {
    clearInterval(timer);
    harness.cleanup();
  };
}

/**
 * Export version information
 */
export const VERSION = '1.0.0';
export const FRAMEWORK_NAME = 'Agent Testing Framework';
