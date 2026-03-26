/**
 * Deep Link IPC Handlers
 *
 * Handles deep link validation and processing
 */

import { ipcMain } from 'electron';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { z } from 'zod';
import { Logger } from '$lib/utils/logger';

const logger = new Logger({ category: 'DeepLink-IPC' });

// Validation schemas
const ValidateWorkspaceSchema = z.object({
  workspaceId: z.string(),
  deepLinkUrl: z.string().optional(),
});

const WriteFileSchema = z.object({
  filePath: z.string(),
  content: z.string(),
  encoding: z.enum(['utf8', 'base64', 'ascii']).optional().default('utf8'),
});

/**
 * Register deep link IPC handlers
 */
export function registerDeepLinkHandlers(): void {
  // Remove any existing handlers before registering to prevent duplicates
  const handlers = ['deep-link:validate-workspace', 'deep-link:open-file'];

  // Remove existing handlers
  for (const channel of handlers) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // Handler might not exist, that's ok
    }
  }

  // Validate workspace from deep link
  ipcMain.handle(
    'deep-link:validate-workspace',
    createSafeValidatedHandler(
      ValidateWorkspaceSchema,
      async (_event, { workspaceId, deepLinkUrl }) => {
        try {
          logger.info('Validating workspace from deep link', { workspaceId, deepLinkUrl });

          // In production, this would validate the workspace exists and is accessible
          // For now, return mock validation
          const isValid = workspaceId && workspaceId.length > 0;

          return {
            success: isValid,
            workspaceId,
            valid: isValid,
            message: isValid ? 'Workspace validated' : 'Invalid workspace ID',
          };
        } catch (error) {
          logger.error('Failed to validate workspace', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      'deep-link:validate-workspace',
    ),
  );

  // Write file
  ipcMain.handle(
    'write_file',
    createSafeValidatedHandler(
      WriteFileSchema,
      async (_event, { filePath, content, encoding }) => {
        try {
          logger.info('Writing file', { filePath, contentLength: content.length, encoding });

          // In production, this would actually write the file
          // For now, we'll use the file system
          const fs = await import('fs/promises');
          await fs.writeFile(filePath, content, encoding);

          return {
            success: true,
            filePath,
            bytesWritten: content.length,
          };
        } catch (error) {
          logger.error('Failed to write file', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      'write_file',
    ),
  );

  logger.info('Deep link IPC handlers registered');
}
