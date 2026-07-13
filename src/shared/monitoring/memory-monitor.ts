/**
 * Memory Monitor
 *
 * Monitors memory usage and triggers cleanup when thresholds are exceeded.
 */

import { EventEmitter } from '../event-emitter';
import { logger } from '../logger';

export interface MemoryStats {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  timestamp: number;
}

export interface MemoryConfig {
  checkInterval: number; // milliseconds
  warningThreshold: number; // bytes
  criticalThreshold: number; // bytes
  enableGC: boolean;
}

const DEFAULT_CONFIG: MemoryConfig = {
  checkInterval: 60 * 1000, // 1 minute
  warningThreshold: 500 * 1024 * 1024, // 500MB
  criticalThreshold: 1024 * 1024 * 1024, // 1GB
  enableGC: true,
};

/**
 * Monitors memory usage and emits events when thresholds are exceeded
 */
export class MemoryMonitor extends EventEmitter {
  private config: MemoryConfig;
  private interval: NodeJS.Timeout | null = null;
  private stats: MemoryStats[] = [];
  private maxStatsHistory = 100;

  // Throttle warnings to avoid log spam
  private lastWarningTime = 0;
  private readonly WARNING_INTERVAL = 60000; // 1 minute between warnings

  constructor(config: Partial<MemoryConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start monitoring
   */
  start(): void {
    if (this.interval) return;

    this.interval = setInterval(() => {
      this.checkMemory();
    }, this.config.checkInterval);

    logger.info('Memory monitor started', {
      checkInterval: this.config.checkInterval,
      warningThreshold: this.config.warningThreshold,
      criticalThreshold: this.config.criticalThreshold,
    });
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      logger.info('Memory monitor stopped');
    }
  }

  /**
   * Check current memory usage
   */
  private checkMemory(): void {
    if (typeof process === 'undefined' || !process.memoryUsage) {
      return;
    }

    const usage = process.memoryUsage();
    const stats: MemoryStats = {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      rss: usage.rss,
      timestamp: Date.now(),
    };

    this.stats.push(stats);
    if (this.stats.length > this.maxStatsHistory) {
      this.stats.shift();
    }

    this.emit('stats', stats);

    // Check thresholds
    const now = Date.now();
    const shouldLogWarning = now - this.lastWarningTime >= this.WARNING_INTERVAL;

    if (stats.heapUsed > this.config.criticalThreshold) {
      if (shouldLogWarning) {
        this.lastWarningTime = now;
        logger.warn('Critical memory usage detected', {
          heapUsedMB: Math.round(stats.heapUsed / 1024 / 1024),
          thresholdMB: Math.round(this.config.criticalThreshold / 1024 / 1024),
        });
      }
      this.triggerCleanup('critical');
    } else if (stats.heapUsed > this.config.warningThreshold) {
      if (shouldLogWarning) {
        this.lastWarningTime = now;
        logger.warn('High memory usage detected', {
          heapUsedMB: Math.round(stats.heapUsed / 1024 / 1024),
          thresholdMB: Math.round(this.config.warningThreshold / 1024 / 1024),
        });
      }
      this.triggerCleanup('warning');
    }
  }

  /**
   * Trigger cleanup
   */
  private triggerCleanup(level: 'warning' | 'critical'): void {
    this.emit('cleanup-needed', { level });

    // NOTE: Do NOT call global.gc() here. Multiple independent GC call sites
    // can trigger V8 garbage collection at unsafe moments while async resources
    // (child processes, streams) are being torn down, causing native SIGSEGV crashes
    // in AsyncWrap::~AsyncWrap(). GC is centralized in shared/main/memory-monitor.ts.
  }

  /**
   * Get current memory stats
   */
  getStats(): MemoryStats | null {
    return this.stats.length > 0 ? this.stats[this.stats.length - 1] : null;
  }

  /**
   * Get memory stats history
   */
  getHistory(): MemoryStats[] {
    return [...this.stats];
  }

  /**
   * Get average memory usage
   */
  getAverageUsage(): number {
    if (this.stats.length === 0) return 0;
    const sum = this.stats.reduce((acc, s) => acc + s.heapUsed, 0);
    return sum / this.stats.length;
  }
}

/**
 * Singleton instance
 */
let instance: MemoryMonitor | null = null;

/**
 * Get or create memory monitor instance
 *
 * Note: Config is only used on first instantiation.
 * To use different config, call resetMemoryMonitor() first.
 */
export function getMemoryMonitor(config?: Partial<MemoryConfig>): MemoryMonitor {
  if (!instance) {
    instance = new MemoryMonitor(config);
  }
  return instance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetMemoryMonitor(): void {
  if (instance) {
    instance.stop();
    instance = null;
  }
}
