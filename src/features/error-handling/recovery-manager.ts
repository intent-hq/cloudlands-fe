/**
 * Recovery Manager
 *
 * Handles error recovery and system resilience for the file tracking
 * and activity logging system.
 */

import { EventEmitter } from '$shared/utils/event-emitter';
import { Logger } from '../../shared/logger';
import { TRACKING_CONFIG } from '../file-tracking/tracking.config';

const logger = new Logger('RecoveryManager');

export interface RecoveryContext {
  component: string;
  error: Error;
  attemptNumber: number;
  maxAttempts: number;
  timestamp: number;
}

export interface RecoveryStrategy {
  name: string;
  canRecover: (context: RecoveryContext) => boolean;
  recover: (context: RecoveryContext) => Promise<boolean>;
  priority: number;
}

export interface RecoveryResult {
  success: boolean;
  strategy?: string;
  error?: Error;
  duration: number;
}

export class RecoveryManager extends EventEmitter {
  private strategies: Map<string, RecoveryStrategy> = new Map();
  private recoveryAttempts: Map<string, RecoveryContext[]> = new Map();
  private isRecovering: Map<string, boolean> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(private readonly config = TRACKING_CONFIG.errorHandling) {
    super();
    this.registerDefaultStrategies();
  }

  /**
   * Register default recovery strategies
   */
  private registerDefaultStrategies(): void {
    // Retry strategy
    this.registerStrategy({
      name: 'retry',
      priority: 1,
      canRecover: (context) => context.attemptNumber < this.config.maxRetries,
      recover: async (context) => {
        const delay = this.calculateRetryDelay(context.attemptNumber);
        logger.info(`Retrying ${context.component} after ${delay}ms`, {
          attempt: context.attemptNumber,
          maxAttempts: context.maxAttempts,
        });

        await this.delay(delay);
        return true; // Indicate retry should be attempted
      },
    });

    // Reset strategy
    this.registerStrategy({
      name: 'reset',
      priority: 2,
      canRecover: (context) => {
        const errorMessage = context.error.message.toLowerCase();
        return errorMessage.includes('state') || errorMessage.includes('corrupt');
      },
      recover: async (context) => {
        logger.info(`Resetting ${context.component} state`);
        this.emit('reset', context.component);
        return true;
      },
    });

    // Restart strategy
    this.registerStrategy({
      name: 'restart',
      priority: 3,
      canRecover: (context) => {
        const errorMessage = context.error.message.toLowerCase();
        return errorMessage.includes('crash') || errorMessage.includes('died');
      },
      recover: async (context) => {
        logger.info(`Restarting ${context.component}`);
        this.emit('restart', context.component);
        return true;
      },
    });

    // Cleanup strategy
    this.registerStrategy({
      name: 'cleanup',
      priority: 4,
      canRecover: (context) => {
        const errorMessage = context.error.message.toLowerCase();
        return errorMessage.includes('memory') || errorMessage.includes('emfile');
      },
      recover: async (context) => {
        logger.info(`Cleaning up resources for ${context.component}`);
        this.emit('cleanup', context.component);

        // NOTE: Do NOT call global.gc() here. Multiple independent GC call sites
        // can trigger V8 garbage collection at unsafe moments while async resources
        // (child processes, streams) are being torn down, causing native SIGSEGV crashes
        // in AsyncWrap::~AsyncWrap(). GC is centralized in shared/main/memory-monitor.ts.

        return true;
      },
    });
  }

  /**
   * Register a recovery strategy
   */
  registerStrategy(strategy: RecoveryStrategy): void {
    this.strategies.set(strategy.name, strategy);
    logger.debug(`Registered recovery strategy: ${strategy.name}`);
  }

  /**
   * Start recovery monitoring
   */
  start(): void {
    if (this.checkInterval) {
      return;
    }

    if (this.config.enableAutoRecovery) {
      this.checkInterval = setInterval(() => {
        this.checkRecoveryStatus();
      }, this.config.recoveryCheckInterval);

      logger.info('Recovery manager started', {
        checkInterval: this.config.recoveryCheckInterval,
        autoRecovery: this.config.enableAutoRecovery,
      });
    }
  }

