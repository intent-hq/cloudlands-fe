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

export class PerformanceMonitor {
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

/**
 * Debounce function execution
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function (...args: Parameters<T>) {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Throttle function execution
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number,
): (...args: Parameters<T>) => void {
  let inThrottle = false;

  return function (...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Memoize function results
 */
export function memoize<T extends (...args: any[]) => any>(
  func: T,
  keyGenerator?: (...args: Parameters<T>) => string,
): T {
  const cache = new Map<string, ReturnType<T>>();

  return ((...args: Parameters<T>) => {
    const key = keyGenerator ? keyGenerator(...args) : JSON.stringify(args);

    if (cache.has(key)) {
      return cache.get(key);
    }

    const result = func(...args);
    cache.set(key, result);
    return result;
  }) as T;
}

/**
 * Lazy load a module
 */
export async function lazyLoad<T>(loader: () => Promise<T>): Promise<T> {
  return loader();
}

/**
 * Request idle callback with fallback
 */
export function requestIdleCallback(callback: () => void, options?: { timeout?: number }): number {
  if ('requestIdleCallback' in window) {
    return (window as any).requestIdleCallback(callback, options);
  }

  // Fallback to setTimeout
  return setTimeout(callback, options?.timeout || 0) as unknown as number;
}

/**
 * Cancel idle callback
 */
export function cancelIdleCallback(id: number): void {
  if ('cancelIdleCallback' in window) {
    (window as any).cancelIdleCallback(id);
  } else {
    clearTimeout(id);
  }
}

/**
 * Event listener manager to prevent duplicate registrations
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
type AnyFunction = Function;

export class EventListenerManager {
  private listeners = new Map<string, Set<AnyFunction>>();
  private nativeListeners = new Map<EventTarget, Map<string, Set<AnyFunction>>>();

  /**
   * Add event listener (prevents duplicates)
   */
  addEventListener(
    target: EventTarget,
    event: string,
    handler: AnyFunction,
    options?: AddEventListenerOptions,
  ): void {
    // Get or create listener map for target
    if (!this.nativeListeners.has(target)) {
      this.nativeListeners.set(target, new Map());
    }

    const targetListeners = this.nativeListeners.get(target)!;

    // Get or create event set
    if (!targetListeners.has(event)) {
      targetListeners.set(event, new Set());
    }

    const eventListeners = targetListeners.get(event)!;

    // Only add if not already registered
    if (!eventListeners.has(handler)) {
      eventListeners.add(handler);
      target.addEventListener(event, handler as EventListener, options);
    }
  }

  /**
   * Remove event listener
   */
  removeEventListener(target: EventTarget, event: string, handler: AnyFunction): void {
    const targetListeners = this.nativeListeners.get(target);
    if (!targetListeners) return;

    const eventListeners = targetListeners.get(event);
    if (!eventListeners) return;

    if (eventListeners.has(handler)) {
      eventListeners.delete(handler);
      target.removeEventListener(event, handler as EventListener);

      // Clean up empty sets
      if (eventListeners.size === 0) {
        targetListeners.delete(event);
      }

      if (targetListeners.size === 0) {
        this.nativeListeners.delete(target);
      }
    }
  }

  /**
   * Remove all listeners for a target
   */
  removeAllListeners(target?: EventTarget): void {
    if (target) {
      const targetListeners = this.nativeListeners.get(target);
      if (targetListeners) {
        targetListeners.forEach((handlers, event) => {
          handlers.forEach((handler) => {
            target.removeEventListener(event, handler as EventListener);
          });
        });
        this.nativeListeners.delete(target);
      }
    } else {
      // Remove all listeners
      this.nativeListeners.forEach((targetListeners, target) => {
        targetListeners.forEach((handlers, event) => {
          handlers.forEach((handler) => {
            target.removeEventListener(event, handler as EventListener);
          });
        });
      });
      this.nativeListeners.clear();
    }
  }

  /**
   * Custom event listener management (non-DOM)
   */
  on(event: string, handler: AnyFunction): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    this.listeners.get(event)!.add(handler);
  }

  /**
   * Remove custom event listener
   */
  off(event: string, handler: AnyFunction): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * Emit custom event
   */
  emit(event: string, ...args: any[]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(...args);
        } catch (error) {
          logger.error(
            `Error in event handler for ${event}:`,
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      });
    }
  }
}

/**
 * Performance monitor (duplicate - using the one above)
 */
class PerformanceMonitor2 {
  private marks = new Map<string, number>();
  private measures = new Map<string, number[]>();

  /**
   * Mark a performance point
   */
  mark(name: string): void {
    this.marks.set(name, performance.now());
  }

  /**
   * Measure between two marks
   */
  measure(name: string, startMark: string, endMark?: string): number {
    const start = this.marks.get(startMark);
    if (!start) {
      logger.warn(`Start mark ${startMark} not found`);
      return 0;
    }

    const end = endMark ? this.marks.get(endMark) : performance.now();
    if (!end) {
      logger.warn(`End mark ${endMark} not found`);
      return 0;
    }

    const duration = end - start;

    // Store measure
    if (!this.measures.has(name)) {
      this.measures.set(name, []);
    }
    this.measures.get(name)!.push(duration);

    return duration;
  }

  /**
   * Get average measure
   */
  getAverage(name: string): number {
    const measures = this.measures.get(name);
    if (!measures || measures.length === 0) return 0;

    return measures.reduce((a, b) => a + b, 0) / measures.length;
  }

  /**
   * Clear all marks and measures
   */
  clear(): void {
    this.marks.clear();
    this.measures.clear();
  }

  /**
   * Log performance summary
   */
  logSummary(): void {
    logger.debug('Performance Summary');
    this.measures.forEach((values, name) => {
      const avg = this.getAverage(name);
      const min = Math.min(...values);
      const max = Math.max(...values);
      logger.debug(
        `${name}: avg=${avg.toFixed(2)}ms, min=${min.toFixed(2)}ms, max=${max.toFixed(2)}ms`,
      );
    });
  }
}

// Export singleton instances
export const eventManager = new EventListenerManager();
export const perfMonitor = new PerformanceMonitor2();
