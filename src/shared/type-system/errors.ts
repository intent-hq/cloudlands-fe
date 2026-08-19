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
