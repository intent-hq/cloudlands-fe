/**
 * Error Boundary Service
 *
 * Provides consistent error handling with retry logic, fallbacks, and user notifications.
 * Wraps all agent operations to ensure graceful error recovery.
 */

import { createLogger } from '$lib/utils/client-logger';
import { toast } from 'svelte-sonner';
import {
  AgentError,
  AgentErrorCode,
} from '../errors/agent-errors';
import { RETRY } from '$shared/constants';
import { cleanErrorMessage } from '$shared/errors/messages';
import { isFatalError } from '$shared/constants/agent-streaming';

const logger = createLogger('ErrorBoundary');

export interface ErrorBoundaryOptions<T> {
  retries?: number;
  retryDelay?: number;
  exponentialBackoff?: boolean;
  fallback?: T;
  notify?: boolean;
  notifyOnRetry?: boolean;
  context?: Record<string, any>;
  onError?: (error: Error, attempt: number) => void;
  onRetry?: (attempt: number) => void;
  shouldRetry?: (error: Error) => boolean;
}

/**
 * Error boundary service for consistent error handling
 */
export class ErrorBoundaryService {
  private static instance: ErrorBoundaryService;

  private constructor() {}

  static getInstance(): ErrorBoundaryService {
    if (!ErrorBoundaryService.instance) {
      ErrorBoundaryService.instance = new ErrorBoundaryService();
    }
    return ErrorBoundaryService.instance;
  }

  /**
   * Wrap an operation with error handling and retry logic
   */
  async wrap<T>(
    operation: () => Promise<T>,
    operationName: string,
    options: ErrorBoundaryOptions<T> = {},
  ): Promise<T> {
    const {
      retries = RETRY.DEFAULT_ATTEMPTS,
      retryDelay = RETRY.BASE_DELAY,
      exponentialBackoff = true,
      fallback,
      notify = false,
      notifyOnRetry = false,
      context = {},
      onError,
      onRetry,
      shouldRetry = this.defaultShouldRetry,
    } = options;

    let lastError: Error | null = null;
    let attempt = 0;

    for (attempt = 1; attempt <= retries + 1; attempt++) {
      try {
        logger.debug(`[${operationName}] Attempt ${attempt}/${retries + 1}`);

        const result = await operation();

        if (attempt > 1) {
          logger.info(`[${operationName}] Succeeded after ${attempt} attempts`);
        }

        return result;
      } catch (error) {
        lastError = error as Error;

        logger.error(`[${operationName}] Attempt ${attempt} failed`, {
          error: lastError.message,
          attempt,
          maxAttempts: retries + 1,
          context,
        });

        // Call error handler
        onError?.(lastError, attempt);

        // Check if we should retry
        if (attempt <= retries && shouldRetry(lastError)) {
          const delay = exponentialBackoff ? retryDelay * Math.pow(2, attempt - 1) : retryDelay;

          if (notifyOnRetry) {
            toast.warning(`Something went wrong, retrying in ${delay / 1000}s...`);
          }

          onRetry?.(attempt);

          logger.info(`[${operationName}] Retrying in ${delay}ms`);
          await this.sleep(delay);
        } else {
          break;
        }
      }
    }

    // All attempts failed
    const detailedMessage = `${operationName} failed after ${attempt} attempt${attempt === 1 ? '' : 's'}: ${lastError?.message}`;
    const userMessage = cleanErrorMessage(lastError?.message || 'Something went wrong. Please try again.');

    // Don't show toast for "all models exhausted" errors - the error is already shown in chat
    const lowerMessage = lastError?.message?.toLowerCase() || '';
    const isModelsExhaustedError =
      lowerMessage.includes('no available models') ||
      lowerMessage.includes('all models exhausted') ||
      lowerMessage.includes('all models unavailable');

    if (notify && !isModelsExhaustedError) {
      toast.error(userMessage);
    }

    // Return fallback if provided
    if (fallback !== undefined) {
      logger.warn(`[${operationName}] Using fallback value`, { fallback });
      return fallback;
    }

    // Throw enhanced error - use clean message for display, keep details in context
    throw new AgentError(userMessage, AgentErrorCode.OPERATION_FAILED, {
      originalError: lastError?.message,
      detailedMessage,
      attempts: attempt,
      context,
    });
  }

  /**
   * Wrap an operation that doesn't need a return value
   */
  async wrapVoid(
    operation: () => Promise<void>,
    operationName: string,
    options: Omit<ErrorBoundaryOptions<void>, 'fallback'> = {},
  ): Promise<void> {
    await this.wrap(operation, operationName, options);
  }

