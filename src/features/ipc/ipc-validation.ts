/**
 * IPC Validation Utilities
 *
 * Provides validation and sanitization for IPC handler inputs
 * to prevent security issues and ensure data integrity.
 */

import { Logger } from '$shared/logger';
import { isValidWorkspaceIdFormat, sanitizePath } from '../../main/utils/workspace-validation';

const logger = new Logger('IPCValidation');

/**
 * Validate IPC parameters
 */
export interface IPCValidationResult {
  valid: boolean;
  error?: string;
  sanitized?: any;
}

/**
 * Validate workspace ID parameter
 */
export function validateIPCWorkspaceId(workspaceId: any): IPCValidationResult {
  if (!workspaceId) {
    return {
      valid: false,
      error: 'Workspace ID is required',
    };
  }

  if (typeof workspaceId !== 'string') {
    return {
      valid: false,
      error: 'Workspace ID must be a string',
    };
  }

  if (!isValidWorkspaceIdFormat(workspaceId)) {
    return {
      valid: false,
      error: 'Invalid workspace ID format',
    };
  }

  return {
    valid: true,
    sanitized: workspaceId,
  };
}

/**
 * Validate file path parameter
 */
export function validateIPCPath(path: any, basePath: string): IPCValidationResult {
  if (!path) {
    return {
      valid: false,
      error: 'Path is required',
    };
  }

  if (typeof path !== 'string') {
    return {
      valid: false,
      error: 'Path must be a string',
    };
  }

  const sanitized = sanitizePath(path);
  if (!sanitized) {
    return {
      valid: false,
      error: 'Invalid or unsafe path',
    };
  }

  return {
    valid: true,
    sanitized,
  };
}

/**
 * Validate array of paths
 */
export function validateIPCPaths(paths: any, basePath: string): IPCValidationResult {
  if (!Array.isArray(paths)) {
    return {
      valid: false,
      error: 'Paths must be an array',
    };
  }

  const sanitized = [];
  for (const path of paths) {
    const result = validateIPCPath(path, basePath);
    if (!result.valid) {
      return result;
    }
    sanitized.push(result.sanitized);
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
      error: `${name} is required`,
    };
  }

  if (typeof value !== 'string') {
    return {
      valid: false,
      error: `${name} must be a string`,
    };
  }

  if (value.length > maxLength) {
    return {
      valid: false,
      error: `${name} exceeds maximum length of ${maxLength}`,
    };
  }

  return {
    valid: true,
    sanitized: value,
  };
}

/**
 * Validate number parameter
 */
export function validateIPCNumber(
  value: any,
  name: string,
  min?: number,
  max?: number,
): IPCValidationResult {
  if (value === undefined || value === null) {
    return {
      valid: false,
      error: `${name} is required`,
    };
  }

  const num = Number(value);
  if (isNaN(num)) {
    return {
      valid: false,
      error: `${name} must be a number`,
    };
  }

  if (min !== undefined && num < min) {
    return {
      valid: false,
      error: `${name} must be at least ${min}`,
    };
  }

  if (max !== undefined && num > max) {
    return {
      valid: false,
      error: `${name} must be at most ${max}`,
    };
  }

  return {
    valid: true,
    sanitized: num,
  };
}

/**
 * Validate boolean parameter
 */
export function validateIPCBoolean(value: any, name: string): IPCValidationResult {
  if (value === undefined || value === null) {
    return {
      valid: false,
      error: `${name} is required`,
    };
  }

  if (typeof value !== 'boolean') {
    return {
      valid: false,
      error: `${name} must be a boolean`,
    };
  }

  return {
    valid: true,
    sanitized: value,
  };
}

/**
 * Rate limiter for IPC calls
 */
export class IPCRateLimiter {
  private callCounts: Map<string, { count: number; resetTime: number }> = new Map();
  private readonly maxCallsPerMinute: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(maxCallsPerMinute: number = 100) {
    this.maxCallsPerMinute = maxCallsPerMinute;
    // Start automatic cleanup every 5 minutes
    this.startAutoCleanup();
  }

  private startAutoCleanup(): void {
    this.cleanupInterval = setInterval(
      () => {
        this.cleanup();
      },
      5 * 60 * 1000,
    ); // 5 minutes
  }

  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.callCounts.clear();
  }

  canCall(channel: string, senderId: string): boolean {
    const key = `${channel}:${senderId}`;
    const now = Date.now();
    const entry = this.callCounts.get(key);

    if (!entry || now > entry.resetTime) {
      // Reset counter
      this.callCounts.set(key, {
        count: 1,
        resetTime: now + 60000, // 1 minute
      });
      return true;
    }

    if (entry.count >= this.maxCallsPerMinute) {
      logger.warn('IPC rate limit exceeded', { channel, senderId, count: entry.count });
      return false;
    }

    entry.count++;
    return true;
  }

  // Clean up old entries periodically
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.callCounts) {
      if (now > entry.resetTime) {
        this.callCounts.delete(key);
      }
    }
  }
}
