/**
 * Runtime Type Checker
 *
 * Provides runtime type checking and monitoring for development.
 * Automatically detects and reports type mismatches in real-time.
 */

import { Logger } from '../logger';
import { AgentErrorTracker } from '../main/agent-error-tracker';
import { type IpcContractKey } from './contracts';
import { validateIpcRequest, validateIpcResponse } from './validation';
import { TypeMismatchError } from './errors';
import type { ValidationError } from './validation';

const logger = new Logger('RuntimeTypeChecker');
const errorTracker = AgentErrorTracker.getInstance();

// Type definitions
interface TypeMismatch {
  channel?: string;
  direction?: 'request' | 'response';
  errors?: ValidationError[];
  data?: any;
  timestamp: string | Date;
  location?: string;
  typeName?: string;
  value?: any;
}

interface CheckResult {
  valid: boolean;
  errors?: ValidationError[];
  suggestions?: string[];
}

interface TypeCheckStats {
  totalChecks?: number;
  errorCount: number;
  mismatches?: TypeMismatch[];
  recentMismatches?: TypeMismatch[];
  strictMode?: boolean;
}

// ============================================================================
// Runtime Type Checker
// ============================================================================

export class RuntimeTypeChecker {
  private static instance: RuntimeTypeChecker;
  private enabled: boolean = process.env.NODE_ENV === 'development';
  private strictMode: boolean = false;
  private errorCount: number = 0;
  private mismatchLog: TypeMismatch[] = [];

  static getInstance(): RuntimeTypeChecker {
    if (!this.instance) {
      this.instance = new RuntimeTypeChecker();
    }
    return this.instance;
  }

  /**
   * Enable or disable runtime checking
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    logger.info(`Runtime type checking ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Enable strict mode (throws on type errors)
   */
  setStrictMode(strict: boolean): void {
    this.strictMode = strict;
    logger.info(`Strict mode ${strict ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check IPC request/response pair
   */
  checkIpc<K extends IpcContractKey>(
    channel: K,
    direction: 'request' | 'response',
    data: unknown,
  ): CheckResult {
    if (!this.enabled) {
      return { valid: true };
    }

    const validation =
      direction === 'request'
        ? validateIpcRequest(channel, data)
        : validateIpcResponse(channel, data);

    if (!validation.success) {
      // Log validation error
      logger.error(`Validation failed for ${channel}`, {
        direction,
        errors: validation.errors,
        data,
      });

      return {
        valid: false,
        errors: validation.errors,
        suggestions: [], // Note: Suggestions not yet implemented
      };
    }

    return { valid: true };
  }

  /**
   * Check object against expected type
   */
  checkType<T>(
    value: unknown,
    typeName: string,
    validator: (value: unknown) => value is T,
  ): CheckResult {
    if (!this.enabled) {
      return { valid: true };
    }

    if (!validator(value)) {
      const mismatch: TypeMismatch = {
        timestamp: new Date().toISOString(),
        typeName,
        value,
        location: this.getCallLocation(),
      };

      this.mismatchLog.push(mismatch);
      this.errorCount++;

      const error = new TypeMismatchError(typeName, 'value', typeName, typeof value);

      if (this.strictMode) {
        throw error;
      }

      // Track in error system
      errorTracker.trackError({
        source: 'main' as const,
        level: 'warning',
        message: error.message,
        component: 'RuntimeTypeChecker',
        agentHints: {
          possibleCauses: ['Type mismatch between expected and actual value'],
          suggestedFixes: [`Ensure value matches type ${typeName}`],
          relatedFiles: [this.getCallLocation()],
        },
      });

      return {
        valid: false,
        errors: [
          {
            path: 'value',
            message: error.message,
            code: 'TYPE_MISMATCH',
            expected: typeName,
            received: typeof value,
          },
        ],
      };
    }

    return { valid: true };
  }

  /**
   * Get statistics
   */
  getStats(): TypeCheckStats {
    return {
      // enabled: this.enabled,
      // strictMode: this.strictMode,
      errorCount: this.errorCount,
      recentMismatches: this.mismatchLog.slice(-10),
    };
  }

  /**
   * Clear error log
   */
  clearLog(): void {
    this.errorCount = 0;
    this.mismatchLog = [];
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Get the call location for debugging
   */
  private getCallLocation(): string {
    const stack = new Error().stack;
    if (!stack) return 'unknown';

    const lines = stack.split('\n');
    // Skip the first 3 lines (Error, getCallLocation, and the caller)
    const callerLine = lines[3];
    if (!callerLine) return 'unknown';

    const match = callerLine.match(/at\s+(.+)\s+\((.+):(\d+):(\d+)\)/);
    if (match) {
      return `${match[2]}:${match[3]}:${match[4]}`;
    }

    return callerLine.trim();
  }
}
