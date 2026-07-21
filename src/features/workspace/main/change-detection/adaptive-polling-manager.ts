/**
 * Adaptive Polling Manager
 *
 * Dynamically adjusts polling intervals based on activity patterns
 * to optimize CPU usage and responsiveness.
 */

import { Logger } from '../../../../shared/logger';
import { EventEmitter } from '../../../../shared/event-emitter';

const logger = new Logger('AdaptivePollingManager');

export interface AdaptivePollingConfig {
  minInterval: number; // Minimum polling interval (ms)
  maxInterval: number; // Maximum polling interval (ms)
  idleThreshold: number; // Time without activity to consider idle (ms)
  activityBoost: number; // Multiplier for activity detection
  decayRate: number; // Rate at which interval increases (1.0-2.0)
  responseTime: number; // Target response time for changes (ms)
}

export interface ActivityMetrics {
  lastActivityTime: number;
  recentActivityCount: number;
  averageChangeSize: number;
  isUserActive: boolean;
  cpuUsage?: number;
}

export class AdaptivePollingManager extends EventEmitter {
  private static instance: AdaptivePollingManager;

  private config: AdaptivePollingConfig;
  private currentInterval: number;
  private activityMetrics: ActivityMetrics;
  private adjustmentTimer?: NodeJS.Timeout;
  private activityWindow: number[] = []; // Timestamps of recent activities
  private readonly ACTIVITY_WINDOW_SIZE = 10;
  private readonly ACTIVITY_WINDOW_DURATION = 60000; // 1 minute

  // PERF: Hysteresis and cooldown to prevent rapid interval oscillation
  // This prevents the git polling from being stopped/started repeatedly
  private lastIntervalChangeTime: number = 0;
  private readonly INTERVAL_CHANGE_COOLDOWN_MS = 30000; // 30 second cooldown
  private readonly HYSTERESIS_THRESHOLD_PERCENT = 0.25; // 25% change required

  private constructor(config?: Partial<AdaptivePollingConfig>) {
    super();

    // This singleton receives one `intervalChanged` listener per workspace
    // change-detector. With 10+ workspaces open simultaneously the default
    // limit of 10 fires MaxListenersExceededWarning even though each
    // detector cleanly deregisters its handler on stop(). Raise the cap so
    // legitimate per-workspace registration does not look like a leak.
    this.setMaxListeners(100);

    this.config = {
      minInterval: config?.minInterval ?? 2000, // 2 seconds
      maxInterval: config?.maxInterval ?? 30000, // 30 seconds
      idleThreshold: config?.idleThreshold ?? 60000, // 1 minute
      activityBoost: config?.activityBoost ?? 0.5, // 50% faster during activity
      decayRate: config?.decayRate ?? 1.2, // 20% increase per adjustment
      responseTime: config?.responseTime ?? 5000, // 5 second target response
    };

    this.currentInterval = this.config.minInterval;
    this.activityMetrics = {
      lastActivityTime: Date.now(),
      recentActivityCount: 0,
      averageChangeSize: 0,
      isUserActive: true,
    };

    this.startAdjustmentCycle();
    logger.info('AdaptivePollingManager initialized', { config: this.config });
  }

  static getInstance(config?: Partial<AdaptivePollingConfig>): AdaptivePollingManager {
    if (!AdaptivePollingManager.instance) {
      AdaptivePollingManager.instance = new AdaptivePollingManager(config);
    }
    return AdaptivePollingManager.instance;
  }

  /**
   * Get the current polling interval
   */
  getCurrentInterval(): number {
    return this.currentInterval;
  }

  /**
   * Record activity to influence polling rate
   */
  recordActivity(changeSize: number = 1, isUserInitiated: boolean = false): void {
    const now = Date.now();

    // Update activity window
    this.activityWindow.push(now);
    this.cleanActivityWindow();

    // Update metrics
    this.activityMetrics.lastActivityTime = now;
    this.activityMetrics.recentActivityCount = this.activityWindow.length;

    // Update average change size (exponential moving average)
    const alpha = 0.3; // Smoothing factor
    this.activityMetrics.averageChangeSize =
      alpha * changeSize + (1 - alpha) * this.activityMetrics.averageChangeSize;

    // If user-initiated, boost responsiveness immediately
    if (isUserInitiated) {
      this.activityMetrics.isUserActive = true;
      this.boostResponsiveness();
    }

    logger.debug('Activity recorded', {
      changeSize,
      isUserInitiated,
      recentActivityCount: this.activityMetrics.recentActivityCount,
      currentInterval: this.currentInterval,
    });
  }

  /**
   * Record user interaction (typing, clicking, etc.)
   */
  recordUserInteraction(): void {
    this.activityMetrics.isUserActive = true;
    this.activityMetrics.lastActivityTime = Date.now();
    this.boostResponsiveness();
  }

  /**
   * Update CPU usage metric for consideration
   */
  updateCpuUsage(usage: number): void {
    this.activityMetrics.cpuUsage = usage;
  }

  /**
   * Boost responsiveness for immediate activity
   */
  private boostResponsiveness(): void {
    // Apply the same cooldown as adjustInterval() to prevent rapid interval churn
    const now = Date.now();
    const timeSinceLastChange = now - this.lastIntervalChangeTime;
    if (timeSinceLastChange < this.INTERVAL_CHANGE_COOLDOWN_MS) {
      logger.debug('Skipping responsiveness boost due to cooldown', {
        timeSinceLastChange,
        cooldown: this.INTERVAL_CHANGE_COOLDOWN_MS,
      });
      return;
    }

    const boostedInterval = Math.max(
      this.config.minInterval,
      this.currentInterval * this.config.activityBoost,
    );

    if (boostedInterval < this.currentInterval) {
      const oldInterval = this.currentInterval;
      this.setInterval(boostedInterval);
      // Only update cooldown timer if the interval actually changed
      if (this.currentInterval !== oldInterval) {
        this.lastIntervalChangeTime = now;
        logger.debug('Boosted responsiveness', {
          oldInterval,
          newInterval: this.currentInterval,
        });
      }
    }
  }

