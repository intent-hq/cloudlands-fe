/**
 * IPC Validation Utilities
 *
 * Provides validation and sanitization for IPC handler inputs
 * to prevent security issues and ensure data integrity.
 */

import { m } from '$shared/paraglide/messages.js';
import { sanitizePath } from '../../main/utils/workspace-validation';

/**
 * Validate IPC parameters
 */
export interface IPCValidationResult {
  valid: boolean;
  error?: string;
  sanitized?: any;
}

/**
 * Validate file path parameter
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function validateIPCPath(path: any, basePath: string): IPCValidationResult {
  if (!path) {
    return {
      valid: false,
      error: m.ipcValidation_pathRequired_error(),
    };
  }

  if (typeof path !== 'string') {
    return {
      valid: false,
      error: m.ipcValidation_pathMustBeString_error(),
    };
  }

  const sanitized = sanitizePath(path);
  if (!sanitized) {
    return {
      valid: false,
      error: m.ipcValidation_pathInvalid_error(),
    };
  }

  return {
    valid: true,
    sanitized,
  };
}

/**
 * Validate string parameter
 */
export function validateIPCString(
  value: any,
  name: string,
  maxLength: number = 1000,
): IPCValidationResult {
  if (value === undefined || value === null) {
    return {
      valid: false,
      error: m.ipcValidation_paramRequired_error({ name }),
    };
  }

  if (typeof value !== 'string') {
    return {
      valid: false,
      error: m.ipcValidation_paramMustBeString_error({ name }),
    };
  }

  if (value.length > maxLength) {
    return {
      valid: false,
      error: m.ipcValidation_paramTooLong_error({ name, maxLength }),
    };
  }

  return {
    valid: true,
    sanitized: value,
  };
}
