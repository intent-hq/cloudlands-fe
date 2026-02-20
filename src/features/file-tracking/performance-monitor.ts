/**
 * Performance Monitor for File Tracking System
 *
 * Tracks and reports performance metrics for the file tracking
 * and activity logging system.
 */

import { EventEmitter } from '$shared/utils/event-emitter';
import { Logger } from '../../shared/logger';

const logger = new Logger('PerformanceMonitor');

export interface PerformanceMetrics {
  // Timing metrics (in milliseconds)
  gitPollDuration: number;
  eventProcessingTime: number;
  fileWatcherResponseTime: number;
  ipcRoundTripTime: number;
  uiRenderTime: number;

  // Resource metrics
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };

  // Count metrics
  activeWatchers: number;
  eventQueueSize: number;
  trackedFiles: number;
  pendingChanges: number;

  // Throughput metrics
  eventsPerSecond: number;
  changesPerSecond: number;

  // Error metrics
  errorCount: number;
  warningCount: number;

  // Timestamp
  timestamp: string;
}

export interface PerformanceThresholds {
  maxGitPollDuration: number;
  maxEventProcessingTime: number;
  maxMemoryUsage: number;
  maxEventQueueSize: number;
  maxErrorRate: number;
}

export class PerformanceMonitor extends EventEmitter {
  private static instance: PerformanceMonitor | null = null;

  private metrics: Partial<PerformanceMetrics> = {};
  private timers: Map<string, number> = new Map();
  private counters: Map<string, number> = new Map();
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private thresholds: PerformanceThresholds;
  private isMonitoring = false;

  // Rolling window for rate calculations
  private eventTimestamps: number[] = [];
  private changeTimestamps: number[] = [];
  private errorTimestamps: number[] = [];
  private readonly WINDOW_SIZE = 60000; // 1 minute window

  // Throttle threshold warnings to avoid log spam
  private lastThresholdWarningTime = 0;
  private readonly THRESHOLD_WARNING_INTERVAL = 60000; // 1 minute between warnings

  private constructor() {
    super();

    this.thresholds = {
      maxGitPollDuration: 1000, // 1 second
      maxEventProcessingTime: 100, // 100ms
      maxMemoryUsage: 2000 * 1024 * 1024, // 2GB - more reasonable for Electron app
      maxEventQueueSize: 1000,
      maxErrorRate: 10, // 10 errors per minute
    };

    this.initialize();
  }

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  private initialize(): void {
    // Reset metrics
    this.metrics = {
      gitPollDuration: 0,
      eventProcessingTime: 0,
      fileWatcherResponseTime: 0,
      ipcRoundTripTime: 0,
      uiRenderTime: 0,
      memoryUsage: {
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        rss: 0,
      },
      activeWatchers: 0,
      eventQueueSize: 0,
      trackedFiles: 0,
      pendingChanges: 0,
      eventsPerSecond: 0,
      changesPerSecond: 0,
      errorCount: 0,
      warningCount: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Start monitoring performance
   */
  start(intervalMs = 5000): void {
    if (this.isMonitoring) {
      logger.warn('Performance monitoring already started');
      return;
    }

    this.isMonitoring = true;
    logger.info('Starting performance monitoring', { intervalMs });

    // Start memory monitoring
    const memoryInterval = setInterval(() => {
      this.updateMemoryMetrics();
    }, intervalMs);
    this.intervals.set('memory', memoryInterval);

    // Start rate calculations
    const rateInterval = setInterval(() => {
      this.calculateRates();
    }, 1000); // Calculate rates every second
    this.intervals.set('rates', rateInterval);

    // Start threshold checking
    const thresholdInterval = setInterval(() => {
      this.checkThresholds();
    }, intervalMs);
    this.intervals.set('thresholds', thresholdInterval);

    // Emit metrics periodically
    const emitInterval = setInterval(() => {
      this.emitMetrics();
    }, intervalMs);
    this.intervals.set('emit', emitInterval);
  }

  /**
   * Stop monitoring performance
   */
  stop(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    logger.info('Stopping performance monitoring');

    // Clear all intervals
    for (const [name, interval] of this.intervals) {
      clearInterval(interval);
    }
    this.intervals.clear();

    // Clear timers and counters
    this.timers.clear();
    this.counters.clear();
  }

  /**
   * Start timing an operation
   */
  startTimer(operation: string): void {
    this.timers.set(operation, Date.now());
  }

  /**
   * End timing an operation and record the duration
   */
  endTimer(operation: string): number {
    const startTime = this.timers.get(operation);
    if (!startTime) {
      // Use debug level - this can happen during normal operation when
      // polling is restarted or during concurrent operations
      logger.debug(`No timer found for operation: ${operation}`);
      return 0;
    }

    const duration = Date.now() - startTime;
    this.timers.delete(operation);

    // Update corresponding metric
    switch (operation) {
      case 'gitPoll':
        this.metrics.gitPollDuration = duration;
        break;
      case 'eventProcessing':
        this.metrics.eventProcessingTime = duration;
        break;
      case 'fileWatcher':
        this.metrics.fileWatcherResponseTime = duration;
        break;
      case 'ipcRoundTrip':
        this.metrics.ipcRoundTripTime = duration;
        break;
      case 'uiRender':
        this.metrics.uiRenderTime = duration;
        break;
    }

    return duration;
  }

  /**
   * Increment a counter
   */
  incrementCounter(name: string, amount = 1): void {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + amount);

    // Update corresponding metric
    switch (name) {
      case 'activeWatchers':
        this.metrics.activeWatchers = current + amount;
        break;
      case 'eventQueueSize':
        this.metrics.eventQueueSize = current + amount;
        break;
      case 'trackedFiles':
        this.metrics.trackedFiles = current + amount;
        break;
      case 'pendingChanges':
        this.metrics.pendingChanges = current + amount;
        break;
      case 'errors':
        this.metrics.errorCount = (this.metrics.errorCount || 0) + amount;
        this.errorTimestamps.push(Date.now());
        break;
      case 'warnings':
        this.metrics.warningCount = (this.metrics.warningCount || 0) + amount;
        break;
    }
  }

  /**
   * Record an event occurrence
   */
  recordEvent(): void {
    this.eventTimestamps.push(Date.now());
  }

  /**
   * Record a change occurrence
   */
  recordChange(): void {
    this.changeTimestamps.push(Date.now());
  }

  /**
   * Update memory metrics
   */
  private updateMemoryMetrics(): void {
    // Check if we're in a Node.js environment with memoryUsage available
    if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
      const memUsage = process.memoryUsage();
      this.metrics.memoryUsage = {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss,
      };
    } else if (
      typeof performance !== 'undefined' &&
      typeof (performance as any).memory !== 'undefined'
    ) {
      // Use Performance API in browser if available
      const perfMemory = (performance as any).memory;
      if (perfMemory && perfMemory.usedJSHeapSize) {
        this.metrics.memoryUsage = {
          heapUsed: perfMemory.usedJSHeapSize,
          heapTotal: perfMemory.jsHeapSizeLimit,
          external: 0,
          rss: 0,
        };
      } else {
        // Fallback: set to zero if no memory API available
        this.metrics.memoryUsage = {
          heapUsed: 0,
          heapTotal: 0,
          external: 0,
          rss: 0,
        };
      }
    } else {
      // Fallback: set to zero if no memory API available
      this.metrics.memoryUsage = {
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        rss: 0,
      };
    }
  }

