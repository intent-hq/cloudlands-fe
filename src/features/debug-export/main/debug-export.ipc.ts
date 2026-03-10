/**
 * Debug Export IPC Handlers
 *
 * IPC handlers for exporting all debug logs as a zip file.
 */

import { ipcMain, dialog, app } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { LOG_CHANNELS } from '../../../shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { Logger } from '../../../shared/logger';
import { EmptySchema } from '../../../main/ipc-schemas';
import { createDebugBundle } from './debug-bundle.service';

const logger = new Logger('DebugExportIPC');

// Schema for optional workspace ID
const ExportDebugBundleSchema = z.object({
  workspaceId: z.string().optional(),
}).optional();

/**
 * Register debug export IPC handlers
 */
export function registerDebugExportHandlers(): void {
  logger.info('Registering debug export IPC handlers');

  ipcMain.handle(
    LOG_CHANNELS.EXPORT_DEBUG_BUNDLE,
    createSafeValidatedHandler(
      ExportDebugBundleSchema,
      async (_, validated) => {
        try {
          const workspaceId = validated?.workspaceId;
          logger.info('Starting debug bundle export', { workspaceId });

          // Create the debug bundle (with optional workspace ID)
          const bundlePath = await createDebugBundle(workspaceId);

          // Generate suggested filename with date
          const now = new Date();
          const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
          const timeStr = now.toTimeString().slice(0, 5).replace(':', ''); // HHmm
          const suggestedFilename = `intent-debug-${dateStr}-${timeStr}.zip`;

          // Show save dialog
          const { filePath, canceled } = await dialog.showSaveDialog({
            defaultPath: suggestedFilename,
            filters: [{ name: 'ZIP Files', extensions: ['zip'] }],
          });

          if (canceled || !filePath) {
            // Clean up temp bundle
            try {
              await fs.unlink(bundlePath);
            } catch (e) {
              // Ignore cleanup errors
            }
            return { success: false, canceled: true };
          }

          // Move bundle to final location
          await fs.copyFile(bundlePath, filePath);
          await fs.unlink(bundlePath);

          logger.info('Debug bundle exported successfully', { filePath });

          return { success: true, filePath };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : '';
          logger.error('Failed to export debug bundle', error as Error, {
            errorMessage: errorMsg,
            errorStack,
          });
          return {
            success: false,
            error: errorMsg || 'Failed to export debug bundle',
          };
        }
      },
      LOG_CHANNELS.EXPORT_DEBUG_BUNDLE,
    ),
  );

  logger.info('Debug export IPC handlers registered');
}

