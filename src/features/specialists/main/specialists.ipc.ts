/**
 * Specialists IPC Handlers
 *
 * IPC handlers for file-based specialist management.
 * Allows the frontend to list, read, write, and delete specialist files.
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { SPECIALISTS_CHANNELS } from '../../../shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  EmptySchema,
  SpecialistIdSchema,
  SpecialistListSchema,
  SpecialistWriteSchema,
  SpecialistExportBuiltinSchema,
} from '../../../main/ipc-schemas';
import { Logger } from '../../../shared/logger';
import { m } from '../../../shared/paraglide/messages.js';
import {
  getSpecialistsDirectory,
  loadSpecialistFiles,
  loadProjectSpecialistFiles,
  loadSpecialistFile,
  loadBundledSpecialistFiles,
  writeSpecialistFile,
  deleteSpecialistFile,
  specialistFileExists,
} from './specialist-file-loader';
import { refreshSpecialistsFromFiles } from '../../agent/main/specialists.service';
import { mergeSpecialistsByPriority } from '../../../shared/specialist-file-types';

const logger = new Logger('SpecialistsIPC');

/**
 * Set up IPC handlers for specialists
 */
export function setupSpecialistsIPC(): void {
  logger.info('Setting up specialists IPC handlers');

  // List file-based specialists (project + user, with project overriding user)
  ipcMain.handle(
    SPECIALISTS_CHANNELS.LIST_FILES,
    createSafeValidatedHandler(
      SpecialistListSchema,
      async (_event: IpcMainInvokeEvent, validated: z.infer<typeof SpecialistListSchema>) => {
        try {
          const [projectResult, userResult] = await Promise.all([
            loadProjectSpecialistFiles(validated.workspacePath),
            loadSpecialistFiles(),
          ]);

          return {
            success: true,
            data: {
              specialists: mergeSpecialistsByPriority(
                userResult.specialists,
                projectResult.specialists,
              ),
              errors: [...projectResult.errors, ...userResult.errors],
            },
          };
        } catch (error) {
          return {
            success: false,
            error:
              error instanceof Error ? error.message : m.specialists_ipc_listFilesFailed_error(),
          };
        }
      },
      SPECIALISTS_CHANNELS.LIST_FILES,
    ),
  );

  // List bundled specialists (from resources/specialists/)
  ipcMain.handle(
    SPECIALISTS_CHANNELS.LIST_BUNDLED,
    createSafeValidatedHandler(
      EmptySchema,
      async () => {
        try {
          const result = await loadBundledSpecialistFiles();
          return { success: true, data: result };
        } catch (error) {
          return {
            success: false,
            error:
              error instanceof Error ? error.message : m.specialists_ipc_listBundledFailed_error(),
          };
        }
      },
      SPECIALISTS_CHANNELS.LIST_BUNDLED,
    ),
  );

  // List all specialists (bundled + user files + project files, with higher-priority sources winning)
  ipcMain.handle(
    SPECIALISTS_CHANNELS.LIST_ALL,
    createSafeValidatedHandler(
      SpecialistListSchema,
      async (_event: IpcMainInvokeEvent, validated: z.infer<typeof SpecialistListSchema>) => {
        try {
          const [bundledResult, userResult, projectResult] = await Promise.all([
            loadBundledSpecialistFiles(),
            loadSpecialistFiles(),
            loadProjectSpecialistFiles(validated.workspacePath),
          ]);

          return {
            success: true,
            data: {
              specialists: mergeSpecialistsByPriority(
                bundledResult.specialists,
                userResult.specialists,
                projectResult.specialists,
              ),
              errors: [...bundledResult.errors, ...userResult.errors, ...projectResult.errors],
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : m.specialists_ipc_listAllFailed_error(),
          };
        }
      },
      SPECIALISTS_CHANNELS.LIST_ALL,
    ),
  );

  // Read a single specialist file
  ipcMain.handle(
    SPECIALISTS_CHANNELS.READ_FILE,
    createSafeValidatedHandler(
      SpecialistIdSchema,
      async (_event: IpcMainInvokeEvent, validated: z.infer<typeof SpecialistIdSchema>) => {
        try {
          const specialist = await loadSpecialistFile(
            validated.id,
            validated.scope,
            validated.workspacePath,
          );
          if (!specialist) {
            return { success: false, error: m.specialists_loader_fileNotFound_error() };
          }
          return { success: true, data: specialist };
        } catch (error) {
          return {
            success: false,
            error:
              error instanceof Error ? error.message : m.specialists_ipc_readFileFailed_error(),
          };
        }
      },
      SPECIALISTS_CHANNELS.READ_FILE,
    ),
  );

  // Write a specialist file
  ipcMain.handle(
    SPECIALISTS_CHANNELS.WRITE_FILE,
    createSafeValidatedHandler(
      SpecialistWriteSchema,
      async (_event: IpcMainInvokeEvent, validated: z.infer<typeof SpecialistWriteSchema>) => {
        try {
          const result = await writeSpecialistFile(validated);
          // Invalidate the backend cache so agents see the updated specialist immediately
          await refreshSpecialistsFromFiles(
            validated.scope === 'project' ? validated.workspacePath : undefined,
          );
          return result;
        } catch (error) {
          return {
            success: false,
            error:
              error instanceof Error ? error.message : m.specialists_ipc_writeFileFailed_error(),
          };
        }
      },
      SPECIALISTS_CHANNELS.WRITE_FILE,
    ),
  );

  // Delete a specialist file
  ipcMain.handle(
    SPECIALISTS_CHANNELS.DELETE_FILE,
    createSafeValidatedHandler(
      SpecialistIdSchema,
      async (_event: IpcMainInvokeEvent, validated: z.infer<typeof SpecialistIdSchema>) => {
        try {
          const result = await deleteSpecialistFile(
            validated.id,
            validated.scope,
            validated.workspacePath,
          );
          // Invalidate the backend cache so agents see the deletion immediately
          await refreshSpecialistsFromFiles(
            validated.scope === 'project' ? validated.workspacePath : undefined,
          );
          return result;
        } catch (error) {
          return {
            success: false,
            error:
              error instanceof Error ? error.message : m.specialists_ipc_deleteFileFailed_error(),
          };
        }
      },
      SPECIALISTS_CHANNELS.DELETE_FILE,
    ),
  );

  // Get the specialists folder path
  ipcMain.handle(
    SPECIALISTS_CHANNELS.GET_FOLDER_PATH,
    createSafeValidatedHandler(
      EmptySchema,
      async () => {
        try {
          const dir = getSpecialistsDirectory();
          return { success: true, data: dir };
        } catch (error) {
          return {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : m.specialists_ipc_getFolderPathFailed_error(),
          };
        }
      },
      SPECIALISTS_CHANNELS.GET_FOLDER_PATH,
    ),
  );

  // Export a bundled specialist to a user file (for customization)
  ipcMain.handle(
    SPECIALISTS_CHANNELS.EXPORT_BUILTIN,
    createSafeValidatedHandler(
      SpecialistExportBuiltinSchema,
      async (
        _event: IpcMainInvokeEvent,
        validated: z.infer<typeof SpecialistExportBuiltinSchema>,
      ) => {
        try {
          // Find the bundled specialist
          const bundledResult = await loadBundledSpecialistFiles();
          const bundled = bundledResult.specialists.find((s) => s.id === validated.id);
          if (!bundled) {
            return { success: false, error: m.specialists_ipc_bundledNotFound_error() };
          }

          // Check if file already exists
          const exists = await specialistFileExists(validated.id);
          if (exists) {
            return { success: false, error: m.specialists_ipc_fileExists_error() };
          }

          // Write to user's specialists folder
          const result = await writeSpecialistFile({
            id: bundled.id,
            name: bundled.frontmatter.name,
            description: bundled.frontmatter.description,
            codingAgent: bundled.frontmatter.codingAgent,
            model: bundled.frontmatter.model,
            roleReminder: bundled.frontmatter.roleReminder,
            hidden: bundled.frontmatter.hidden,
            modelOptions: bundled.frontmatter.modelOptions,
            reasoningEffort: bundled.frontmatter.reasoningEffort,
            behaviorPrompt: bundled.behaviorPrompt,
          });

          // Invalidate the backend cache so agents see the exported specialist immediately
          await refreshSpecialistsFromFiles();

          return result;
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : m.specialists_ipc_exportFailed_error(),
          };
        }
      },
      SPECIALISTS_CHANNELS.EXPORT_BUILTIN,
    ),
  );

  // Check if a specialist file exists
  ipcMain.handle(
    SPECIALISTS_CHANNELS.FILE_EXISTS,
    createSafeValidatedHandler(
      SpecialistIdSchema,
      async (_event: IpcMainInvokeEvent, validated: z.infer<typeof SpecialistIdSchema>) => {
        try {
          const exists = await specialistFileExists(
            validated.id,
            validated.scope,
            validated.workspacePath,
          );
          return { success: true, data: exists };
        } catch (error) {
          return {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : m.specialists_ipc_checkExistenceFailed_error(),
          };
        }
      },
      SPECIALISTS_CHANNELS.FILE_EXISTS,
    ),
  );

  logger.info('Specialists IPC handlers registered');
}
