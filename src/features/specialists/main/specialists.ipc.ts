/**
 * Specialists IPC Handlers
 *
 * IPC handlers for file-based specialist management.
 * Allows the frontend to list, read, write, and delete specialist files.
 */

import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { SPECIALISTS_CHANNELS } from '../../../shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  EmptySchema,
  SpecialistIdSchema,
  SpecialistWriteSchema,
  SpecialistExportBuiltinSchema,
} from '../../../main/ipc-schemas';
import { Logger } from '../../../shared/logger';
import {
  getSpecialistsDirectory,
  ensureSpecialistsDirectory,
  loadSpecialistFiles,
  loadSpecialistFile,
  loadBundledSpecialistFiles,
  writeSpecialistFile,
  deleteSpecialistFile,
  specialistFileExists,
} from './specialist-file-loader';
import { refreshSpecialistsFromFiles } from '../../agent/main/specialists.service';

const logger = new Logger('SpecialistsIPC');

/**
 * Set up IPC handlers for specialists
 */
export function setupSpecialistsIPC(): void {
  logger.info('Setting up specialists IPC handlers');

  // List user specialist files (from ~/.augment/specialists/)
  ipcMain.handle(
    SPECIALISTS_CHANNELS.LIST_FILES,
    createSafeValidatedHandler(
      EmptySchema,
      async () => {
        try {
          const result = await loadSpecialistFiles();
          return { success: true, data: result };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to list specialist files',
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
            error: error instanceof Error ? error.message : 'Failed to list bundled specialists',
          };
        }
      },
      SPECIALISTS_CHANNELS.LIST_BUNDLED,
    ),
  );

  // List all specialists (bundled + user files, with user overriding bundled)
  ipcMain.handle(
    SPECIALISTS_CHANNELS.LIST_ALL,
    createSafeValidatedHandler(
      EmptySchema,
      async () => {
        try {
          const [bundledResult, userResult] = await Promise.all([
            loadBundledSpecialistFiles(),
            loadSpecialistFiles(),
          ]);

          // Merge with user files taking priority
          const seen = new Set<string>();
          const specialists = [];

          // User files first (highest priority)
          for (const spec of userResult.specialists) {
            seen.add(spec.id);
            specialists.push({ ...spec, source: 'file' as const });
          }

          // Bundled specialists (skip if overridden)
          for (const spec of bundledResult.specialists) {
            if (!seen.has(spec.id)) {
              seen.add(spec.id);
              specialists.push({ ...spec, source: 'bundled' as const });
            }
          }

          return {
            success: true,
            data: {
              specialists,
              errors: [...bundledResult.errors, ...userResult.errors],
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to list all specialists',
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
          const specialist = await loadSpecialistFile(validated.id);
          if (!specialist) {
            return { success: false, error: 'Specialist file not found' };
          }
          return { success: true, data: specialist };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to read specialist file',
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
          await refreshSpecialistsFromFiles();
          return result;
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to write specialist file',
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
          const result = await deleteSpecialistFile(validated.id);
          // Invalidate the backend cache so agents see the deletion immediately
          await refreshSpecialistsFromFiles();
          return result;
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to delete specialist file',
          };
        }
      },
      SPECIALISTS_CHANNELS.DELETE_FILE,
    ),
  );

  // Open the specialists folder
  ipcMain.handle(
    SPECIALISTS_CHANNELS.OPEN_FOLDER,
    createSafeValidatedHandler(
      EmptySchema,
      async () => {
        try {
          const dir = await ensureSpecialistsDirectory();
          await shell.openPath(dir);
          return { success: true, data: dir };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to open specialists folder',
          };
        }
      },
      SPECIALISTS_CHANNELS.OPEN_FOLDER,
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
            error: error instanceof Error ? error.message : 'Failed to get folder path',
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
            return { success: false, error: 'Bundled specialist not found' };
          }

          // Check if file already exists
          const exists = await specialistFileExists(validated.id);
          if (exists) {
            return { success: false, error: 'Specialist file already exists' };
          }

          // Write to user's specialists folder
          const result = await writeSpecialistFile({
            id: bundled.id,
            name: bundled.frontmatter.name,
            description: bundled.frontmatter.description,
            model: bundled.frontmatter.model,
            modelTier: bundled.frontmatter.modelTier,
            roleReminder: bundled.frontmatter.roleReminder,
            behaviorPrompt: bundled.behaviorPrompt,
          });

          // Invalidate the backend cache so agents see the exported specialist immediately
          await refreshSpecialistsFromFiles();

          return result;
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to export specialist',
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
          const exists = await specialistFileExists(validated.id);
          return { success: true, data: exists };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to check file existence',
          };
        }
      },
      SPECIALISTS_CHANNELS.FILE_EXISTS,
    ),
  );

  logger.info('Specialists IPC handlers registered');
}
