/**
 * Memory Monitor for Main Process
 *
 * Provides memory pressure monitoring and GC hints to prevent
 * the GC pauses that cause UI freezes (beach balls).
 *
 * PERF: This module helps detect memory pressure early and
 * triggers incremental cleanup to avoid sudden GC pauses.
 */

import { Logger } from '../logger';

const logger = new Logger('MemoryMonitor');

// Memory thresholds (in MB)
// Note: Electron apps with multiple workspaces, agents, and git operations
// typically use 300-600MB during normal operation. These thresholds should
// allow for normal operation while still catching runaway memory usage.
const MEMORY_CONFIG = {
  // Warning threshold - start more aggressive cleanup
  WARNING_THRESHOLD_MB: 512,
  // Critical threshold - immediate cleanup needed
  CRITICAL_THRESHOLD_MB: 1024,
  // How often to check memory (ms)
  CHECK_INTERVAL_MS: 30000,
  // Maximum heap growth rate before warning (MB/minute)
  MAX_GROWTH_RATE_MB_PER_MIN: 100,
};

interface MemorySnapshot {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
}

class MemoryMonitor {
  private static instance: MemoryMonitor;
  private enabled = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private snapshots: MemorySnapshot[] = [];
  private maxSnapshots = 10;
  private listeners: Set<(level: 'normal' | 'warning' | 'critical') => void> = new Set();
  private lastGcHint = 0;
  private gcHintCooldown = 120000; // Only hint GC once per 2 minutes (reduced frequency to avoid SIGSEGV in AsyncWrap)

  private constructor() {}

  static getInstance(): MemoryMonitor {
    if (!MemoryMonitor.instance) {
      MemoryMonitor.instance = new MemoryMonitor();
    }
    return MemoryMonitor.instance;
  }

  /**
   * Start memory monitoring
   */
  start(): void {
    if (this.enabled) return;

    this.enabled = true;
    logger.info('Memory monitoring started', {
      warningThreshold: `${MEMORY_CONFIG.WARNING_THRESHOLD_MB}MB`,
      criticalThreshold: `${MEMORY_CONFIG.CRITICAL_THRESHOLD_MB}MB`,
      checkInterval: `${MEMORY_CONFIG.CHECK_INTERVAL_MS / 1000}s`,
    });

    this.checkInterval = setInterval(() => {
      this.checkMemory();
    }, MEMORY_CONFIG.CHECK_INTERVAL_MS);

    // Initial check
    this.checkMemory();
  }

  /**
   * Stop memory monitoring
   */
  stop(): void {
    if (!this.enabled) return;

    this.enabled = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    logger.info('Memory monitoring stopped');
  }

  /**
   * Add a listener for memory pressure events
   */
  onPressure(callback: (level: 'normal' | 'warning' | 'critical') => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Check current memory usage
   */
  private checkMemory(): void {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / (1024 * 1024);
    const heapTotalMB = memUsage.heapTotal / (1024 * 1024);

    // Store snapshot
    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss,
    };
    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }

    // Determine pressure level
    let level: 'normal' | 'warning' | 'critical' = 'normal';

    if (heapUsedMB > MEMORY_CONFIG.CRITICAL_THRESHOLD_MB) {
      level = 'critical';
      logger.error('CRITICAL memory pressure detected', {
        heapUsedMB: heapUsedMB.toFixed(1),
        heapTotalMB: heapTotalMB.toFixed(1),
        threshold: MEMORY_CONFIG.CRITICAL_THRESHOLD_MB,
      });
      this.hintGC('critical pressure');
    } else if (heapUsedMB > MEMORY_CONFIG.WARNING_THRESHOLD_MB) {
      level = 'warning';
      logger.warn('Memory pressure warning', {
        heapUsedMB: heapUsedMB.toFixed(1),
        heapTotalMB: heapTotalMB.toFixed(1),
        threshold: MEMORY_CONFIG.WARNING_THRESHOLD_MB,
      });
    }

    // Check growth rate
    const growthRate = this.calculateGrowthRate();
    if (growthRate > MEMORY_CONFIG.MAX_GROWTH_RATE_MB_PER_MIN) {
      logger.warn('High memory growth rate detected', {
        growthRateMBPerMin: growthRate.toFixed(1),
        maxAllowed: MEMORY_CONFIG.MAX_GROWTH_RATE_MB_PER_MIN,
      });
      if (level === 'normal') level = 'warning';
    }

    // Notify listeners
    this.listeners.forEach((cb) => cb(level));
  }

  /**
   * Calculate memory growth rate (MB per minute)
   */
  private calculateGrowthRate(): number {
    if (this.snapshots.length < 2) return 0;
    const oldest = this.snapshots[0];
    const newest = this.snapshots[this.snapshots.length - 1];
    const timeDiffMinutes = (newest.timestamp - oldest.timestamp) / 60000;
    if (timeDiffMinutes < 0.5) return 0; // Need at least 30 seconds of data
    const memDiffMB = (newest.heapUsed - oldest.heapUsed) / (1024 * 1024);
    return memDiffMB / timeDiffMinutes;
  }

  /**
   * Hint the garbage collector to run
   * Only works if Node was started with --expose-gc flag
   *
   * IMPORTANT: This is the ONLY place in the app that should call global.gc().
   * Multiple independent GC call sites can trigger V8 garbage collection at unsafe
   * moments while async resources (child processes, streams) are being torn down,
   * causing native SIGSEGV crashes in AsyncWrap::~AsyncWrap().
   * All other modules should emit events and let this centralized monitor handle GC.
   */
  hintGC(reason: string): void {
    const now = Date.now();
    if (now - this.lastGcHint < this.gcHintCooldown) {
      return; // Cooldown not elapsed
    }
    this.lastGcHint = now;
    if (typeof global.gc === 'function') {
      try {
        logger.info('Hinting incremental garbage collection', { reason });
        // Use minor (incremental) GC to reduce the risk of finalizing
        // async resources that are mid-teardown. Full GC is more likely
        // to encounter partially-destroyed AsyncWrap objects.
        // The options parameter { type: 'minor' } is supported by V8 but
        // may not be in the TypeScript type definitions.
        (global.gc as (options?: { type: string }) => void)({ type: 'minor' });
      } catch (error) {
        logger.error('Error during garbage collection hint', { error, reason });
      }
    }
  }

  /**
   * Get current memory stats
   */
  getStats(): { heapUsedMB: number; heapTotalMB: number; rssMB: number; level: string } {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / (1024 * 1024);
    let level = 'normal';
    if (heapUsedMB > MEMORY_CONFIG.CRITICAL_THRESHOLD_MB) level = 'critical';
    else if (heapUsedMB > MEMORY_CONFIG.WARNING_THRESHOLD_MB) level = 'warning';
    return {
      heapUsedMB: Math.round(heapUsedMB * 10) / 10,
      heapTotalMB: Math.round((memUsage.heapTotal / (1024 * 1024)) * 10) / 10,
      rssMB: Math.round((memUsage.rss / (1024 * 1024)) * 10) / 10,
      level,
    };
  }
}

export const memoryMonitor = MemoryMonitor.getInstance();
