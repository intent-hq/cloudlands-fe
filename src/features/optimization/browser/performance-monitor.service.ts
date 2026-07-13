/**
 * Performance Monitor Service
 *
 * Monitors application performance metrics and provides insights
 */

import { logger } from '$shared/logger';

interface PerformanceMetrics {
  memoryUsage: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
  domNodes: number;
  eventListeners: number;
  timers: {
    active: number;
    intervals: number;
  };
  renderTime: number;
  fps: number;
}

interface PerformanceThresholds {
  memoryUsageMB: number;
  domNodes: number;
  eventListeners: number;
  renderTimeMs: number;
  minFPS: number;
}

class PerformanceMonitorService {
  private static instance: PerformanceMonitorService;
  private metrics: PerformanceMetrics | null = null;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private frameCount = 0;
  private lastFrameTime = 0;
  private fps = 60;

  private readonly DEFAULT_THRESHOLDS: PerformanceThresholds = {
    memoryUsageMB: 2000, // 2GB - more reasonable for Electron app
    domNodes: 10000,
    eventListeners: 1000,
    renderTimeMs: 16, // 60 FPS
    minFPS: 30,
  };

  private thresholds: PerformanceThresholds;
  private warningCallbacks = new Set<(metrics: PerformanceMetrics) => void>();

  private constructor() {
    this.thresholds = { ...this.DEFAULT_THRESHOLDS };
    this.startFPSMonitoring();
  }

  static getInstance(): PerformanceMonitorService {
    if (!PerformanceMonitorService.instance) {
      PerformanceMonitorService.instance = new PerformanceMonitorService();
    }
    return PerformanceMonitorService.instance;
  }

