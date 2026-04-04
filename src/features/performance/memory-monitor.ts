/**
 * Memory Monitor Service
 *
 * Monitors memory usage and triggers cleanup when thresholds are exceeded.
 * Helps prevent memory leaks and excessive memory consumption.
 */

import { EventEmitter } from '$shared/utils/event-emitter';
import { Logger } from '../../shared/logger';
import { TRACKING_CONFIG } from '../file-tracking/tracking.config';

const logger = new Logger('MemoryMonitor');

export interface MemoryStats {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  arrayBuffers: number;
  timestamp: number;
}

export interface MemoryAlert {
  level: 'warning' | 'critical';
  usage: number;
  threshold: number;
  message: string;
}

export class MemoryMonitor extends EventEmitter {
  private checkInterval: NodeJS.Timeout | null = null;
  private stats: MemoryStats[] = [];
  private maxStatsHistory = 100;
  private isMonitoring = false;

  constructor(
    private readonly warningThreshold = TRACKING_CONFIG.performance.memoryWarningThreshold,
    private readonly criticalThreshold = TRACKING_CONFIG.performance.memoryCriticalThreshold,
    private readonly checkIntervalMs = TRACKING_CONFIG.performance.memoryCheckInterval,
  ) {
    super();
  }

  /**
   * Start monitoring memory usage
   */
  start(): void {
    if (this.isMonitoring) {
      logger.warn('Memory monitor is already running');
      return;
    }

    this.isMonitoring = true;
    logger.info('Starting memory monitor', {
      warningThreshold: this.warningThreshold,
      criticalThreshold: this.criticalThreshold,
      checkInterval: this.checkIntervalMs,
    });

    this.checkInterval = setInterval(() => {
      this.checkMemory();
    }, this.checkIntervalMs);

    // Initial check
    this.checkMemory();
  }

  /**
   * Stop monitoring memory usage
   */
  stop(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    logger.info('Stopped memory monitor');
  }

  /**
   * Check current memory usage
   */
  private checkMemory(): void {
    // Check if we're in a Node.js environment with memoryUsage available
    if (typeof process === 'undefined' || typeof process.memoryUsage !== 'function') {
      // Use Performance API in browser if available
      if (
        typeof performance !== 'undefined' &&
        typeof (performance as any).memory !== 'undefined'
      ) {
        const perfMemory = (performance as any).memory;
        if (perfMemory && perfMemory.usedJSHeapSize) {
          const stats: MemoryStats = {
            heapUsed: perfMemory.usedJSHeapSize,
            heapTotal: perfMemory.jsHeapSizeLimit,
            external: 0,
            rss: 0,
            arrayBuffers: 0,
            timestamp: Date.now(),
          };

          this.stats.push(stats);
          if (this.stats.length > this.maxStatsHistory) {
            this.stats.shift();
          }

          this.emit('stats', stats);

          // Check thresholds
          const usage = stats.heapUsed;
          this.checkThresholds(usage);
          return;
        }
      }

      // No memory API available, skip
      return;
    }

    const memUsage = process.memoryUsage();
    const stats: MemoryStats = {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss,
      arrayBuffers: memUsage.arrayBuffers || 0,
      timestamp: Date.now(),
    };

    this.stats.push(stats);
    if (this.stats.length > this.maxStatsHistory) {
      this.stats.shift();
    }

    this.emit('stats', stats);

    // Check thresholds
    const usage = stats.heapUsed;
    this.checkThresholds(usage);
  }

  /**
   * Check memory thresholds and emit alerts
   */
  private checkThresholds(usage: number): void {
    if (usage > this.criticalThreshold) {
      const alert: MemoryAlert = {
        level: 'critical',
        usage,
        threshold: this.criticalThreshold,
        message: `Critical memory usage: ${this.formatBytes(usage)} / ${this.formatBytes(this.criticalThreshold)}`,
      };
      logger.error('Critical memory usage detected', alert);
      this.emit('alert', alert);
      this.triggerCleanup('critical');
    } else if (usage > this.warningThreshold) {
      const alert: MemoryAlert = {
        level: 'warning',
        usage,
        threshold: this.warningThreshold,
        message: `High memory usage: ${this.formatBytes(usage)} / ${this.formatBytes(this.warningThreshold)}`,
      };
      logger.warn('High memory usage detected', alert);
      this.emit('alert', alert);
      this.triggerCleanup('warning');
    }
  }

