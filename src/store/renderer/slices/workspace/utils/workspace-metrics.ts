/**
 * Workspace Performance Metrics
 *
 * Tracks timing and performance metrics for workspace operations
 * to help identify bottlenecks and optimize the user experience.
 */

import { Logger } from '$lib/utils/logger';

const logger = new Logger({ category: 'WorkspaceMetrics' });

interface MetricEntry {
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: Record<string, any>;
}

interface WorkspaceMetrics {
  workspaceId: string;
  creationStarted: number;
  optimisticNavigation?: number;
  realWorkspaceCreated?: number;
  agentCreated?: number;
  agentReady?: number;
  firstMessageSent?: number;
  firstResponseReceived?: number;
  firstChunkReceived?: number;
  totalDuration?: number;
}

class WorkspaceMetricsTracker {
  private metrics = new Map<string, WorkspaceMetrics>();
  private operations = new Map<string, MetricEntry>();

  /**
   * Start tracking a new workspace creation
   */
  startWorkspaceCreation(workspaceId: string): void {
    const now = Date.now();
    this.metrics.set(workspaceId, {
      workspaceId,
      creationStarted: now,
    });

    logger.info('Started tracking workspace creation', { workspaceId });
  }

  /**
   * Record a milestone in the workspace creation process
   */
  recordMilestone(workspaceId: string, milestone: keyof WorkspaceMetrics): void {
    const metrics = this.metrics.get(workspaceId);
    if (!metrics) {
      logger.warn('No metrics found for workspace', { workspaceId, milestone });
      return;
    }

    const now = Date.now();
    // Type-safe property assignment
    switch (milestone) {
      case 'optimisticNavigation':
        metrics.optimisticNavigation = now;
        break;
      case 'realWorkspaceCreated':
        metrics.realWorkspaceCreated = now;
        break;
      case 'agentCreated':
        metrics.agentCreated = now;
        break;
      case 'agentReady':
        metrics.agentReady = now;
        break;
      case 'firstMessageSent':
        metrics.firstMessageSent = now;
        break;
      case 'firstResponseReceived':
        metrics.firstResponseReceived = now;
        break;
      case 'firstChunkReceived':
        metrics.firstChunkReceived = now;
        break;
      case 'totalDuration':
        metrics.totalDuration = now;
        break;
      case 'workspaceId':
      case 'creationStarted':
        // These are read-only or shouldn't be updated this way
        logger.warn('Cannot update milestone', { milestone });
        return;
    }

    const elapsed = now - metrics.creationStarted;
    logger.info(`Milestone: ${milestone}`, {
      workspaceId,
      elapsed: `${elapsed}ms`,
      timestamp: now,
    });

    // Calculate total duration if this is the last milestone
    if (milestone === 'firstResponseReceived') {
      metrics.totalDuration = now - metrics.creationStarted;
      this.logSummary(workspaceId);
    }
  }

  /**
   * Start tracking a generic operation
   */
  startOperation(operationId: string, metadata?: Record<string, any>): void {
    this.operations.set(operationId, {
      startTime: Date.now(),
      metadata,
    });
  }

  /**
   * End tracking a generic operation
   */
  endOperation(operationId: string, metadata?: Record<string, any>): number | null {
    const operation = this.operations.get(operationId);
    if (!operation) {
      logger.warn('Operation not found', { operationId });
      return null;
    }

    const now = Date.now();
    operation.endTime = now;
    operation.duration = now - operation.startTime;

    if (metadata) {
      operation.metadata = { ...operation.metadata, ...metadata };
    }

    logger.info('Operation completed', {
      operationId,
      duration: `${operation.duration}ms`,
      metadata: operation.metadata,
    });

    return operation.duration;
  }

  /**
   * Get metrics for a workspace
   */
  getMetrics(workspaceId: string): WorkspaceMetrics | undefined {
    return this.metrics.get(workspaceId);
  }

  /**
   * Log a summary of workspace creation metrics
   */
  private logSummary(workspaceId: string): void {
    const metrics = this.metrics.get(workspaceId);
    if (!metrics) return;

    const summary = {
      workspaceId,
      totalDuration: `${metrics.totalDuration}ms`,
      stages: {
        optimisticNavigation: metrics.optimisticNavigation
          ? `${metrics.optimisticNavigation - metrics.creationStarted}ms`
          : 'N/A',
        realWorkspaceCreation: metrics.realWorkspaceCreated
          ? `${metrics.realWorkspaceCreated - metrics.creationStarted}ms`
          : 'N/A',
        agentCreation: metrics.agentCreated
          ? `${metrics.agentCreated - metrics.creationStarted}ms`
          : 'N/A',
        agentReady: metrics.agentReady
          ? `${metrics.agentReady - metrics.creationStarted}ms`
          : 'N/A',
        firstMessage: metrics.firstMessageSent
          ? `${metrics.firstMessageSent - metrics.creationStarted}ms`
          : 'N/A',
        firstResponse: metrics.firstResponseReceived
          ? `${metrics.firstResponseReceived - metrics.creationStarted}ms`
          : 'N/A',
      },
    };

    logger.info('=== Workspace Creation Metrics Summary ===', summary);

    // Also log to console for visibility
    logger.info('Workspace Creation Metrics:', summary);
  }

  /**
   * Clear metrics for a workspace
   */
  clearMetrics(workspaceId: string): void {
    this.metrics.delete(workspaceId);
  }

  /**
   * Increment agent created counter
   */
  incrementAgentCreated(workspaceId: string): void {
    const metrics = this.metrics.get(workspaceId);
    if (metrics) {
      metrics.agentCreated = Date.now();
      logger.info('Agent created', { workspaceId });
    }
  }

  /**
   * Increment message sent counter
   */
  incrementMessageSent(workspaceId: string): void {
    const metrics = this.metrics.get(workspaceId);
    if (metrics && !metrics.firstMessageSent) {
      metrics.firstMessageSent = Date.now();
      logger.info('First message sent', { workspaceId });
    }
  }
}

// Export singleton instance
export const workspaceMetrics = new WorkspaceMetricsTracker();
