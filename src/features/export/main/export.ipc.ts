/**
 * Chat Export IPC Handlers
 *
 * IPC handlers for exporting chat conversations to HTML files.
 */

import {
  ipcMain,
  dialog,
} from 'electron';
import { promises as fs } from 'fs';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { Logger } from '../../../shared/logger';
import { exportChatToHtml } from '../chat-html-exporter';
import { m } from '../../../shared/paraglide/messages.js';

const logger = new Logger('ChatExportIPC');

// Zod schema for validation
const ExportChatToHtmlSchema = z.object({
  messages: z.array(z.any()),
  title: z.string().min(1, 'Title is required'),
});

/**
 * Register chat export IPC handlers
 */
export function registerChatExportHandlers(): void {
  logger.info('Registering chat export IPC handlers');

  ipcMain.handle(
    IPC_CHANNELS.CHAT_EXPORT.CHAT_TO_HTML,
    createSafeValidatedHandler(
      ExportChatToHtmlSchema,
      async (_event, validated: z.infer<typeof ExportChatToHtmlSchema>) => {
        try {
          logger.info('Starting chat export', {
            messageCount: validated.messages.length,
            title: validated.title,
          });

          // Debug: Log the first message structure
          if (validated.messages.length > 0) {
            logger.info('First message structure:', {
              message: JSON.stringify(validated.messages[0], null, 2),
            });
          }

          // Generate HTML from messages
          const html = exportChatToHtml(validated.messages, {
            title: validated.title,
            exportedAt: new Date(),
          });

          // Generate suggested filename with date
          const now = new Date();
          const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
          const suggestedFilename = `${validated.title}-${dateStr}.html`;

          // Show save dialog
          const { filePath, canceled } = await dialog.showSaveDialog({
            defaultPath: suggestedFilename,
            filters: [{ name: m.dialog_html_files_filter(), extensions: ['html'] }],
          });

          if (canceled || !filePath) {
            return { success: false, canceled: true };
          }

          // Write HTML to file
          await fs.writeFile(filePath, html, 'utf-8');

          logger.info('Chat exported successfully', {
            filePath,
            messageCount: validated.messages.length,
          });

          return { success: true, filePath };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : '';
          logger.error('Failed to export chat', error as Error, {
            messageCount: validated.messages.length,
            errorMessage: errorMsg,
            errorStack,
          });
          return {
            success: false,
            error: errorMsg || 'Failed to export chat',
          };
        }
      },
      IPC_CHANNELS.CHAT_EXPORT.CHAT_TO_HTML,
    ),
  );

  logger.info('Chat export IPC handlers registered');
}