  /**
   * Start monitoring performance
   */
  startMonitoring(intervalMs = 5000): void {
    if (this.monitoringInterval) {
      logger.warn('Performance monitoring already started');
      return;
    }

    logger.info('Starting performance monitoring', { intervalMs });

    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
      this.checkThresholds();
    }, intervalMs);

    // Collect initial metrics
    this.collectMetrics();
  }

  /**
   * Stop monitoring performance
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      logger.info('Performance monitoring stopped');
    }
  }

  /**
   * Collect performance metrics
   */
  private collectMetrics(): void {
    if (typeof window === 'undefined') return;

    const metrics: PerformanceMetrics = {
      memoryUsage: this.getMemoryUsage(),
      domNodes: document.getElementsByTagName('*').length,
      eventListeners: this.countEventListeners(),
      timers: this.countTimers(),
      renderTime: this.measureRenderTime(),
      fps: this.fps,
    };

    this.metrics = metrics;

    logger.debug('Performance metrics collected', {
      memoryUsageMB: Math.round(metrics.memoryUsage.usedJSHeapSize / 1024 / 1024),
      domNodes: metrics.domNodes,
      eventListeners: metrics.eventListeners,
      fps: Math.round(metrics.fps),
    });
  }

  /**
   * Get memory usage
   */
  private getMemoryUsage(): PerformanceMetrics['memoryUsage'] {
    if ((performance as any).memory) {
      return {
        usedJSHeapSize: (performance as any).memory.usedJSHeapSize,
        totalJSHeapSize: (performance as any).memory.totalJSHeapSize,
        jsHeapSizeLimit: (performance as any).memory.jsHeapSizeLimit,
      };
    }

    // Fallback for browsers without memory API
    return {
      usedJSHeapSize: 0,
      totalJSHeapSize: 0,
      jsHeapSizeLimit: 0,
    };
  }

  /**
   * Count event listeners (approximation)
   */
  private countEventListeners(): number {
    // This is an approximation - actual count requires browser dev tools
    let count = 0;

    // Count listeners on common targets
    const targets = [window, document, document.body];
    const events = ['click', 'scroll', 'resize', 'keydown', 'keyup', 'change', 'input'];

    for (const target of targets) {
      if (!target) continue;
      for (const event of events) {
        // Check if listener exists (this is a heuristic)
        if ((target as any)[`on${event}`]) {
          count++;
        }
      }
    }

    // Add DOM element listeners (sample)
    const elements = document.querySelectorAll('*');
    const sampleSize = Math.min(100, elements.length);
    for (let i = 0; i < sampleSize; i++) {
      const element = elements[i] as any;
      for (const event of events) {
        if (element[`on${event}`]) {
          count++;
        }
      }
    }

    // Extrapolate from sample
    if (sampleSize > 0) {
      count = Math.round(count * (elements.length / sampleSize));
    }

    return count;
  }

  /**
   * Count active timers (approximation)
   */
  private countTimers(): PerformanceMetrics['timers'] {
    // This is an approximation - actual count requires tracking all setTimeout/setInterval calls
    return {
      active: 0, // Would need to track manually
      intervals: 0, // Would need to track manually
    };
  }

  /**
   * Measure render time
   */
  private measureRenderTime(): number {
    if (typeof window === 'undefined' || !window.performance) return 0;

    const entries = performance.getEntriesByType('measure');
    if (entries.length === 0) return 0;

    const recentEntries = entries.slice(-10);
    const totalDuration = recentEntries.reduce((sum, entry) => sum + entry.duration, 0);

    return totalDuration / recentEntries.length;
  }

  /**
   * Start FPS monitoring
   */
  private startFPSMonitoring(): void {
    if (typeof window === 'undefined') return;

    const measureFPS = (timestamp: number) => {
      if (this.lastFrameTime > 0) {
        const delta = timestamp - this.lastFrameTime;
        const instantFPS = 1000 / delta;

        // Smooth FPS calculation
        this.fps = this.fps * 0.9 + instantFPS * 0.1;
      }

      this.lastFrameTime = timestamp;
      this.frameCount++;

      requestAnimationFrame(measureFPS);
    };

    requestAnimationFrame(measureFPS);
  }

  /**
   * Check thresholds and trigger warnings
   */
  private checkThresholds(): void {
    if (!this.metrics) return;

    const warnings: string[] = [];

    // Check memory usage
    const memoryUsageMB = this.metrics.memoryUsage.usedJSHeapSize / 1024 / 1024;
    if (memoryUsageMB > this.thresholds.memoryUsageMB) {
      warnings.push(`High memory usage: ${Math.round(memoryUsageMB)}MB`);
    }

    // Check DOM nodes
    if (this.metrics.domNodes > this.thresholds.domNodes) {
      warnings.push(`Too many DOM nodes: ${this.metrics.domNodes}`);
    }

    // Check event listeners
    if (this.metrics.eventListeners > this.thresholds.eventListeners) {
      warnings.push(`Too many event listeners: ${this.metrics.eventListeners}`);
    }

    // Check FPS
    if (this.metrics.fps < this.thresholds.minFPS) {
      warnings.push(`Low FPS: ${Math.round(this.metrics.fps)}`);
    }

    if (warnings.length > 0) {
      logger.warn('Performance warnings detected', { warnings });

      // Notify callbacks
      for (const callback of this.warningCallbacks) {
        try {
          callback(this.metrics);
        } catch (error) {
          logger.error('Error in performance warning callback', error);
        }
      }
    }
  }

  /**
   * Register a callback for performance warnings
   */
  onWarning(callback: (metrics: PerformanceMetrics) => void): () => void {
    this.warningCallbacks.add(callback);

    return () => {
      this.warningCallbacks.delete(callback);
    };
  }

  /**
   * Get current metrics
   */
  getMetrics(): PerformanceMetrics | null {
    return this.metrics;
  }

  /**
   * Set custom thresholds
   */
  setThresholds(thresholds: Partial<PerformanceThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
    logger.info('Performance thresholds updated', this.thresholds);
  }

  /**
   * Get performance report
   */
  getReport(): string {
    if (!this.metrics) return 'No metrics available';

    const memoryUsageMB = Math.round(this.metrics.memoryUsage.usedJSHeapSize / 1024 / 1024);
    const memoryPercentage = Math.round(
      (this.metrics.memoryUsage.usedJSHeapSize / this.metrics.memoryUsage.jsHeapSizeLimit) * 100,
    );

    return `
Performance Report:
==================
Memory: ${memoryUsageMB}MB (${memoryPercentage}% of limit)
DOM Nodes: ${this.metrics.domNodes}
Event Listeners: ${this.metrics.eventListeners}
FPS: ${Math.round(this.metrics.fps)}
Render Time: ${this.metrics.renderTime.toFixed(2)}ms
    `.trim();
  }
}

export const performanceMonitor = PerformanceMonitorService.getInstance();
