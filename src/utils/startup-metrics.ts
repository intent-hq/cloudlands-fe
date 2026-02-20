import { Logger } from '../shared/logger';

const logger = new Logger('StartupMetrics');

/**
 * Structure for tracking individual startup metrics.
 */
interface StartupMetric {
  /** Name of the metric being tracked */
  name: string;
  /** Timestamp when tracking started */
  startTime: number;
  /** Timestamp when tracking ended */
  endTime?: number;
  /** Calculated duration in milliseconds */
  duration?: number;
}

/**
 * Service for tracking and analyzing application startup performance.
 * Helps identify bottlenecks and optimize initialization sequences.
 *
 * @example
 * ```typescript
 * startupMetrics.start('database-init');
 * await initDatabase();
 * startupMetrics.end('database-init');
 *
 * // At end of startup
 * startupMetrics.logSummary();
 * ```
 */
class StartupMetrics {
  private metrics: Map<string, StartupMetric> = new Map();
  private appStartTime: number;

  constructor() {
    this.appStartTime = Date.now();
  }

  /**
   * Start tracking a named metric.
   * Records the current timestamp as the start time.
   *
   * @param name - Unique name for the metric
   * @example
   * ```typescript
   * startupMetrics.start('config-load');
   * ```
   */
  start(name: string): void {
    this.metrics.set(name, {
      name,
      startTime: Date.now(),
    });
  }

  /**
   * End tracking a metric and calculate its duration.
   * Logs the duration and marks the metric as completed.
   *
   * @param name - Name of the metric to end
   * @example
   * ```typescript
   * startupMetrics.end('config-load');
   * // Logs: [StartupMetrics] config-load: 123ms
   * ```
   */
  end(name: string): void {
    const metric = this.metrics.get(name);
    if (!metric) {
      logger.warn(`Metric ${name} was not started`);
      return;
    }

    metric.endTime = Date.now();
    metric.duration = metric.endTime - metric.startTime;

    logger.info(`${name}: ${metric.duration}ms`);
  }

  /**
   * Get all tracked metrics with their durations and completion status.
   *
   * @returns Object containing all metrics and total startup time
   * @example
   * ```typescript
   * const metrics = startupMetrics.getMetrics();
   * console.log(`Total startup: ${metrics.totalStartupTime}ms`);
   * ```
   */
  getMetrics(): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [name, metric] of this.metrics) {
      // Use nullish coalescing to handle 0ms durations correctly
      // (0 is a valid duration, not a missing value)
      result[name] = {
        duration: metric.duration ?? Date.now() - metric.startTime,
        completed: !!metric.endTime,
      };
    }

    result.totalStartupTime = Date.now() - this.appStartTime;

    return result;
  }

  /**
   * Log a comprehensive summary of all startup metrics.
   * Includes total time, individual metrics sorted by duration,
   * and identifies performance bottlenecks (>500ms).
   *
   * @example
   * ```typescript
   * // At the end of application startup
   * startupMetrics.logSummary();
   * // Outputs formatted performance summary to logs
   * ```
   */
  logSummary(): void {
    const metrics = this.getMetrics();
    const totalTime = metrics.totalStartupTime;

    // Sort metrics by duration
    const sortedMetrics = Object.entries(metrics)
      .filter(([key]) => key !== 'totalStartupTime')
      .sort((a, b) => (b[1] as any).duration - (a[1] as any).duration);

    // Build a compact summary line
    const summaryParts = sortedMetrics.map(([name, data]) => {
      const { duration } = data as any;
      return `${name}=${duration}ms`;
    });

    // Single-line compact output
    console.log(`\n⚡ Startup: ${totalTime}ms [${summaryParts.join(', ')}]\n`);

    // Identify bottlenecks (only warn if there are any)
    const bottlenecks = sortedMetrics
      .filter(([_, data]) => (data as any).duration > 500)
      .map(([name]) => name);

    if (bottlenecks.length > 0) {
      logger.warn(`Performance bottlenecks (>500ms): ${bottlenecks.join(', ')}`);
    }
  }
}

/**
 * Singleton instance of StartupMetrics for application-wide use.
 * Start tracking metrics as early as possible in the application lifecycle.
 *
 * @example
 * ```typescript
 * import { startupMetrics } from './startup-metrics';
 *
 * startupMetrics.start('app-init');
 * // ... initialization code
 * startupMetrics.end('app-init');
 * ```
 */
export const startupMetrics = new StartupMetrics();
