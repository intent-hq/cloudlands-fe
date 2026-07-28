/**
 * Comprehensive error handling utilities
 */

import { createLogger } from '$lib/utils/client-logger';
import { debugConfig } from '$lib/config/debug';
import { m } from '$shared/paraglide/messages.js';

const logger = createLogger('ErrorHandling');

/**
 * Context information for error tracking and debugging.
 */
export interface ErrorContext {
  /** Component where the error occurred */
  component?: string;
  /** Action being performed when error occurred */
  action?: string;
  /** Additional data for debugging */
  data?: any;
}

/**
 * Application-specific error class with enhanced error information.
 * Provides structured error handling with user-friendly messages and recovery hints.
 *
 * @example
 * ```typescript
 * throw new AppError(
 *   'Failed to connect to GitHub',
 *   ErrorCodes.GITHUB_AUTH_REQUIRED,
 *   'Please authenticate with GitHub to continue',
 *   true,
 *   { component: 'GitHubService', action: 'fetchRepo' }
 * );
 * ```
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly context?: ErrorContext;
  public readonly recoverable: boolean;
  public readonly userMessage: string;

  /**
   * Create a new application error.
   *
   * @param message - Technical error message for logging
   * @param code - Error code from ErrorCodes enum
   * @param userMessage - User-friendly error message
   * @param recoverable - Whether the error can be recovered from
   * @param context - Additional context for debugging
   */
  constructor(
    message: string,
    code: string,
    userMessage?: string,
    recoverable = true,
    context?: ErrorContext,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage || message;
    this.recoverable = recoverable;
    this.context = context;
  }
}

/**
 * Error codes for consistent error handling
 */
export const ErrorCodes = {
  // Network errors
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  RATE_LIMIT: 'RATE_LIMIT',

  // Git errors
  GIT_PERMISSION_DENIED: 'GIT_PERMISSION_DENIED',
  GIT_BRANCH_EXISTS: 'GIT_BRANCH_EXISTS',
  GIT_REPO_NOT_FOUND: 'GIT_REPO_NOT_FOUND',
  GIT_INVALID_REPO: 'GIT_INVALID_REPO',

  // GitHub errors
  GITHUB_AUTH_REQUIRED: 'GITHUB_AUTH_REQUIRED',
  GITHUB_REPO_NOT_FOUND: 'GITHUB_REPO_NOT_FOUND',
  GITHUB_INVALID_URL: 'GITHUB_INVALID_URL',

  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',

  // System errors
  ELECTRON_NOT_AVAILABLE: 'ELECTRON_NOT_AVAILABLE',
  STORAGE_ERROR: 'STORAGE_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

/**
 * Wrap an async function with automatic error handling and logging.
 * Catches errors, logs them with context, and re-throws as AppError.
 *
 * @param fn - Async function to wrap
 * @param context - Error context for debugging
 * @returns Wrapped function with error handling
 * @example
 * ```typescript
 * const safeFunction = withErrorHandling(
 *   async (id: string) => {
 *     return await fetchData(id);
 *   },
 *   { component: 'DataService', action: 'fetch' }
 * );
 * ```
 */
export function withErrorHandling<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  context?: ErrorContext,
): T {
  return (async (...args: Parameters<T>) => {
    try {
      // Simulate errors if debug flag is set
      if (debugConfig.get('simulateErrors') && Math.random() < 0.3) {
        throw new Error('Simulated error for testing');
      }

      return await fn(...args);
    } catch (error) {
      handleError(error, context);
      throw error;
    }
  }) as T;
}

/**
 * Handle an error with logging and optional recovery
 */
export function handleError(error: unknown, context?: ErrorContext): AppError {
  // Convert to AppError if needed
  const appError = toAppError(error, context);

  // Log the error
  if (debugConfig.get('logStateChanges')) {
    logger.error('Error occurred', {
      code: appError.code,
      message: appError.message,
      userMessage: appError.userMessage,
      recoverable: appError.recoverable,
      context: appError.context,
      stack: appError.stack,
    });
  }

  return appError;
}

/**
 * Convert any error to AppError
 */
export function toAppError(error: unknown, context?: ErrorContext): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    // Parse common error patterns
    const message = error.message.toLowerCase();

    if (message.includes('network') || message.includes('fetch')) {
      return new AppError(
        error.message,
        ErrorCodes.NETWORK_ERROR,
        m.error_handling_network_error(),
        true,
        context,
      );
    }

    if (message.includes('permission') || message.includes('denied')) {
      return new AppError(
        error.message,
        ErrorCodes.GIT_PERMISSION_DENIED,
        m.error_handling_permission_error(),
        false,
        context,
      );
    }

    if (message.includes('rate limit')) {
      return new AppError(
        error.message,
        ErrorCodes.RATE_LIMIT,
        m.error_handling_rateLimit_error(),
        true,
        context,
      );
    }

    return new AppError(
      error.message,
      ErrorCodes.UNKNOWN_ERROR,
      m.error_handling_unexpected_error(),
      true,
      context,
    );
  }

  return new AppError(
    String(error),
    ErrorCodes.UNKNOWN_ERROR,
    m.error_handling_unexpected_error(),
    true,
    context,
  );
}
