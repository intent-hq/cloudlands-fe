/**
 * Event System Performance Monitor
 *
 * Tracks performance metrics for the event system
 */

import { Logger } from '../../shared/logger';

const logger = new Logger('EventPerformanceMonitor');

export interface PerformanceMetrics {
  eventEmissions: number;
  eventSubscriptions: number;
  averageEmissionTime: number;
  averageCallbackTime: number;
  deduplicationHits: number;
  deduplicationMisses: number;
  errorCount: number;
  memoryUsage: number;
  bufferSize: number;
  subscriberCount: number;
}

export interface TimingEntry {
  operation: string;
  duration: number;
  timestamp: string;
  workspaceId?: string;
  eventType?: string;
}

export class EventPerformanceMonitor {
  private static instance: EventPerformanceMonitor;
  private metrics: Map<string, PerformanceMetrics> = new Map();
  private timings: TimingEntry[] = [];
  private readonly maxTimings = 1000;
  private startTimes: Map<string, number> = new Map();

  private constructor() {
    // Start periodic reporting
    this.startPeriodicReporting();
  }

  static getInstance(): EventPerformanceMonitor {
    if (!EventPerformanceMonitor.instance) {
      EventPerformanceMonitor.instance = new EventPerformanceMonitor();
    }
    return EventPerformanceMonitor.instance;
  }

  /**
   * Start timing an operation
   */
  startTiming(operationId: string): void {
    this.startTimes.set(operationId, performance.now());
  }

  /**
   * End timing an operation
   */
  endTiming(
    operationId: string,
    operation: string,
    context?: {
      workspaceId?: string;
      eventType?: string;
    },
  ): number {
    const startTime = this.startTimes.get(operationId);
    if (!startTime) {
      logger.warn('No start time found for operation', { operationId });
      return 0;
    }

    const duration = performance.now() - startTime;
    this.startTimes.delete(operationId);

    // Record timing
    this.recordTiming({
      operation,
      duration,
      timestamp: new Date().toISOString(),
      ...context,
    });

    return duration;
  }

  /**
   * Record a timing entry
   */
  private recordTiming(entry: TimingEntry): void {
    this.timings.push(entry);

    // Limit stored timings
    if (this.timings.length > this.maxTimings) {
      this.timings.shift();
    }

    // Update metrics
    this.updateMetrics(entry);

    // Log slow operations
    if (entry.duration > 100) {
      logger.warn('Slow operation detected', {
        operation: entry.operation,
        duration: `${entry.duration.toFixed(2)}ms`,
        workspaceId: entry.workspaceId,
        eventType: entry.eventType,
      });
    }
  }

  /**
   * Update metrics based on timing entry
   */
  private updateMetrics(entry: TimingEntry): void {
    const workspaceId = entry.workspaceId || 'global';
    let metrics = this.metrics.get(workspaceId);

    if (!metrics) {
      metrics = this.createEmptyMetrics();
      this.metrics.set(workspaceId, metrics);
    }

    // Update based on operation type
    if (entry.operation === 'emit') {
      metrics.eventEmissions++;
      metrics.averageEmissionTime = this.updateAverage(
        metrics.averageEmissionTime,
        entry.duration,
        metrics.eventEmissions,
      );
    } else if (entry.operation === 'callback') {
      metrics.averageCallbackTime = this.updateAverage(
        metrics.averageCallbackTime,
        entry.duration,
        metrics.eventSubscriptions,
      );
    }
  }

  /**
   * Update running average
   */
  private updateAverage(currentAvg: number, newValue: number, count: number): number {
    return (currentAvg * (count - 1) + newValue) / count;
  }

  /**
   * Create empty metrics object
   */
  private createEmptyMetrics(): PerformanceMetrics {
    return {
      eventEmissions: 0,
      eventSubscriptions: 0,
      averageEmissionTime: 0,
      averageCallbackTime: 0,
      deduplicationHits: 0,
      deduplicationMisses: 0,
      errorCount: 0,
      memoryUsage: 0,
      bufferSize: 0,
      subscriberCount: 0,
    };
  }

  /**
   * Record event emission
   */
  recordEmission(workspaceId: string, duration: number): void {
    this.recordTiming({
      operation: 'emit',
      duration,
      timestamp: new Date().toISOString(),
      workspaceId,
    });
  }

  /**
   * Record callback execution
   */
  recordCallback(workspaceId: string, duration: number): void {
    this.recordTiming({
      operation: 'callback',
      duration,
      timestamp: new Date().toISOString(),
      workspaceId,
    });
  }