  /**
   * Stop recovery monitoring
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    logger.info('Recovery manager stopped');
  }

  /**
   * Handle an error and attempt recovery
   */
  async handleError(component: string, error: Error): Promise<RecoveryResult> {
    const startTime = Date.now();

    // Check if already recovering
    if (this.isRecovering.get(component)) {
      logger.warn(`Already recovering ${component}, skipping`);
      return {
        success: false,
        error: new Error('Recovery already in progress'),
        duration: 0,
      };
    }

    this.isRecovering.set(component, true);

    try {
      // Get or create recovery context
      const attempts = this.recoveryAttempts.get(component) || [];
      const context: RecoveryContext = {
        component,
        error,
        attemptNumber: attempts.length + 1,
        maxAttempts: this.config.maxRetries,
        timestamp: Date.now(),
      };

      attempts.push(context);
      this.recoveryAttempts.set(component, attempts);

      // Log the error
      if (this.config.logErrors) {
        logger.error(`Error in ${component}`, {
          error: error.message,
          stack: this.config.includeStackTrace ? error.stack : undefined,
          attempt: context.attemptNumber,
        });
      }

      // Emit error event
      this.emit('error', { component, error, context });

      // Try recovery strategies
      const strategies = Array.from(this.strategies.values()).sort(
        (a, b) => a.priority - b.priority,
      );

      for (const strategy of strategies) {
        if (strategy.canRecover(context)) {
          logger.info(`Attempting recovery with strategy: ${strategy.name}`, {
            component,
            attempt: context.attemptNumber,
          });

          try {
            const success = await strategy.recover(context);
            if (success) {
              const duration = Date.now() - startTime;
              logger.info(`Recovery successful with strategy: ${strategy.name}`, {
                component,
                duration,
              });

              this.emit('recovered', { component, strategy: strategy.name, duration });

              // Clear attempts on successful recovery
              this.recoveryAttempts.delete(component);

              return {
                success: true,
                strategy: strategy.name,
                duration,
              };
            }
          } catch (strategyError: any) {
            logger.error(`Recovery strategy ${strategy.name} failed`, {
              component,
              error: strategyError.message,
            });
          }
        }
      }

      // No recovery strategy worked
      const duration = Date.now() - startTime;
      logger.error(`All recovery strategies failed for ${component}`, {
        attempts: context.attemptNumber,
        duration,
      });

      this.emit('recovery-failed', { component, error, attempts: context.attemptNumber });

      return {
        success: false,
        error,
        duration,
      };
    } finally {
      this.isRecovering.set(component, false);
    }
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(attemptNumber: number): number {
    const baseDelay = this.config.retryDelay;
    const backoff = this.config.retryBackoff;
    return Math.min(baseDelay * Math.pow(backoff, attemptNumber - 1), 30000); // Max 30 seconds
  }

  /**
   * Check recovery status of all components
   */
  private checkRecoveryStatus(): void {
    const now = Date.now();

    for (const [component, attempts] of this.recoveryAttempts.entries()) {
      if (attempts.length > 0) {
        const lastAttempt = attempts[attempts.length - 1];
        const timeSinceLastAttempt = now - lastAttempt.timestamp;

        // Clear old attempts after 5 minutes
        if (timeSinceLastAttempt > 5 * 60 * 1000) {
          this.recoveryAttempts.delete(component);
          logger.debug(`Cleared recovery attempts for ${component}`);
        }
      }
    }
  }

  /**
   * Get recovery status for a component
   */
  getStatus(component: string): {
    isRecovering: boolean;
    attempts: number;
    lastError?: Error;
  } {
    const attempts = this.recoveryAttempts.get(component) || [];
    const lastAttempt = attempts[attempts.length - 1];

    return {
      isRecovering: this.isRecovering.get(component) || false,
      attempts: attempts.length,
      lastError: lastAttempt?.error,
    };
  }

  /**
   * Clear recovery history for a component
   */
  clearHistory(component: string): void {
    this.recoveryAttempts.delete(component);
    this.isRecovering.delete(component);
    logger.debug(`Cleared recovery history for ${component}`);
  }

  /**
   * Helper to delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Dispose of the recovery manager and clean up resources
   */
  dispose(): void {
    this.stop();
    this.strategies.clear();
    this.recoveryAttempts.clear();
    this.isRecovering.clear();
    this.removeAllListeners();
    logger.info('Recovery manager disposed');
  }
}

// Singleton instance
let recoveryManager: RecoveryManager | null = null;

/**
 * Get or create the recovery manager instance
 */
export function getRecoveryManager(): RecoveryManager {
  if (!recoveryManager) {
    recoveryManager = new RecoveryManager();
  }
  return recoveryManager;
}

/**
 * Dispose of the recovery manager singleton
 */
export function disposeRecoveryManager(): void {
  if (recoveryManager) {
    recoveryManager.dispose();
    recoveryManager = null;
  }
}