  /**
   * Wrap a synchronous operation
   */
  wrapSync<T>(
    operation: () => T,
    operationName: string,
    options: Omit<ErrorBoundaryOptions<T>, 'retries' | 'retryDelay' | 'exponentialBackoff'> = {},
  ): T {
    try {
      return operation();
    } catch (error) {
      const err = error as Error;

      logger.error(`[${operationName}] Failed`, {
        error: err.message,
        context: options.context,
      });

      if (options.notify) {
        toast.error(cleanErrorMessage(err.message));
      }

      if (options.fallback !== undefined) {
        logger.warn(`[${operationName}] Using fallback value`, { fallback: options.fallback });
        return options.fallback;
      }

      throw new AgentError(
        cleanErrorMessage(err.message),
        AgentErrorCode.OPERATION_FAILED,
        options.context,
      );
    }
  }

  /**
   * Default retry predicate - retry on network and timeout errors
   */
  private defaultShouldRetry(error: Error): boolean {
    const msg = error.message.toLowerCase();

    // Never retry fatal errors (process died, code bugs, plan/permission errors)
    // This must be checked first — before any "retry on X" rules can match.
    if (isFatalError(error.message)) {
      return false;
    }

    // Always retry network errors
    if (msg.includes('network')) {
      return true;
    }

    // Retry timeout errors
    if (msg.includes('timeout')) {
      return true;
    }

    // Retry specific error codes
    if (error instanceof AgentError) {
      const retryableCodes: string[] = [
        AgentErrorCode.NETWORK_ERROR,
        AgentErrorCode.STREAM_TIMEOUT,
        AgentErrorCode.STREAM_CONNECTION_FAILED,
        AgentErrorCode.PROVIDER_CONNECTION_FAILED,
        AgentErrorCode.PROVIDER_UNAVAILABLE,
      ];
      return retryableCodes.includes(error.code);
    }

    // Don't retry validation errors
    if (msg.includes('invalid')) {
      return false;
    }

    // Don't retry user-initiated interruptions (stop button)
    if (msg.includes('interrupted')) {
      return false;
    }

    // Don't retry cancelled operations (covers both 'cancelled' and 'canceled')
    if (msg.includes('cancel')) {
      return false;
    }

    // Don't retry 404/not found errors - these are not transient
    if (msg.includes('not found') || msg.includes('not available') || msg.includes('404')) {
      return false;
    }

    // Don't retry "all models exhausted" errors - this is terminal
    if (
      msg.includes('no available models') ||
      msg.includes('all models exhausted') ||
      msg.includes('all models unavailable')
    ) {
      return false;
    }

    // Don't retry 413/payload too large errors - conversation is too long, retrying won't help
    if (
      msg.includes('413') ||
      msg.includes('too long for the agent') ||
      msg.includes('request entity too large') ||
      msg.includes('payload too large') ||
      msg.includes('content too large') ||
      msg.includes('body too large')
    ) {
      return false;
    }

    // Don't retry authentication/authorization errors - these are not transient
    if (
      msg.includes('unauthorized') ||
      msg.includes('forbidden') ||
      msg.includes('401') ||
      msg.includes('403')
    ) {
      return false;
    }

    // Default to retrying unknown errors
    return true;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create a timeout wrapper
   */
  async withTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    operationName: string,
  ): Promise<T> {
    return Promise.race([
      operation(),
      new Promise<T>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new AgentError(
                `${operationName} timed out after ${timeoutMs}ms`,
                AgentErrorCode.STREAM_TIMEOUT,
              ),
            ),
          timeoutMs,
        ),
      ),
    ]);
  }

  /**
   * Batch operations with error handling
   */
  async batchOperations<T, R>(
    items: T[],
    operation: (item: T) => Promise<R>,
    options: {
      concurrency?: number;
      continueOnError?: boolean;
      operationName?: string;
    } = {},
  ): Promise<{ results: R[]; errors: Array<{ item: T; error: Error }> }> {
    const { concurrency = 5, continueOnError = true, operationName = 'batch operation' } = options;

    const results: R[] = [];
    const errors: Array<{ item: T; error: Error }> = [];

    // Process in batches
    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);

      const batchResults = await Promise.allSettled(batch.map((item) => operation(item)));

      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          const error = result.reason as Error;
          errors.push({ item: batch[index], error });

          logger.error(`[${operationName}] Batch item failed`, {
            item: batch[index],
            error: error.message,
          });

          if (!continueOnError) {
            throw error;
          }
        }
      });
    }

    if (errors.length > 0) {
      logger.warn(`[${operationName}] Completed with ${errors.length} errors`);
    }

    return { results, errors };
  }
}

// Export singleton instance
export const errorBoundary = ErrorBoundaryService.getInstance();

// Export convenience wrapper function
export async function withErrorBoundary<T>(
  operation: () => Promise<T>,
  operationName: string,
  options?: ErrorBoundaryOptions<T>,
): Promise<T> {
  return errorBoundary.wrap(operation, operationName, options);
}
