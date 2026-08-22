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

function summarizeImageBlocks(value: unknown) {
  const imageBlocks = Array.isArray(value) ? value : [];
  return {
    hasImageBlocks: imageBlocks.length > 0,
    imageBlocksCount: imageBlocks.length,
    imageBlocksType: Array.isArray(value) ? 'array' : typeof value,
    imageBlocksDataLength: imageBlocks.reduce(
      (total, block) =>
        total +
        (block &&
        typeof block === 'object' &&
        typeof (block as { data?: unknown }).data === 'string'
          ? (block as { data: string }).data.length
          : 0),
      0,
    ),
  };
}

/**
 * Validation error with detailed information
 */
class ValidationError extends Error {
  constructor(
    public channel: string,
    public errors: z.ZodError['errors'],
    public input: unknown,
  ) {
    // i18n-ignore (developer diagnostic error)
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
    if (
      channelName === 'agent-backend:stream-message' &&
      typeof data === 'object' &&
      data !== null
    ) {
      const dataObj = data as any;
      logger.info('IPC Handler: Received STREAM_MESSAGE request', {
        channelName,
        ...summarizeImageBlocks(dataObj.imageBlocks),
      });
    }

    try {
      const validated = schema.parse(data);

      // Log validated data for STREAM_MESSAGE channel to debug image blocks issue
      if (
        channelName === 'agent-backend:stream-message' &&
        typeof validated === 'object' &&
        validated !== null
      ) {
        const validatedObj = validated as any;
        logger.info('IPC Handler: After validation STREAM_MESSAGE request', {
          channelName,
          ...summarizeImageBlocks(validatedObj.imageBlocks),
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
            // i18n-ignore (developer diagnostic error; schema messages are not localized)
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
const validationRegistry = new Map<string, z.ZodSchema<any>>();

/**
 * Register a validation schema for a channel
 */
export function registerValidationSchema(channel: string, schema: z.ZodSchema<any>) {
  validationRegistry.set(channel, schema);
}
