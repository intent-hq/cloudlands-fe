/**
 * Runtime Validation System
 *
 * Provides runtime validation for all data types and IPC contracts.
 * Ensures data integrity at runtime and provides detailed error messages.
 */

import { z } from 'zod';
import {
  IpcContracts,
  type IpcContractKey,
} from './contracts';
import { Logger } from '../logger';

const logger = new Logger('TypeValidation');

// ============================================================================
// Validation Results
// ============================================================================

export interface ValidationResult<T = any> {
  success: boolean;
  data?: T;
  errors?: ValidationError[];
  warnings?: string[];
}

export interface ValidationError {
  path: string;
  message: string;
  code: string;
  expected?: string;
  received?: string;
}

// ============================================================================
// IPC Validation
// ============================================================================

/**
 * Validate an IPC request against its contract
 */
export function validateIpcRequest<K extends IpcContractKey>(
  channel: K,
  data: unknown,
): ValidationResult<z.infer<(typeof IpcContracts)[K]['request']>> {
  try {
    const schema = IpcContracts[channel]?.request;
    if (!schema) {
      return {
        success: false,
        errors: [
          {
            path: '',
            message: `No contract defined for channel: ${channel}`,
            code: 'NO_CONTRACT',
          },
        ],
      };
    }

    const result = schema.safeParse(data);

    if (result.success) {
      return {
        success: true,
        data: result.data,
      };
    }

    return {
      success: false,
      errors: formatZodErrors(result.error),
    };
  } catch (error) {
    logger.error('Validation error', error as Error);
    return {
      success: false,
      errors: [
        {
          path: '',
          message: error instanceof Error ? error.message : 'Unknown validation error',
          code: 'VALIDATION_ERROR',
        },
      ],
    };
  }
}

/**
 * Validate an IPC response against its contract
 */
export function validateIpcResponse<K extends IpcContractKey>(
  channel: K,
  data: unknown,
): ValidationResult<z.infer<(typeof IpcContracts)[K]['response']>> {
  try {
    const schema = IpcContracts[channel]?.response;
    if (!schema) {
      return {
        success: false,
        errors: [
          {
            path: '',
            message: `No contract defined for channel: ${channel}`,
            code: 'NO_CONTRACT',
          },
        ],
      };
    }

    const result = schema.safeParse(data);

    if (result.success) {
      return {
        success: true,
        data: result.data,
      };
    }

    return {
      success: false,
      errors: formatZodErrors(result.error),
    };
  } catch (error) {
    logger.error('Validation error', error as Error);
    return {
      success: false,
      errors: [
        {
          path: '',
          message: error instanceof Error ? error.message : 'Unknown validation error',
          code: 'VALIDATION_ERROR',
        },
      ],
    };
  }
}

// ============================================================================
// Error Formatting
// ============================================================================

/**
 * Format Zod errors into a more readable format
 */
function formatZodErrors(error: z.ZodError): ValidationError[] {
  return error.errors.map((err) => ({
    path: err.path.join('.'),
    message: err.message,
    code: err.code,
    expected: 'expected' in err ? String(err.expected) : undefined,
    received: 'received' in err ? String(err.received) : undefined,
  }));
}

// ============================================================================
// Validation Middleware
// ============================================================================

/**
 * Create a validation middleware for IPC handlers
 */
export function createValidationMiddleware<K extends IpcContractKey>(channel: K) {
  return (handler: (data: z.infer<(typeof IpcContracts)[K]['request']>) => Promise<any>) =>
    async (event: any, data: unknown) => {
      const validation = validateIpcRequest(channel, data);

      if (!validation.success) {
        logger.error(`Validation failed for ${channel}`, { errors: validation.errors });
        return {
          success: false,
          errors: validation.errors,
        };
      }

      return handler(validation.data!);
    };
}
