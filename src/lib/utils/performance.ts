/**
 * Performance Optimization Utilities
 *
 * Provides utilities for optimizing performance across the application.
 */

interface PerformanceMetric {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: Record<string, any>;
}

class PerformanceMonitor {
  private metrics: Map<string, PerformanceMetric> = new Map();
  private completedMetrics: PerformanceMetric[] = [];
  private maxCompletedMetrics = 100;

  /**
   * Start measuring a performance metric
   */
  start(name: string, metadata?: Record<string, any>): void {
    if (!debugConfig.get('showPerformanceMetrics')) return;

    this.metrics.set(name, {
      name,
      startTime: performance.now(),
      metadata,
    });
  }

  /**
   * End measuring a performance metric
   */
  end(name: string): number | null {
    if (!debugConfig.get('showPerformanceMetrics')) return null;

    const metric = this.metrics.get(name);
    if (!metric) {
      logger.warn(`Performance metric "${name}" was not started`);
      return null;
    }

    metric.endTime = performance.now();
    metric.duration = metric.endTime - metric.startTime;

    // Move to completed metrics
    this.metrics.delete(name);
    this.completedMetrics.push(metric);

    // Keep only the last N metrics
    if (this.completedMetrics.length > this.maxCompletedMetrics) {
      this.completedMetrics.shift();
    }

    // Log if enabled
    if (debugConfig.get('logStateChanges')) {
      logger.info(`[Performance] ${name}: ${metric.duration.toFixed(2)}ms`, metric.metadata);
    }

    return metric.duration;
  }

  /**
   * Measure the execution time of a function
   */
  async measure<T>(
    name: string,
    fn: () => T | Promise<T>,
    metadata?: Record<string, any>,
  ): Promise<T> {
    this.start(name, metadata);
    try {
      const result = await fn();
      this.end(name);
      return result;
    } catch (error) {
      this.end(name);
      throw error;
    }
  }

  /**
   * Get all completed metrics
   */
  getMetrics(): PerformanceMetric[] {
    return [...this.completedMetrics];
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear();
    this.completedMetrics = [];
  }
}

// Export singleton instance
export const performanceMonitor = new PerformanceMonitor();

import { Logger } from '$shared/logger';
import { debugConfig } from '$lib/config/debug';

const logger = new Logger('Performance');
