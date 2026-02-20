/**
 * IPC Utilities
 *
 * Common utilities for IPC communication between main and renderer processes
 */

import type { Result } from './result';
import type { CommandResponse } from './types';

/**
 * Convert a Result to a CommandResponse
 *
 * @param result - Result from service layer
 * @returns CommandResponse for IPC
 */
export function resultToCommandResponse<T>(result: Result<T, string>): CommandResponse<T> {
  if (result.ok) {
    return {
      success: true,
      data: result.data,
    };
  } else {
    return {
      success: false,
      error: result.error,
    };
  }
}

/**
 * Convert a CommandResponse to a Result
 *
 * @param response - CommandResponse from IPC
 * @returns Result for service layer
 */
export function commandResponseToResult<T>(response: CommandResponse<T>): Result<T, string> {
  if (response.success) {
    return {
      ok: true,
      data: response.data as T,
    };
  } else {
    return {
      ok: false,
      error: response.error || 'Unknown error',
    };
  }
}

/**
 * Wrap an async function for IPC handling
 *
 * @param fn - Async function to wrap
 * @returns Wrapped function that returns CommandResponse
 */
export function wrapForIPC<T extends any[], R>(
  fn: (...args: T) => Promise<Result<R, string>>,
): (...args: T) => Promise<CommandResponse<R>> {
  return async (...args: T) => {
    try {
      const result = await fn(...args);
      return resultToCommandResponse(result);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  };
}
