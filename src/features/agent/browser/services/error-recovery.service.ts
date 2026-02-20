/**
 * Error Recovery Service
 *
 * Provides systematic error recovery strategies for agent operations.
 * Implements exponential backoff, retry logic, and failure handling.
 */

import { createLogger } from '$lib/utils/client-logger';
import { isFatalError } from '$shared/constants/agent-streaming';

const logger = createLogger('ErrorRecovery');

export interface RecoveryStrategy {
  maxRetries: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  backoffMultiplier: number;
  shouldRetry: (error: Error, attempt: number) => boolean;
  onRetry?: (attempt: number, nextDelay: number) => void;
  onFailure?: (error: Error, attempts: number) => void;
}

export interface RecoveryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  totalTime: number;
}

// Common error types that can be retried
export enum RetryableError {
  NETWORK = 'NETWORK',
  TIMEOUT = 'TIMEOUT',
  RATE_LIMIT = 'RATE_LIMIT',
  TEMPORARY = 'TEMPORARY',
  CONFLICT = 'CONFLICT',
}

// Default strategies for common scenarios
export const DEFAULT_STRATEGIES = {
  network: {
    maxRetries: 3,
    initialBackoffMs: 1000,
    maxBackoffMs: 10000,
    backoffMultiplier: 2,
    shouldRetry: (error: Error) => {
      const message = error.message.toLowerCase();
      return (
        message.includes('network') ||
        message.includes('fetch') ||
        message.includes('connection') ||
        message.includes('timeout')
      );
    },
  } as RecoveryStrategy,

  streaming: {
    maxRetries: 5,
    initialBackoffMs: 500,
    maxBackoffMs: 5000,
    backoffMultiplier: 1.5,
    shouldRetry: (error: Error, attempt: number) => {
      if (attempt >= 5) return false;
      const message = error.message.toLowerCase();
      // Don't retry terminal errors like "all models exhausted"
      if (
        message.includes('no available models') ||
        message.includes('all models exhausted') ||
        message.includes('all models unavailable')
      ) {
        return false;
      }
      // Don't retry fatal errors (process died, code bugs, permission errors, etc.)
      if (isFatalError(error.message)) {
        return false;
      }
      return (
        message.includes('stream') || message.includes('chunk') || message.includes('incomplete')
      );
    },
  } as RecoveryStrategy,

  persistence: {
    maxRetries: 2,
    initialBackoffMs: 100,
    maxBackoffMs: 1000,
    backoffMultiplier: 2,
    shouldRetry: (error: Error) => {
      const message = error.message.toLowerCase();
      return message.includes('save') || message.includes('write') || message.includes('persist');
    },
  } as RecoveryStrategy,

  rateLimit: {
    maxRetries: 3,
    initialBackoffMs: 5000,
    maxBackoffMs: 30000,
    backoffMultiplier: 2,
    shouldRetry: (error: Error) => {
      const message = error.message.toLowerCase();
      return message.includes('rate') || message.includes('limit') || message.includes('429');
    },
  } as RecoveryStrategy,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventListenerFn = (...args: any[]) => void;

// Simple browser-compatible event emitter
class SimpleEventEmitter {
  private listeners = new Map<string, Set<EventListenerFn>>();

  on(event: string, listener: EventListenerFn): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  off(event: string, listener: EventListenerFn): void {
    this.listeners.get(event)?.delete(listener);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emit(event: string, ...args: any[]): void {
    this.listeners.get(event)?.forEach((listener) => {
      try {
        listener(...args);
      } catch (error) {
        logger.error(`Error in event listener for ${event}:`, error);
      }
    });
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}

export class ErrorRecoveryService extends SimpleEventEmitter {
  private activeRecoveries = new Map<string, AbortController>();
  private recoveryStats = new Map<string, { successes: number; failures: number }>();

  /**
   * Execute an operation with recovery strategy
   */
  async executeWithRecovery<T>(
    operation: () => Promise<T>,
    strategy: RecoveryStrategy = DEFAULT_STRATEGIES.network,
    operationId?: string,
  ): Promise<RecoveryResult<T>> {
    const startTime = Date.now();
    const abortController = new AbortController();

    if (operationId) {
      // Cancel any existing recovery for this operation
      this.cancelRecovery(operationId);
      this.activeRecoveries.set(operationId, abortController);
    }

    let lastError: Error | undefined;
    let currentBackoff = strategy.initialBackoffMs;
    let actualAttempts = 0;

    for (let attempt = 1; attempt <= strategy.maxRetries; attempt++) {
      actualAttempts = attempt;

      // Check if recovery was cancelled
      if (abortController.signal.aborted) {
        logger.info(`Recovery cancelled for operation ${operationId}`);
        break;
      }

      try {
        logger.debug(`Attempting operation (attempt ${attempt}/${strategy.maxRetries})`, {
          operationId,
        });

        const result = await operation();

        // Success!
        this.updateStats(operationId, true);
        this.emit('recovery:success', { operationId, attempt, duration: Date.now() - startTime });

        if (operationId) {
          this.activeRecoveries.delete(operationId);
        }

        return {
          success: true,
          data: result,
          attempts: attempt,
          totalTime: Date.now() - startTime,
        };
      } catch (error) {
        lastError = error as Error;

        logger.warn(`Operation failed (attempt ${attempt}/${strategy.maxRetries})`, {
          operationId,
          error: lastError.message,
        });

        // Never retry user-initiated interruptions or cancellations
        const errorMsg = lastError.message.toLowerCase();
        if (
          errorMsg.includes('interrupted') ||
          errorMsg.includes('cancelled') ||
          errorMsg.includes('canceled')
        ) {
          logger.debug('User-initiated interruption/cancellation, not retrying', {
            operationId,
            error: lastError.message,
          });
          break;
        }

        // Never retry "all models exhausted" errors - this is a terminal condition
        if (
          errorMsg.includes('no available models') ||
          errorMsg.includes('all models exhausted') ||
          errorMsg.includes('all models unavailable')
        ) {
          logger.debug('All models exhausted, not retrying', {
            operationId,
            error: lastError.message,
          });
          break;
        }

        // Never retry fatal errors (process died, code bugs, plan/permission errors)
        if (isFatalError(lastError.message)) {
          logger.debug('Fatal error detected, not retrying', {
            operationId,
            error: lastError.message,
          });
          break;
        }

        // Check if we should retry
        if (!strategy.shouldRetry(lastError, attempt)) {
          logger.debug('Error not retryable, stopping recovery', {
            operationId,
            error: lastError.message,
          });
          break;
        }

        // Check if we have more attempts
        if (attempt < strategy.maxRetries) {
          // Calculate next delay with jitter
          const jitter = Math.random() * 0.2 * currentBackoff; // 20% jitter
          const delay = Math.min(currentBackoff + jitter, strategy.maxBackoffMs);

          // Notify about retry
          strategy.onRetry?.(attempt, delay);
          this.emit('recovery:retry', { operationId, attempt, delay, error: lastError.message });

          // Wait before next attempt
          await this.delay(delay, abortController.signal);

          // Update backoff for next iteration
          currentBackoff = Math.min(
            currentBackoff * strategy.backoffMultiplier,
            strategy.maxBackoffMs,
          );
        }
      }
    }

    // All attempts failed
    this.updateStats(operationId, false);
    strategy.onFailure?.(lastError!, actualAttempts);
    this.emit('recovery:failure', {
      operationId,
      attempts: actualAttempts,
      duration: Date.now() - startTime,
      error: lastError?.message,
    });

    if (operationId) {
      this.activeRecoveries.delete(operationId);
    }

    return {
      success: false,
      error: lastError,
      attempts: actualAttempts,
      totalTime: Date.now() - startTime,
    };
  }

  /**
   * Cancel an active recovery operation
   */
  cancelRecovery(operationId: string): void {
    const controller = this.activeRecoveries.get(operationId);
    if (controller) {
      controller.abort();
      this.activeRecoveries.delete(operationId);
      logger.info(`Cancelled recovery for operation ${operationId}`);
    }
  }

  /**
   * Cancel all active recoveries
   */
  cancelAllRecoveries(): void {
    for (const [id, controller] of this.activeRecoveries) {
      controller.abort();
      logger.info(`Cancelled recovery for operation ${id}`);
    }
    this.activeRecoveries.clear();
  }

  /**
   * Get recovery statistics
   */
  getStats(operationId?: string): any {
    if (operationId) {
      return this.recoveryStats.get(operationId) || { successes: 0, failures: 0 };
    }

    // Return all stats
    const allStats: any = {};
    for (const [id, stats] of this.recoveryStats) {
      allStats[id] = stats;
    }
    return allStats;
  }

  /**
   * Clear statistics
   */
  clearStats(operationId?: string): void {
    if (operationId) {
      this.recoveryStats.delete(operationId);
    } else {
      this.recoveryStats.clear();
    }
  }

  /**
   * Check if error is retryable
   */
  isRetryable(error: Error, type?: RetryableError): boolean {
    const message = error.message.toLowerCase();

    if (type) {
      switch (type) {
        case RetryableError.NETWORK:
          return message.includes('network') || message.includes('fetch');
        case RetryableError.TIMEOUT:
          return message.includes('timeout') || message.includes('timed out');
        case RetryableError.RATE_LIMIT:
          return message.includes('rate') || message.includes('limit') || message.includes('429');
        case RetryableError.TEMPORARY:
          return message.includes('temporary') || message.includes('transient');
        case RetryableError.CONFLICT:
          return message.includes('conflict') || message.includes('concurrent');
        default:
          return false;
      }
    }

    // Check all types
    return (
      this.isRetryable(error, RetryableError.NETWORK) ||
      this.isRetryable(error, RetryableError.TIMEOUT) ||
      this.isRetryable(error, RetryableError.RATE_LIMIT) ||
      this.isRetryable(error, RetryableError.TEMPORARY) ||
      this.isRetryable(error, RetryableError.CONFLICT)
    );
  }

  /**
   * Delay with abort support
   */
  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms);

      if (signal) {
        const abortHandler = () => {
          clearTimeout(timeout);
          reject(new Error('Delay aborted'));
        };

        signal.addEventListener('abort', abortHandler);

        // Clean up the event listener when the promise resolves
        const originalResolve = resolve;
        resolve = () => {
          signal.removeEventListener('abort', abortHandler);
          originalResolve();
        };
      }
    });
  }

  /**
   * Update recovery statistics
   */
  private updateStats(operationId: string | undefined, success: boolean): void {
    if (!operationId) return;

    const stats = this.recoveryStats.get(operationId) || { successes: 0, failures: 0 };
    if (success) {
      stats.successes++;
    } else {
      stats.failures++;
    }
    this.recoveryStats.set(operationId, stats);
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.cancelAllRecoveries();
    this.recoveryStats.clear();
    this.removeAllListeners();
  }
}

// Export singleton instance
export const errorRecovery = new ErrorRecoveryService();
