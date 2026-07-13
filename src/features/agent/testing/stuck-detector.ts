/**
 * Stuck Detector for Testing
 *
 * Detects when agents get stuck in various ways:
 * - Timeout: Agent takes too long to respond
 * - Infinite loop: Agent repeats the same action
 * - No progress: Agent makes no meaningful progress
 * - Circular delegation: Agents delegate back and forth
 */

import type { AgentAction, DelegationRecord } from './specialist-validator';

/**
 * Stuck detection configuration
 */
export interface StuckDetectorConfig {
  /** Maximum time (ms) for a single agent response */
  responseTimeout: number;
  /** Maximum time (ms) for overall task completion */
  taskTimeout: number;
  /** Number of repeated actions before considering stuck */
  repeatThreshold: number;
  /** Time window (ms) for detecting no progress */
  progressWindow: number;
  /** Minimum actions expected in progress window */
  minActionsInWindow: number;
}

const DEFAULT_CONFIG: StuckDetectorConfig = {
  responseTimeout: 60000, // 1 minute
  taskTimeout: 600000, // 10 minutes
  repeatThreshold: 3,
  progressWindow: 30000, // 30 seconds
  minActionsInWindow: 1,
};

/**
 * Stuck detection result
 */
export interface StuckDetectionResult {
  isStuck: boolean;
  stuckType?: 'timeout' | 'infinite_loop' | 'no_progress' | 'circular_delegation';
  details?: string;
  suggestedRecovery?: string;
}

/**
 * Stuck Detector class for monitoring agent behavior
 */
export class StuckDetector {
  private config: StuckDetectorConfig;
  private actions: AgentAction[] = [];
  private delegations: DelegationRecord[] = [];
  private startTime: number = Date.now();
  private lastActionTime: number = Date.now();

  constructor(config: Partial<StuckDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record an agent action
   */
  recordAction(action: AgentAction): void {
    this.actions.push(action);
    this.lastActionTime = action.timestamp;
  }

  /**
   * Record a delegation
   */
  recordDelegation(delegation: DelegationRecord): void {
    this.delegations.push(delegation);
  }

  /**
   * Check if agent is stuck
   */
  checkStuck(): StuckDetectionResult {
    // Check response timeout
    const timeSinceLastAction = Date.now() - this.lastActionTime;
    if (timeSinceLastAction > this.config.responseTimeout) {
      return {
        isStuck: true,
        stuckType: 'timeout',
        details: `No response for ${Math.round(timeSinceLastAction / 1000)}s`,
        suggestedRecovery: 'Interrupt and retry with simpler prompt',
      };
    }

    // Check task timeout
    const totalTime = Date.now() - this.startTime;
    if (totalTime > this.config.taskTimeout) {
      return {
        isStuck: true,
        stuckType: 'timeout',
        details: `Task running for ${Math.round(totalTime / 1000)}s`,
        suggestedRecovery: 'Cancel task and break into smaller subtasks',
      };
    }

    // Check for infinite loop (repeated actions)
    const loopResult = this.detectInfiniteLoop();
    if (loopResult.isStuck) {
      return loopResult;
    }

    // Check for no progress
    const progressResult = this.detectNoProgress();
    if (progressResult.isStuck) {
      return progressResult;
    }

    // Check for circular delegation
    const circularResult = this.detectCircularDelegation();
    if (circularResult.isStuck) {
      return circularResult;
    }

    return { isStuck: false };
  }

  /**
   * Detect infinite loop (same action repeated)
   */
  private detectInfiniteLoop(): StuckDetectionResult {
    if (this.actions.length < this.config.repeatThreshold) {
      return { isStuck: false };
    }

    // Get last N actions
    const recentActions = this.actions.slice(-this.config.repeatThreshold);
    const toolCalls = recentActions.filter((a) => a.actionType === 'tool_call');

    if (toolCalls.length < this.config.repeatThreshold) {
      return { isStuck: false };
    }

    // Check if all recent tool calls are the same
    const firstTool = toolCalls[0].toolName;
    const allSame = toolCalls.every((a) => a.toolName === firstTool);

    if (allSame) {
      return {
        isStuck: true,
        stuckType: 'infinite_loop',
        details: `Tool "${firstTool}" called ${toolCalls.length} times in a row`,
        suggestedRecovery: 'Interrupt and provide different approach',
      };
    }

    return { isStuck: false };
  }

  /**
   * Detect no progress (no meaningful actions in time window)
   */
  private detectNoProgress(): StuckDetectionResult {
    const windowStart = Date.now() - this.config.progressWindow;
    const recentActions = this.actions.filter((a) => a.timestamp > windowStart);

    // If no actions at all, we can't determine no progress yet
    // (the agent might just be starting or thinking)
    if (recentActions.length === 0) {
      return { isStuck: false };
    }

    // Filter out non-meaningful actions (like just reading)
    const meaningfulActions = recentActions.filter(
      (a) =>
        a.actionType === 'tool_call' &&
        !['read_file', 'list_files', 'search'].includes(a.toolName || ''),
    );

    // Only flag as stuck if we have multiple non-meaningful actions
    // (agent is actively doing things but making no progress)
    if (recentActions.length >= 3 && meaningfulActions.length < this.config.minActionsInWindow) {
      return {
        isStuck: true,
        stuckType: 'no_progress',
        details: `Only ${meaningfulActions.length} meaningful actions in last ${this.config.progressWindow / 1000}s (${recentActions.length} total actions)`,
        suggestedRecovery: 'Provide more specific guidance or break down task',
      };
    }

    return { isStuck: false };
  }

  /**
   * Detect circular delegation (A -> B -> A)
   */
  private detectCircularDelegation(): StuckDetectionResult {
    if (this.delegations.length < 2) {
      return { isStuck: false };
    }

    // Build delegation graph
    const delegationPairs = new Set<string>();
    for (const d of this.delegations) {
      const pair = `${d.fromAgentId}->${d.toAgentId}`;
      const reversePair = `${d.toAgentId}->${d.fromAgentId}`;

      if (delegationPairs.has(reversePair)) {
        return {
          isStuck: true,
          stuckType: 'circular_delegation',
          details: `Circular delegation detected: ${d.fromAgentId} <-> ${d.toAgentId}`,
          suggestedRecovery: 'Review delegation logic and task boundaries',
        };
      }

      delegationPairs.add(pair);
    }

    return { isStuck: false };
  }

  /**
   * Reset the detector for a new test
   */
  reset(): void {
    this.actions = [];
    this.delegations = [];
    this.startTime = Date.now();
    this.lastActionTime = Date.now();
  }

  /**
   * Get current metrics
   */
  getMetrics(): {
    totalActions: number;
    totalDelegations: number;
    elapsedTime: number;
    timeSinceLastAction: number;
    } {
    return {
      totalActions: this.actions.length,
      totalDelegations: this.delegations.length,
      elapsedTime: Date.now() - this.startTime,
      timeSinceLastAction: Date.now() - this.lastActionTime,
    };
  }
}

/**
 * Create a stuck detector with custom config
 */
export function createStuckDetector(config?: Partial<StuckDetectorConfig>): StuckDetector {
  return new StuckDetector(config);
}
