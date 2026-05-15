/**
 * File Attribution IPC Handlers
 *
 * Provides IPC bridge for recording agent file writes from the renderer process.
 * This is critical for proper agent attribution when Auggie agents write files
 * directly to disk using their own tools (str_replace_editor, save-file).
 */

import { ipcMain } from 'electron';
import { readFile } from 'fs/promises';
import {
  join,
  isAbsolute,
} from 'path';
import { z } from 'zod';
import { Logger } from '../../../../shared/logger';
import { IPC_CHANNELS } from '../../../../shared/ipc-registry';
import { createSafeValidatedHandler } from '../../../../main/ipc-validation-middleware';
import { getAttributionEngine } from './attribution-engine';

const logger = new Logger('FileAttributionIPC');

// Schema for recording agent write
const RecordAgentWriteSchema = z.object({
  agentId: z.string(),
  agentName: z.string().optional(),
  sessionId: z.string().optional(),
  turnNumber: z.number().optional(),
  messageId: z.string().optional(),
  filePath: z.string(),
  content: z.string(),
  workspacePath: z.string().optional(),
  workspaceId: z.string().optional(),
});

// Schema for reading file and recording
const ReadFileAndRecordSchema = z.object({
  agentId: z.string(),
  agentName: z.string().optional(),
  sessionId: z.string().optional(),
  turnNumber: z.number().optional(),
  messageId: z.string().optional(),
  filePath: z.string(),
  workspacePath: z.string(),
  workspaceId: z.string().optional(),
});

export function setupFileAttributionIPC(): void {
  logger.info('Setting up file attribution IPC handlers');

  // Record agent write with content
  ipcMain.handle(
    IPC_CHANNELS.FILE_ATTRIBUTION.RECORD_AGENT_WRITE,
    createSafeValidatedHandler(
      RecordAgentWriteSchema,
      async (_event, validated) => {
        try {
          const attributionEngine = getAttributionEngine();

          // Build full file path if workspace path is provided
          let fullPath = validated.filePath;
          if (validated.workspacePath && !isAbsolute(validated.filePath)) {
            fullPath = join(validated.workspacePath, validated.filePath);
          }

          // Pass workspacePath and workspaceId for path normalization and persistence
          attributionEngine.recordAgentWrite(
            {
              agentId: validated.agentId,
              agentName: validated.agentName || validated.agentId,
              sessionId: validated.sessionId,
              turnNumber: validated.turnNumber,
              messageId: validated.messageId,
            },
            fullPath,
            validated.content,
            validated.workspacePath,
            validated.workspaceId,
          );

          logger.debug('Recorded agent write', {
            agentId: validated.agentId,
            filePath: fullPath,
            workspacePath: validated.workspacePath,
            workspaceId: validated.workspaceId,
            contentLength: validated.content.length,
          });

          return { success: true };
        } catch (error) {
          logger.error('Failed to record agent write', error as Error, {
            agentId: validated.agentId,
            filePath: validated.filePath,
          });
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to record agent write',
          };
        }
      },
      IPC_CHANNELS.FILE_ATTRIBUTION.RECORD_AGENT_WRITE,
    ),
  );

  // Read file and record agent write (for str_replace_editor where we don't have final content)
  ipcMain.handle(
    IPC_CHANNELS.FILE_ATTRIBUTION.READ_FILE_AND_RECORD,
    createSafeValidatedHandler(
      ReadFileAndRecordSchema,
      async (_event, validated) => {
        try {
          const attributionEngine = getAttributionEngine();

          // Build full file path
          const fullPath = isAbsolute(validated.filePath)
            ? validated.filePath
            : join(validated.workspacePath, validated.filePath);

          // Read the file content
          const content = await readFile(fullPath, 'utf-8');

          // Pass workspacePath and workspaceId for path normalization and persistence
          attributionEngine.recordAgentWrite(
            {
              agentId: validated.agentId,
              agentName: validated.agentName || validated.agentId,
              sessionId: validated.sessionId,
              turnNumber: validated.turnNumber,
              messageId: validated.messageId,
            },
            fullPath,
            content,
            validated.workspacePath,
            validated.workspaceId,
          );

          logger.debug('Read file and recorded agent write', {
            agentId: validated.agentId,
            filePath: fullPath,
            workspacePath: validated.workspacePath,
            workspaceId: validated.workspaceId,
            contentLength: content.length,
          });

          return { success: true };
        } catch (error) {
          logger.error('Failed to read file and record agent write', error as Error, {
            agentId: validated.agentId,
            filePath: validated.filePath,
          });
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to read file and record',
          };
        }
      },
      IPC_CHANNELS.FILE_ATTRIBUTION.READ_FILE_AND_RECORD,
    ),
  );

  logger.info('File attribution IPC handlers setup complete');
}
