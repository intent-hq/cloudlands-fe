/**
 * Health Monitor
 *
 * Monitors health of MCP servers and triggers restarts when needed.
 */

import { EventEmitter } from '$shared/utils/event-emitter';
import { Logger } from '../../../../shared/logger';

const logger = new Logger('HealthMonitor');

interface HealthCheck {
  serverId: string;
  check: () => Promise<boolean>;
  lastCheck: number;
  lastSuccess: number;
  failureCount: number;
}

export interface HealthMonitorOptions {
  interval?: number;
  maxFailures?: number;
  timeout?: number;
}

export class HealthMonitor extends EventEmitter {
  private checks: Map<string, HealthCheck> = new Map();
  private timer: NodeJS.Timeout | null = null;
  private options: Required<HealthMonitorOptions>;
  private isRunning: boolean = false;

  constructor(options: HealthMonitorOptions = {}) {
    super();

    this.options = {
      interval: options.interval ?? 30000, // 30 seconds
      maxFailures: options.maxFailures ?? 3,
      timeout: options.timeout ?? 5000, // 5 seconds
    };
  }

  /**
   * Register a server for health monitoring
   */
  registerServer(serverId: string, check: () => Promise<boolean>): void {
    if (this.checks.has(serverId)) {
      logger.warn(`Server ${serverId} is already registered for health monitoring`);
      return;
    }

    const healthCheck: HealthCheck = {
      serverId,
      check,
      lastCheck: 0,
      lastSuccess: Date.now(),
      failureCount: 0,
    };

    this.checks.set(serverId, healthCheck);
    logger.info(`Registered server ${serverId} for health monitoring`);

    // Start monitoring if not already running
    if (!this.isRunning) {
      this.start();
    }
  }

  /**
   * Unregister a server from health monitoring
   */
  unregisterServer(serverId: string): void {
    if (!this.checks.has(serverId)) {
      return;
    }

    this.checks.delete(serverId);
    logger.info(`Unregistered server ${serverId} from health monitoring`);

    // Stop monitoring if no servers left
    if (this.checks.size === 0 && this.isRunning) {
      this.stop();
    }
  }

  /**
   * Start health monitoring
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    logger.info('Starting health monitoring');

    // Run initial check
    this.runHealthChecks();

    // Schedule periodic checks
    this.timer = setInterval(() => {
      this.runHealthChecks();
    }, this.options.interval);
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    logger.info('Stopping health monitoring');

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run health checks for all registered servers
   */
  private async runHealthChecks(): Promise<void> {
    const checks = Array.from(this.checks.values());

    // Run checks in parallel with timeout
    const results = await Promise.allSettled(checks.map((check) => this.runSingleCheck(check)));

    // Process results
    results.forEach((result, index) => {
      const check = checks[index];

      if (result.status === 'fulfilled' && result.value) {
        // Health check passed
        this.handleCheckSuccess(check);
      } else {
        // Health check failed
        const error =
          result.status === 'rejected' ? result.reason : new Error('Health check returned false');
        this.handleCheckFailure(check, error);
      }
    });
  }

  /**
   * Run a single health check with timeout
   */
  private async runSingleCheck(check: HealthCheck): Promise<boolean> {
    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Health check timed out for server ${check.serverId}`));
      }, this.options.timeout);

      try {
        const result = await check.check();
        clearTimeout(timeout);
        resolve(result);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /**
   * Handle successful health check
   */
  private handleCheckSuccess(check: HealthCheck): void {
    check.lastCheck = Date.now();
    check.lastSuccess = Date.now();

    // Reset failure count if previously failing
    if (check.failureCount > 0) {
      logger.info(`Server ${check.serverId} recovered (was failing ${check.failureCount} times)`);
      check.failureCount = 0;
      this.emit('health:recovered', check.serverId);
    }
  }

  /**
   * Handle failed health check
   */
  private handleCheckFailure(check: HealthCheck, error: Error): void {
    check.lastCheck = Date.now();
    check.failureCount++;

    logger.warn(
      `Health check failed for server ${check.serverId} (failure ${check.failureCount}/${this.options.maxFailures}): ${error.message}`,
    );

    // Emit warning on first failure
    if (check.failureCount === 1) {
      this.emit('health:warning', check.serverId, error);
    }

    // Trigger restart if max failures reached
    if (check.failureCount >= this.options.maxFailures) {
      logger.error(`Server ${check.serverId} exceeded max health check failures`);
      this.emit('health:failed', check.serverId, error);

      // Reset failure count to avoid repeated restarts
      check.failureCount = 0;
    }
  }

  /**
   * Get health status for all servers
   */
  getHealthStatus(): Map<string, any> {
    const status = new Map();

    for (const [serverId, check] of this.checks) {
      const timeSinceLastSuccess = Date.now() - check.lastSuccess;
      const isHealthy = check.failureCount === 0;

      status.set(serverId, {
        serverId,
        isHealthy,
        failureCount: check.failureCount,
        lastCheck: check.lastCheck,
        lastSuccess: check.lastSuccess,
        timeSinceLastSuccess,
      });
    }

    return status;
  }

  /**
   * Force a health check for a specific server
   */
  async checkServer(serverId: string): Promise<boolean> {
    const check = this.checks.get(serverId);
    if (!check) {
      throw new Error(`Server ${serverId} is not registered for health monitoring`);
    }

    try {
      const result = await this.runSingleCheck(check);
      if (result) {
        this.handleCheckSuccess(check);
      } else {
        this.handleCheckFailure(check, new Error('Health check returned false'));
      }
      return result;
    } catch (error) {
      this.handleCheckFailure(check, error as Error);
      return false;
    }
  }

  /**
   * Reset failure count for a server
   */
  resetFailureCount(serverId: string): void {
    const check = this.checks.get(serverId);
    if (check) {
      check.failureCount = 0;
      logger.info(`Reset failure count for server ${serverId}`);
    }
  }
}