  /**
   * Trigger memory cleanup
   */
  private triggerCleanup(level: 'warning' | 'critical'): void {
    logger.info(`Triggering memory cleanup (${level})`);
    this.emit('cleanup', level);

    // NOTE: Do NOT call global.gc() here. Multiple independent GC call sites
    // can trigger V8 garbage collection at unsafe moments while async resources
    // (child processes, streams) are being torn down, causing native SIGSEGV crashes
    // in AsyncWrap::~AsyncWrap(). GC is centralized in shared/main/memory-monitor.ts.
  }

  /**
   * Get current memory stats
   */
  getCurrentStats(): MemoryStats | null {
    return this.stats[this.stats.length - 1] || null;
  }

  /**
   * Get memory stats history
   */
  getStatsHistory(): MemoryStats[] {
    return [...this.stats];
  }

  /**
   * Get average memory usage over time
   */
  getAverageUsage(durationMs = 60000): number {
    const now = Date.now();
    const relevantStats = this.stats.filter((s) => now - s.timestamp <= durationMs);

    if (relevantStats.length === 0) {
      return 0;
    }

    const sum = relevantStats.reduce((acc, s) => acc + s.heapUsed, 0);
    return sum / relevantStats.length;
  }

  /**
   * Get memory usage trend
   */
  getTrend(): 'increasing' | 'decreasing' | 'stable' {
    if (this.stats.length < 10) {
      return 'stable';
    }

    const recent = this.stats.slice(-10);
    const firstHalf = recent.slice(0, 5);
    const secondHalf = recent.slice(5);

    const avgFirst = firstHalf.reduce((acc, s) => acc + s.heapUsed, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((acc, s) => acc + s.heapUsed, 0) / secondHalf.length;

    const diff = avgSecond - avgFirst;
    const threshold = this.criticalThreshold * 0.05; // 5% change threshold

    if (diff > threshold) {
      return 'increasing';
    } else if (diff < -threshold) {
      return 'decreasing';
    } else {
      return 'stable';
    }
  }

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Get memory report
   */
  getReport(): {
    current: MemoryStats | null;
    average: number;
    trend: 'increasing' | 'decreasing' | 'stable';
    alerts: number;
    } {
    return {
      current: this.getCurrentStats(),
      average: this.getAverageUsage(),
      trend: this.getTrend(),
      alerts: this.listenerCount('alert'),
    };
  }
}

// Singleton instance
let memoryMonitor: MemoryMonitor | null = null;

/**
 * Get or create the memory monitor instance
 */
export function getMemoryMonitor(): MemoryMonitor {
  if (!memoryMonitor) {
    memoryMonitor = new MemoryMonitor();
  }
  return memoryMonitor;
}

/**
 * Start global memory monitoring
 */
export function startMemoryMonitoring(): void {
  const monitor = getMemoryMonitor();
  monitor.start();

  // Log memory stats periodically
  monitor.on('stats', (stats: MemoryStats) => {
    logger.debug('Memory stats', {
      heapUsed: `${(stats.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      heapTotal: `${(stats.heapTotal / 1024 / 1024).toFixed(2)} MB`,
      rss: `${(stats.rss / 1024 / 1024).toFixed(2)} MB`,
    });
  });

  // Handle memory alerts
  monitor.on('alert', (alert: MemoryAlert) => {
    logger.warn('Memory alert', alert);
  });

  // Handle cleanup requests
  monitor.on('cleanup', (level: string) => {
    logger.info(`Memory cleanup requested (${level})`);
    // Trigger cleanup in other components
    if (typeof process !== 'undefined' && typeof process.emit === 'function') {
      (process as any).emit('memory-cleanup', level);
    }
  });
}

/**
 * Stop global memory monitoring
 */
export function stopMemoryMonitoring(): void {
  const monitor = getMemoryMonitor();
  monitor.stop();
}
