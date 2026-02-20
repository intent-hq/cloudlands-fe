/**
 * Event System Error Handler
 *
 * Centralized error handling for the event system with recovery strategies
 */

import { Logger } from '../../shared/logger';

const logger = new Logger('EventErrorHandler');

export enum EventErrorCode {
  EMISSION_FAILED = 'EMISSION_FAILED',
  SUBSCRIPTION_FAILED = 'SUBSCRIPTION_FAILED',
  DEDUPLICATION_FAILED = 'DEDUPLICATION_FAILED',
  PERSISTENCE_FAILED = 'PERSISTENCE_FAILED',
  INITIALIZATION_FAILED = 'INITIALIZATION_FAILED',
  INVALID_EVENT = 'INVALID_EVENT',
  CALLBACK_ERROR = 'CALLBACK_ERROR',
}

export interface EventError {
  code: EventErrorCode;
  message: string;
  context?: Record<string, any>;
  originalError?: Error;
  timestamp: string;
  workspaceId?: string;
}

export class EventErrorHandler {
  private static instance: EventErrorHandler;
  private errors: EventError[] = [];
  private readonly maxErrors = 100;
  private errorCallbacks: Set<(error: EventError) => void> = new Set();

  private constructor() {}

  static getInstance(): EventErrorHandler {
    if (!EventErrorHandler.instance) {
      EventErrorHandler.instance = new EventErrorHandler();
    }
    return EventErrorHandler.instance;
  }

  /**
   * Handle an error in the event system
   */
  handleError(
    code: EventErrorCode,
    message: string,
    context?: Record<string, any>,
    originalError?: Error,
  ): void {
    const error: EventError = {
      code,
      message,
      context,
      originalError,
      timestamp: new Date().toISOString(),
      workspaceId: context?.workspaceId,
    };

    // Log the error
    this.logError(error);

    // Store the error
    this.storeError(error);

    // Notify callbacks
    this.notifyCallbacks(error);

    // Attempt recovery
    this.attemptRecovery(error);
  }

  /**
   * Log the error with appropriate severity
   */
  private logError(error: EventError): void {
    const logContext = {
      code: error.code,
      workspaceId: error.workspaceId,
      ...error.context,
    };

    switch (error.code) {
      case EventErrorCode.INITIALIZATION_FAILED:
      case EventErrorCode.PERSISTENCE_FAILED:
        logger.error(error.message, logContext);
        break;
      case EventErrorCode.EMISSION_FAILED:
      case EventErrorCode.SUBSCRIPTION_FAILED:
        logger.warn(error.message, logContext);
        break;
      default:
        logger.info(error.message, logContext);
    }

    // Log stack trace if available
    if (error.originalError?.stack) {
      logger.debug('Stack trace', { stack: error.originalError.stack });
    }
  }

  /**
   * Store error for analysis
   */
  private storeError(error: EventError): void {
    this.errors.push(error);

    // Limit stored errors
    if (this.errors.length > this.maxErrors) {
      this.errors.shift();
    }
  }

  /**
   * Notify registered callbacks about the error
   */
  private notifyCallbacks(error: EventError): void {
    for (const callback of this.errorCallbacks) {
      try {
        callback(error);
      } catch (err) {
        logger.error('Error callback failed', { error: err });
      }
    }
  }

  /**
   * Attempt to recover from the error
   */
  private attemptRecovery(error: EventError): void {
    switch (error.code) {
      case EventErrorCode.PERSISTENCE_FAILED:
        // Retry persistence after delay
        if (error.context?.retryable) {
          setTimeout(() => {
            logger.info('Retrying failed persistence', {
              workspaceId: error.workspaceId,
            });
            // Trigger retry logic (would need to be implemented in the calling code)
          }, 5000);
        }
        break;

      case EventErrorCode.DEDUPLICATION_FAILED:
        // Clear deduplication cache if it's corrupted
        logger.info('Clearing deduplication cache due to error', {
          workspaceId: error.workspaceId,
        });
        // Would trigger cache clear (implementation needed)
        break;

      case EventErrorCode.CALLBACK_ERROR:
        // Remove failing callback if it consistently fails
        if (error.context?.failureCount && error.context.failureCount > 3) {
          logger.warn('Removing failing callback', {
            subscriptionId: error.context.subscriptionId,
          });
          // Would remove the subscription (implementation needed)
        }
        break;
    }
  }

  /**
   * Register a callback for error notifications
   */
  onError(callback: (error: EventError) => void): () => void {
    this.errorCallbacks.add(callback);
    return () => this.errorCallbacks.delete(callback);
  }

  /**
   * Get recent errors
   */
  getRecentErrors(count = 10): EventError[] {
    return this.errors.slice(-count);
  }

  /**
   * Get errors by code
   */
  getErrorsByCode(code: EventErrorCode): EventError[] {
    return this.errors.filter((e) => e.code === code);
  }

  /**
   * Get errors for a workspace
   */
  getErrorsByWorkspace(workspaceId: string): EventError[] {
    return this.errors.filter((e) => e.workspaceId === workspaceId);
  }

  /**
   * Clear all errors
   */
  clearErrors(): void {
    this.errors = [];
  }

  /**
   * Get error statistics
   */
  getStatistics(): Record<EventErrorCode, number> {
    const stats: Record<string, number> = {};

    for (const error of this.errors) {
      stats[error.code] = (stats[error.code] || 0) + 1;
    }

    return stats as Record<EventErrorCode, number>;
  }

  /**
   * Export errors for debugging
   */
  exportErrors(): string {
    return JSON.stringify(this.errors, null, 2);
  }

  /**
   * Check if system is healthy
   */
  isHealthy(): boolean {
    const recentErrors = this.getRecentErrors(10);
    const criticalErrors = recentErrors.filter(
      (e) =>
        e.code === EventErrorCode.INITIALIZATION_FAILED ||
        e.code === EventErrorCode.PERSISTENCE_FAILED,
    );

    return criticalErrors.length === 0;
  }
}

// Export singleton instance
export const eventErrorHandler = EventErrorHandler.getInstance();
