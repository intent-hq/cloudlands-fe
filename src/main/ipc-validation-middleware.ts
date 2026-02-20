/**
 * IPC Validation Middleware
 *
 * Provides a centralized validation system for all IPC handlers.
 * Automatically validates all IPC requests against their schemas before processing.
 *
 * Usage:
 *   const handler = createValidatedHandler(
 *     WorkspaceGetRequestSchema,
 *     async (validated) => {
 *       // validated is type-safe and guaranteed to match schema
 *       return await workspaceService.getWorkspace(validated.workspaceId);
 *     }
 *   );
 *   ipcMain.handle('workspace:get', handler);
 */

import { z } from 'zod';
import { Logger } from '../shared/logger';
import { ipcDebugTracker } from '../shared/main/ipc-debug-tracker';
import type { IpcMainInvokeEvent } from 'electron';

const logger = new Logger('IPCValidationMiddleware');

/**
 * Validation error with detailed information
 */
export class ValidationError extends Error {
  constructor(
    public channel: string,
    public errors: z.ZodError['errors'],
    public input: unknown,
  ) {
    super(`Validation failed for channel ${channel}`);
    this.name = 'ValidationError';
  }
}

/**
 * Create a validated IPC handler that automatically validates input
 *
 * @param schema - Zod schema to validate against
 * @param handler - Handler function that receives validated data
 * @returns IPC handler function
 */
export function createValidatedHandler<T>(
  schema: z.ZodSchema<T>,
  handler: (event: IpcMainInvokeEvent, validated: T) => Promise<any>,
  channel?: string,
) {
  return async (event: IpcMainInvokeEvent, data: unknown) => {
    const channelName = channel || 'unknown';

    // Track the IPC call
    ipcDebugTracker.trackCall(channelName, data, 'main');

    try {
      const validated = schema.parse(data);
      const result = await handler(event, validated);

      // Track success
      ipcDebugTracker.trackSuccess(channelName, result);

      return result;
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.error('IPC validation failed', {
          errors: error.errors,
          input: data,
        });

        // Track validation error
        ipcDebugTracker.trackValidationError(channelName, error, data);

        throw new ValidationError(channelName, error.errors, data);
      }
      throw error;
    }
  };
}

/**
 * Create a validated IPC handler with safe error handling
 * Returns error response instead of throwing
 */
export function createSafeValidatedHandler<T>(
  schema: z.ZodSchema<T>,
  handler: (event: IpcMainInvokeEvent, validated: T) => Promise<any>,
  channel?: string,
) {
  return async (event: IpcMainInvokeEvent, data: unknown) => {
    const channelName = channel || 'unknown';

    // Track the IPC call
    ipcDebugTracker.trackCall(channelName, data, 'main');

    // Log incoming data for STREAM_MESSAGE channel to debug image blocks issue
    if (channelName === 'agent-backend:stream-message' && typeof data === 'object' && data !== null) {
      const dataObj = data as any;
      logger.info('IPC Handler: Received STREAM_MESSAGE request', {
        channelName,
        hasImageBlocks: !!dataObj.imageBlocks,
        imageBlocksCount: dataObj.imageBlocks?.length || 0,
        imageBlocksType: typeof dataObj.imageBlocks,
        dataKeys: Object.keys(dataObj),
        imageBlocksValue: dataObj.imageBlocks,
      });
    }

    try {
      const validated = schema.parse(data);

      // Log validated data for STREAM_MESSAGE channel to debug image blocks issue
      if (channelName === 'agent-backend:stream-message' && typeof validated === 'object' && validated !== null) {
        const validatedObj = validated as any;
        logger.info('IPC Handler: After validation STREAM_MESSAGE request', {
          channelName,
          hasImageBlocks: !!validatedObj.imageBlocks,
          imageBlocksCount: validatedObj.imageBlocks?.length || 0,
          validatedKeys: Object.keys(validatedObj),
        });
      }

      const result = await handler(event, validated);

      // Track success
      ipcDebugTracker.trackSuccess(channelName, result);

      return result;
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.warn('IPC validation failed', {
          errors: error.errors,
        });

        // Track validation error
        ipcDebugTracker.trackValidationError(channelName, error, data);

        return {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request parameters',
            details: error.errors,
          },
        };
      }
      throw error;
    }
  };
}

/**
 * Validation registry for all IPC channels
 * Maps channel names to their validation schemas
 */
export const validationRegistry = new Map<string, z.ZodSchema<any>>();

/**
 * Register a validation schema for a channel
 */
export function registerValidationSchema(channel: string, schema: z.ZodSchema<any>) {
  validationRegistry.set(channel, schema);
}

/**
 * Get validation schema for a channel
 */
export function getValidationSchema(channel: string): z.ZodSchema<any> | undefined {
  return validationRegistry.get(channel);
}

/**
 * Validate data against a channel's schema
 */
export function validateForChannel(channel: string, data: unknown): any {
  const schema = getValidationSchema(channel);
  if (!schema) {
    throw new Error(`No validation schema registered for channel: ${channel}`);
  }
  return schema.parse(data);
}
