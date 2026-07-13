/**
 * IPC Response Formatter
 *
 * Utilities for formatting consistent IPC responses with proper error handling.
 * Ensures all responses follow the standard IpcResponse<T> format.
 */

import type { IpcResponse } from '$shared/ipc/contracts';
import { Logger } from '$shared/logger';
import { ZodError } from 'zod';

const logger = new Logger('IpcResponseFormatter');

/**
 * Error code mapping for different error types
 */
const ERROR_CODE_MAP: Record<string, string> = {
  ZodError: 'VALIDATION_ERROR',
  ValidationError: 'VALIDATION_ERROR',
  NotFoundError: 'NOT_FOUND',
  ConflictError: 'CONFLICT',
  UnauthorizedError: 'UNAUTHORIZED',
  ForbiddenError: 'FORBIDDEN',
  TimeoutError: 'TIMEOUT',
  NetworkError: 'NETWORK_ERROR',
};

/**
 * Format a successful IPC response
 */
export function formatIpcSuccess<T>(data: T): IpcResponse<T> {
  return {
    success: true,
    data,
  };
}

/**
 * Format an error IPC response
 */
export function formatIpcError(error: unknown, channel?: string): IpcResponse<any> {
  const errorCode = getErrorCode(error);
  const errorMessage = getErrorMessage(error);
  const errorDetails = getErrorDetails(error);

  logger.warn(`IPC error on ${channel || 'unknown'}`, {
    code: errorCode,
    message: errorMessage,
    details: errorDetails,
  });

  return {
    success: false,
    error: {
      code: errorCode,
      message: errorMessage,
      details: errorDetails,
    },
  };
}

/**
 * Extract error code from error object
 */
function getErrorCode(error: unknown): string {
  if (error instanceof ZodError) {
    return 'VALIDATION_ERROR';
  }

  if (error instanceof Error) {
    const name = error.constructor.name;
    return ERROR_CODE_MAP[name] || 'INTERNAL_ERROR';
  }

  return 'INTERNAL_ERROR';
}

/**
 * Extract error message from error object
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    const issues = error.errors.slice(0, 3);
    return `Validation failed: ${issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'An unknown error occurred';
}

/**
 * Extract error details from error object
 */
function getErrorDetails(error: unknown): any {
  if (error instanceof ZodError) {
    return {
      issues: error.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
        code: e.code,
      })),
    };
  }

  if (error instanceof Error && error.stack) {
    return {
      stack: error.stack,
    };
  }

  return undefined;
}
