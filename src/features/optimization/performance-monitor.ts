/**
 * Performance Monitoring System
 *
 * Tracks performance metrics and identifies bottlenecks
 * to help optimize the application.
 */

import { Logger } from '$lib/utils/logger';

const logger = new Logger({ category: 'PerformanceMonitor' });

interface PerformanceMetric {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: Record<string, any>;
}

interface PerformanceReport {
  slowOperations: PerformanceMetric[];
  averageDurations: Map<string, number>;
  totalOperations: number;
  p95Duration: number;
  p99Duration: number;
}

class PerformanceMonitor {
  private metrics: Map<string, PerformanceMetric[]> = new Map();
  private activeTimers: Map<string, PerformanceMetric> = new Map();
  private thresholds = {
    slow: 100, // ms
    verySlow: 500, // ms
    critical: 1000, // ms
  };

  /**
   * Start timing an operation
   */
  startTimer(name: string, metadata?: Record<string, any>): string {
    const metric: PerformanceMetric = {
      name,
      startTime: performance.now(),
      metadata,
    };

    const key = `${name}-${Date.now()}-${Math.random()}`;
    this.activeTimers.set(key, metric);

    // Return key for ending timer
    return key;
  }

  /**
   * End timing an operation
   */
  endTimer(key: string): number {
    const metric = this.activeTimers.get(key);
    if (!metric) {
      logger.warn(`Timer ${key} not found`);
      return 0;
    }

    metric.endTime = performance.now();
    metric.duration = metric.endTime - metric.startTime;

    // Store metric
    let metricList = this.metrics.get(metric.name);
    if (!metricList) {
      metricList = [];
      this.metrics.set(metric.name, metricList);
    }
    metricList.push(metric);

    // Clean up
    this.activeTimers.delete(key);

    // Log if slow
    if (metric.duration > this.thresholds.critical) {
      logger.error(
        `CRITICAL: ${metric.name} took ${metric.duration.toFixed(2)}ms`,
        new Error('Performance critical'),
        metric.metadata,
      );
    } else if (metric.duration > this.thresholds.verySlow) {
      logger.warn(
        `Very slow: ${metric.name} took ${metric.duration.toFixed(2)}ms`,
        metric.metadata,
      );
    } else if (metric.duration > this.thresholds.slow) {
      logger.debug(`Slow: ${metric.name} took ${metric.duration.toFixed(2)}ms`, metric.metadata);
    }

    return metric.duration;
  }

  /**
   * Measure a function's execution time
   */
  async measure<T>(
    name: string,
    fn: () => T | Promise<T>,
    metadata?: Record<string, any>,
  ): Promise<T> {
    const key = this.startTimer(name, metadata);
    try {
      const result = await fn();
      return result;
    } finally {
      this.endTimer(key);
    }
  }

  /**
   * Get performance report
   */
  getReport(): PerformanceReport {
    const allMetrics: PerformanceMetric[] = [];
    const averageDurations = new Map<string, number>();

    // Collect all metrics
    for (const [name, metrics] of this.metrics) {
      allMetrics.push(...metrics);

      // Calculate average
      const durations = metrics
        .map((m) => m.duration)
        .filter((d): d is number => d !== undefined);

      if (durations.length > 0) {
        const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
        averageDurations.set(name, avg);
      }
    }

    // Sort by duration
    const sortedMetrics = allMetrics
      .filter((m) => m.duration !== undefined)
      .sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));

    // Calculate percentiles
    const durations = sortedMetrics.map((m) => m.duration ?? 0);
    const p95Index = Math.floor(durations.length * 0.95);
    const p99Index = Math.floor(durations.length * 0.99);

    return {
      slowOperations: sortedMetrics.slice(0, 10), // Top 10 slowest
      averageDurations,
      totalOperations: allMetrics.length,
      p95Duration: durations[p95Index] || 0,
      p99Duration: durations[p99Index] || 0,
    };
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear();
    this.activeTimers.clear();
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor();