  /**
   * Start the automatic adjustment cycle
   */
  private startAdjustmentCycle(): void {
    // Adjust every 10 seconds
    this.adjustmentTimer = setInterval(() => {
      this.adjustInterval();
    }, 10000);
  }

  /**
   * Adjust polling interval based on activity patterns
   */
  private adjustInterval(): void {
    const now = Date.now();
    const timeSinceLastActivity = now - this.activityMetrics.lastActivityTime;

    // Clean up old activity records
    this.cleanActivityWindow();

    // Determine if we're idle
    const isIdle = timeSinceLastActivity > this.config.idleThreshold;

    // Calculate activity rate (activities per minute)
    const activityRate = this.activityWindow.length;

    // Calculate target interval based on activity
    let targetInterval: number;

    if (isIdle && !this.activityMetrics.isUserActive) {
      // System is idle, use maximum interval
      targetInterval = this.config.maxInterval;
    } else if (activityRate > 5) {
      // High activity, use minimum interval
      targetInterval = this.config.minInterval;
    } else if (activityRate > 2) {
      // Moderate activity
      targetInterval = this.config.minInterval * 2;
    } else if (activityRate > 0) {
      // Low activity
      targetInterval = this.config.minInterval * 4;
    } else {
      // No recent activity, gradually increase interval
      targetInterval = Math.min(
        this.currentInterval * this.config.decayRate,
        this.config.maxInterval,
      );
    }

    // Consider CPU usage if available
    if (this.activityMetrics.cpuUsage !== undefined) {
      if (this.activityMetrics.cpuUsage > 80) {
        // High CPU usage, back off
        targetInterval = Math.min(targetInterval * 1.5, this.config.maxInterval);
      }
    }

    // PERF: Apply hysteresis and cooldown to prevent oscillation
    // This is important because every interval change causes git polling to restart
    const timeSinceLastChange = now - this.lastIntervalChangeTime;
    const changePercent = Math.abs(targetInterval - this.currentInterval) / this.currentInterval;

    // Only change if:
    // 1. Cooldown period has passed, AND
    // 2. Change is significant (exceeds hysteresis threshold)
    const shouldChange =
      timeSinceLastChange >= this.INTERVAL_CHANGE_COOLDOWN_MS &&
      changePercent >= this.HYSTERESIS_THRESHOLD_PERCENT;

    if (shouldChange) {
      this.setInterval(targetInterval);
      this.lastIntervalChangeTime = now;
    }

    // Reset user active flag after idle period
    if (isIdle) {
      this.activityMetrics.isUserActive = false;
    }
  }

  /**
   * Set a new polling interval
   */
  private setInterval(interval: number): void {
    const oldInterval = this.currentInterval;
    this.currentInterval = Math.round(
      Math.max(this.config.minInterval, Math.min(this.config.maxInterval, interval)),
    );

    if (oldInterval !== this.currentInterval) {
      // PERF: Changed from INFO to DEBUG - interval changes are now less frequent
      // and less critical due to hysteresis and cooldown
      logger.debug('Polling interval adjusted', {
        oldInterval,
        newInterval: this.currentInterval,
        activityRate: this.activityWindow.length,
        isUserActive: this.activityMetrics.isUserActive,
      });

      this.emit('intervalChanged', {
        oldInterval,
        newInterval: this.currentInterval,
        metrics: { ...this.activityMetrics },
      });
    }
  }

  /**
   * Clean up old activity records
   */
  private cleanActivityWindow(): void {
    const cutoff = Date.now() - this.ACTIVITY_WINDOW_DURATION;
    this.activityWindow = this.activityWindow.filter((time) => time > cutoff);

    // Keep window size limited
    if (this.activityWindow.length > this.ACTIVITY_WINDOW_SIZE) {
      this.activityWindow = this.activityWindow.slice(-this.ACTIVITY_WINDOW_SIZE);
    }
  }

  /**
   * Get current activity metrics
   */
  getMetrics(): ActivityMetrics {
    return { ...this.activityMetrics };
  }

  /**
   * Reset to default state
   */
  reset(): void {
    this.currentInterval = this.config.minInterval;
    this.activityMetrics = {
      lastActivityTime: Date.now(),
      recentActivityCount: 0,
      averageChangeSize: 0,
      isUserActive: true,
    };
    this.activityWindow = [];
    logger.info('AdaptivePollingManager reset');
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.adjustmentTimer) {
      clearInterval(this.adjustmentTimer);
      this.adjustmentTimer = undefined;
    }
    this.removeAllListeners();
    logger.info('AdaptivePollingManager destroyed');
  }

  /**
   * Get statistics for monitoring
   */
  getStatistics(): {
    currentInterval: number;
    activityRate: number;
    timeSinceLastActivity: number;
    isIdle: boolean;
    cpuSavings: number;
    } {
    const now = Date.now();
    const timeSinceLastActivity = now - this.activityMetrics.lastActivityTime;
    const isIdle = timeSinceLastActivity > this.config.idleThreshold;

    // Calculate CPU savings as percentage reduction from minimum interval
    const cpuSavings =
      ((this.currentInterval - this.config.minInterval) /
        (this.config.maxInterval - this.config.minInterval)) *
      100;

    return {
      currentInterval: this.currentInterval,
      activityRate: this.activityWindow.length,
      timeSinceLastActivity,
      isIdle,
      cpuSavings: Math.round(cpuSavings),
    };
  }
}
