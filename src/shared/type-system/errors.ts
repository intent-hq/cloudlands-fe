/**
 * Type System Error Handling
 *
 * Provides detailed error messages and recovery suggestions for type-related errors.
 * Designed to be AI-friendly with clear explanations and actionable fixes.
 */

import type { ValidationError } from './validation';

// ============================================================================
// Error Types
// ============================================================================

export class TypeValidationError extends Error {
  constructor(
    public readonly channel: string,
    public readonly errors: ValidationError[],
    public readonly data?: unknown,
  ) {
    super(`Type validation failed for ${channel}`);
    this.name = 'TypeValidationError';
  }

  /**
   * Get AI-friendly error description
   */
  getAIDescription(): string {
    const errorList = this.errors
      .map(
        (e) =>
          `  - ${e.path || 'root'}: ${e.message} (expected: ${e.expected}, received: ${e.received})`,
      )
      .join('\n');

    return `
Type validation failed for IPC channel '${this.channel}'.

Errors:
${errorList}

This means the data being sent doesn't match the expected type contract.
Check the type definitions in 'src/shared/type-system/contracts.ts' for the correct structure.
    `.trim();
  }

  /**
   * Get suggested fixes
   */
  getSuggestedFixes(): string[] {
    const fixes: string[] = [];

    for (const error of this.errors) {
      if (error.code === 'invalid_type') {
        fixes.push(`Change ${error.path} from ${error.received} to ${error.expected}`);
      } else if (error.code === 'unrecognized_keys') {
        fixes.push(`Remove unexpected property: ${error.path}`);
      } else if (error.code === 'invalid_enum_value') {
        fixes.push(`Use one of the valid enum values for ${error.path}`);
      }
    }

    return fixes;
  }
}

export class HandlerNotRegisteredError extends Error {
  constructor(
    public readonly channel: string,
    public readonly suggestedFile?: string,
  ) {
    super(`IPC handler not registered for channel: ${channel}`);
    this.name = 'HandlerNotRegisteredError';
  }

  /**
   * Get AI-friendly error description
   */
  getAIDescription(): string {
    const fileHint = this.suggestedFile ? `\nLikely location: ${this.suggestedFile}` : '';

    return `
IPC handler not registered for channel '${this.channel}'.

This means the main process doesn't have a handler for this IPC channel.
You need to register the handler in the main process initialization.${fileHint}

To fix:
1. Check if the handler is defined in the appropriate .ipc.ts file
2. Ensure it's registered in src/main/index.ts
3. Verify the channel name matches exactly
    `.trim();
  }
}

export class TypeMismatchError extends Error {
  constructor(
    public readonly entity: string,
    public readonly field: string,
    public readonly expected: string,
    public readonly received: string,
  ) {
    super(`Type mismatch in ${entity}.${field}: expected ${expected}, got ${received}`);
    this.name = 'TypeMismatchError';
  }

  /**
   * Get AI-friendly error description
   */
  getAIDescription(): string {
    return `
Type mismatch detected in ${this.entity}.

Field: ${this.field}
Expected type: ${this.expected}
Received type: ${this.received}

This indicates a mismatch between frontend and backend type definitions.
Both sides must use the same type contract from 'src/shared/type-system/contracts.ts'.
    `.trim();
  }
}

// ============================================================================
// Error Recovery
// ============================================================================

export interface RecoveryStrategy {
  action: string;
  description: string;
  code?: string;
}

/**
 * Get recovery strategies for type errors
 */
export function getRecoveryStrategies(error: Error): RecoveryStrategy[] {
  const strategies: RecoveryStrategy[] = [];

  if (error instanceof TypeValidationError) {
    strategies.push({
      action: 'Fix type mismatch',
      description: 'Update the data to match the expected type contract',
      code: error.getSuggestedFixes().join('\n'),
    });
  } else if (error instanceof HandlerNotRegisteredError) {
    strategies.push({
      action: 'Register handler',
      description: 'Add the IPC handler registration in main process',
      code: `ipcMain.handle('${error.channel}', async (event, data) => {\n  // Handler implementation\n});`,
    });
  } else if (error instanceof TypeMismatchError) {
    strategies.push({
      action: 'Align types',
      description: 'Ensure both frontend and backend use the same type definition',
    });
  }

  return strategies;
}
