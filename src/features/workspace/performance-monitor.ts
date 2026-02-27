/**
 * Performance Monitor
 *
 * Monitors and reports performance metrics to prevent browser hangs.
 * Provides utilities for detecting and preventing performance issues.
 */

import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('PerformanceMonitor');

export interface PerformanceMetrics {
  renderTime: number;
  updateTime: number;
  memoryUsage: number;
  domNodes: number;
  listeners: number;
  pendingOperations: number;
}

export class PerformanceMonitor {
  private metrics: PerformanceMetrics = {
    renderTime: 0,
    updateTime: 0,
    memoryUsage: 0,
    domNodes: 0,
    listeners: 0,
    pendingOperations: 0,
  };

  private observers: PerformanceObserver[] = [];
  private rafHandle: number | null = null;
  private monitoring = false;
  private slowOperationThreshold = 100; // ms
  private memoryWarningThreshold = 100 * 1024 * 1024; // 100MB

  /**
   * Start monitoring performance
   */
  start(): void {
    if (this.monitoring) return;
    this.monitoring = true;

    // Monitor long tasks
    if ('PerformanceObserver' in window) {
      try {
        const longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration > this.slowOperationThreshold) {
              logger.warn(`Long task detected: ${entry.duration}ms`, {
                name: entry.name,
                startTime: entry.startTime,
              });
            }
          }
        });
        longTaskObserver.observe({ entryTypes: ['longtask'] });
        this.observers.push(longTaskObserver);
      } catch (e) {
        // Long task observer not supported
      }
    }

    // Monitor memory usage
    this.monitorMemory();

    // Monitor DOM size
    this.monitorDOM();
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    this.monitoring = false;

    // Disconnect observers
    this.observers.forEach((observer) => observer.disconnect());
    this.observers = [];

    // Cancel RAF
    if (this.rafHandle) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  /**
   * Monitor memory usage
   */
  private monitorMemory(): void {
    if (!this.monitoring) return;

    // Check if memory API is available
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      this.metrics.memoryUsage = memory.usedJSHeapSize;

      if (memory.usedJSHeapSize > this.memoryWarningThreshold) {
        logger.warn(`High memory usage: ${Math.round(memory.usedJSHeapSize / 1024 / 1024)}MB`);
      }
    }

    // Check again in 5 seconds
    if (this.monitoring) {
      setTimeout(() => this.monitorMemory(), 5000);
    }
  }

  /**
   * Monitor DOM size
   */
  private monitorDOM(): void {
    if (!this.monitoring) return;

    this.rafHandle = requestAnimationFrame(() => {
      this.metrics.domNodes = document.getElementsByTagName('*').length;

      if (this.metrics.domNodes > 10000) {
        logger.warn(`High DOM node count: ${this.metrics.domNodes}`);
      }

      // Count event listeners (approximate)
      const listeners = this.countEventListeners();
      if (listeners > 1000) {
        logger.warn(`High event listener count: ${listeners}`);
      }

      // Continue monitoring
      if (this.monitoring) {
        setTimeout(() => this.monitorDOM(), 10000); // Check every 10 seconds
      }
    });
  }

  /**
   * Count approximate number of event listeners
   * PERFORMANCE: Sample DOM elements instead of iterating all
   */
  private countEventListeners(): number {
    // This is an approximation - actual count would require browser internals
    // PERFORMANCE: Only sample a subset of elements to avoid O(n) DOM traversal
    const MAX_SAMPLE_SIZE = 100;
    const allElements = document.querySelectorAll('*');
    const totalElements = allElements.length;

    // If few elements, check all; otherwise sample
    if (totalElements <= MAX_SAMPLE_SIZE) {
      let count = 0;
      allElements.forEach((element) => {
        const attrs = element.attributes;
        for (let i = 0; i < attrs.length; i++) {
          if (attrs[i].name.startsWith('on')) {
            count++;
          }
        }
      });
      return count;
    }

    // Sample evenly distributed elements
    let sampleCount = 0;
    const step = Math.floor(totalElements / MAX_SAMPLE_SIZE);
    for (let i = 0; i < totalElements; i += step) {
      const element = allElements[i];
      const attrs = element.attributes;
      for (let j = 0; j < attrs.length; j++) {
        if (attrs[j].name.startsWith('on')) {
          sampleCount++;
        }
      }
    }

    // Extrapolate from sample
    return Math.round((sampleCount / MAX_SAMPLE_SIZE) * totalElements);
  }

  /**
   * Measure operation time
   */
  async measureOperation<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const start = performance.now();

    try {
      const result = await operation();
      const duration = performance.now() - start;

      if (duration > this.slowOperationThreshold) {
        logger.warn(`Slow operation "${name}": ${duration}ms`);
      }

      return result;
    } catch (error) {
      const duration = performance.now() - start;
      logger.error(`Operation "${name}" failed after ${duration}ms`, error);
      throw error;
    }
  }

  /**
   * Check if browser is under pressure
   */
  isUnderPressure(): boolean {
    // Check memory
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      if (memory.usedJSHeapSize > this.memoryWarningThreshold) {
        return true;
      }
    }

    // Check DOM nodes
    if (this.metrics.domNodes > 10000) {
      return true;
    }

    return false;
  }

  /**
   * Get current metrics
   */
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  /**
   * Use requestIdleCallback for non-critical work
   */
  scheduleIdleWork(callback: () => void, timeout: number = 1000): void {
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(callback, { timeout });
    } else {
      // Fallback to setTimeout
      setTimeout(callback, 16);
    }
  }

  /**
   * Batch DOM updates using requestAnimationFrame
   */
  batchDOMUpdate(update: () => void): void {
    if (this.rafHandle) {
      cancelAnimationFrame(this.rafHandle);
    }

    this.rafHandle = requestAnimationFrame(() => {
      update();
      this.rafHandle = null;
    });
  }

}