  /**
   * Record deduplication hit
   */
  recordDeduplicationHit(workspaceId: string): void {
    const metrics = this.getOrCreateMetrics(workspaceId);
    metrics.deduplicationHits++;
  }

  /**
   * Record deduplication miss
   */
  recordDeduplicationMiss(workspaceId: string): void {
    const metrics = this.getOrCreateMetrics(workspaceId);
    metrics.deduplicationMisses++;
  }

  /**
   * Record error
   */
  recordError(workspaceId: string): void {
    const metrics = this.getOrCreateMetrics(workspaceId);
    metrics.errorCount++;
  }

  /**
   * Update buffer size
   */
  updateBufferSize(workspaceId: string, size: number): void {
    const metrics = this.getOrCreateMetrics(workspaceId);
    metrics.bufferSize = size;
  }

  /**
   * Update subscriber count
   */
  updateSubscriberCount(workspaceId: string, count: number): void {
    const metrics = this.getOrCreateMetrics(workspaceId);
    metrics.subscriberCount = count;
  }

  /**
   * Get or create metrics for workspace
   */
  private getOrCreateMetrics(workspaceId: string): PerformanceMetrics {
    let metrics = this.metrics.get(workspaceId);
    if (!metrics) {
      metrics = this.createEmptyMetrics();
      this.metrics.set(workspaceId, metrics);
    }
    return metrics;
  }

  /**
   * Get metrics for a workspace
   */
  getMetrics(workspaceId: string): PerformanceMetrics | undefined {
    return this.metrics.get(workspaceId);
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): Map<string, PerformanceMetrics> {
    return new Map(this.metrics);
  }

  /**
   * Get recent timings
   */
  getRecentTimings(count = 100): TimingEntry[] {
    return this.timings.slice(-count);
  }

  /**
   * Get slow operations
   */
  getSlowOperations(threshold = 50): TimingEntry[] {
    return this.timings.filter((t) => t.duration > threshold);
  }

  /**
   * Clear all metrics
   */
  clearMetrics(): void {
    this.metrics.clear();
    this.timings = [];
    this.startTimes.clear();
  }

  private reportingInterval: NodeJS.Timeout | null = null;

  /**
   * Start periodic reporting
   */
  private startPeriodicReporting(): void {
    this.reportingInterval = setInterval(() => {
      this.reportMetrics();
    }, 60000); // Report every minute
  }

  /**
   * Stop periodic reporting
   */
  public stopPeriodicReporting(): void {
    if (this.reportingInterval) {
      clearInterval(this.reportingInterval);
      this.reportingInterval = null;
    }
  }

  /**
   * Report current metrics
   */
  private reportMetrics(): void {
    for (const [workspaceId, metrics] of this.metrics) {
      // Update memory usage
      if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
        metrics.memoryUsage = process.memoryUsage().heapUsed;
      } else if (
        typeof performance !== 'undefined' &&
        typeof (performance as any).memory !== 'undefined'
      ) {
        // Use Performance API in browser if available
        const perfMemory = (performance as any).memory;
        if (perfMemory && perfMemory.usedJSHeapSize) {
          metrics.memoryUsage = perfMemory.usedJSHeapSize;
        } else {
          metrics.memoryUsage = 0;
        }
      } else {
        metrics.memoryUsage = 0;
      }

      // Log if there are significant metrics
      if (metrics.eventEmissions > 0 || metrics.errorCount > 0) {
        logger.info('Performance metrics', {
          workspaceId,
          emissions: metrics.eventEmissions,
          avgEmissionTime: `${metrics.averageEmissionTime.toFixed(2)}ms`,
          avgCallbackTime: `${metrics.averageCallbackTime.toFixed(2)}ms`,
          deduplicationRate:
            metrics.deduplicationHits + metrics.deduplicationMisses > 0
              ? `${(
                (metrics.deduplicationHits /
                    (metrics.deduplicationHits + metrics.deduplicationMisses)) *
                  100
              ).toFixed(1)}%`
              : 'N/A',
          errors: metrics.errorCount,
          memoryUsage: `${(metrics.memoryUsage / 1024 / 1024).toFixed(2)}MB`,
          bufferSize: metrics.bufferSize,
          subscribers: metrics.subscriberCount,
        });
      }
    }
  }

  /**
   * Export metrics for analysis
   */
  exportMetrics(): string {
    const data = {
      metrics: Object.fromEntries(this.metrics),
      timings: this.timings,
      timestamp: new Date().toISOString(),
    };
    return JSON.stringify(data, null, 2);
  }
}

// Export singleton instance
export const eventPerformanceMonitor = EventPerformanceMonitor.getInstance();