  /**
   * Calculate rates based on rolling windows
   */
  private calculateRates(): void {
    const now = Date.now();
    const windowStart = now - this.WINDOW_SIZE;

    // Clean old timestamps and calculate rates
    this.eventTimestamps = this.eventTimestamps.filter((t) => t > windowStart);
    this.changeTimestamps = this.changeTimestamps.filter((t) => t > windowStart);
    this.errorTimestamps = this.errorTimestamps.filter((t) => t > windowStart);

    // Calculate per-second rates
    this.metrics.eventsPerSecond = (this.eventTimestamps.length / this.WINDOW_SIZE) * 1000;
    this.metrics.changesPerSecond = (this.changeTimestamps.length / this.WINDOW_SIZE) * 1000;
  }

  /**
   * Check if any metrics exceed thresholds
   */
  private checkThresholds(): void {
    const alerts: string[] = [];

    if (
      this.metrics.gitPollDuration &&
      this.metrics.gitPollDuration > this.thresholds.maxGitPollDuration
    ) {
      alerts.push(
        `Git poll duration (${this.metrics.gitPollDuration}ms) exceeds threshold (${this.thresholds.maxGitPollDuration}ms)`,
      );
    }

    if (
      this.metrics.eventProcessingTime &&
      this.metrics.eventProcessingTime > this.thresholds.maxEventProcessingTime
    ) {
      alerts.push(
        `Event processing time (${this.metrics.eventProcessingTime}ms) exceeds threshold (${this.thresholds.maxEventProcessingTime}ms)`,
      );
    }

    if (
      this.metrics.memoryUsage &&
      this.metrics.memoryUsage.heapUsed > this.thresholds.maxMemoryUsage
    ) {
      const usedMB = Math.round(this.metrics.memoryUsage.heapUsed / 1024 / 1024);
      const thresholdMB = Math.round(this.thresholds.maxMemoryUsage / 1024 / 1024);
      alerts.push(`Memory usage (${usedMB}MB) exceeds threshold (${thresholdMB}MB)`);
    }

    if (
      this.metrics.eventQueueSize &&
      this.metrics.eventQueueSize > this.thresholds.maxEventQueueSize
    ) {
      alerts.push(
        `Event queue size (${this.metrics.eventQueueSize}) exceeds threshold (${this.thresholds.maxEventQueueSize})`,
      );
    }

    const errorRate = this.errorTimestamps.length;
    if (errorRate > this.thresholds.maxErrorRate) {
      alerts.push(
        `Error rate (${errorRate}/min) exceeds threshold (${this.thresholds.maxErrorRate}/min)`,
      );
    }

    if (alerts.length > 0) {
      // Always emit event for cleanup triggers
      this.emit('threshold-exceeded', alerts);

      // Throttle warning logs to avoid spam (once per minute max)
      const now = Date.now();
      if (now - this.lastThresholdWarningTime >= this.THRESHOLD_WARNING_INTERVAL) {
        this.lastThresholdWarningTime = now;
        logger.warn('Performance thresholds exceeded', { alerts });
      }
    }
  }

  /**
   * Emit current metrics
   */
  private emitMetrics(): void {
    this.metrics.timestamp = new Date().toISOString();
    this.emit('metrics', this.getMetrics());
  }

  /**
   * Get current metrics
   */
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics } as PerformanceMetrics;
  }

  /**
   * Set custom thresholds
   */
  setThresholds(thresholds: Partial<PerformanceThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
    logger.info('Updated performance thresholds', this.thresholds);
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.initialize();
    this.eventTimestamps = [];
    this.changeTimestamps = [];
    this.errorTimestamps = [];
    logger.info('Performance metrics reset');
  }
}
