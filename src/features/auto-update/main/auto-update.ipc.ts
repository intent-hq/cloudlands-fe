/**
 * Auto-Update IPC Handlers
 *
 * Provides IPC handlers for auto-update operations.
 * Bridges the auto-update service with the renderer process.
 */

import {
  BrowserWindow,
  ipcMain,
} from 'electron';
import { z } from 'zod';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { Logger } from '../../../shared/logger';
import { AUTO_UPDATE_CHANNELS } from '../types';
import { autoUpdateService } from './auto-update.service';

const logger = new Logger('AutoUpdateIPC');

// Validation schemas
const EmptySchema = z.object({}).optional();
const SetChannelSchema = z.object({
  channel: z.enum(['stable', 'beta', 'alpha']),
});

/**
 * Setup auto-update IPC handlers
 */
export function setupAutoUpdateIPC(): void {
  logger.info('Setting up auto-update IPC handlers');

  // Check for updates
  ipcMain.handle(
    AUTO_UPDATE_CHANNELS.CHECK,
    createSafeValidatedHandler(
      EmptySchema,
      async () => {
        const state = await autoUpdateService.checkForUpdates();
        return { success: true, data: state };
      },
      AUTO_UPDATE_CHANNELS.CHECK,
    ),
  );

  // Manual check for updates (triggers "up to date" notification if no updates)
  ipcMain.handle(
    AUTO_UPDATE_CHANNELS.CHECK_MANUAL,
    createSafeValidatedHandler(
      EmptySchema,
      async () => {
        const state = await autoUpdateService.checkForUpdatesManual();
        return { success: true, data: state };
      },
      AUTO_UPDATE_CHANNELS.CHECK_MANUAL,
    ),
  );

  // Download update
  ipcMain.handle(
    AUTO_UPDATE_CHANNELS.DOWNLOAD,
    createSafeValidatedHandler(
      EmptySchema,
      async () => {
        await autoUpdateService.downloadUpdate();
        return { success: true };
      },
      AUTO_UPDATE_CHANNELS.DOWNLOAD,
    ),
  );

  // Install update (quit and install)
  ipcMain.handle(
    AUTO_UPDATE_CHANNELS.INSTALL,
    createSafeValidatedHandler(
      EmptySchema,
      async () => {
        await autoUpdateService.installUpdate();
        return { success: true };
      },
      AUTO_UPDATE_CHANNELS.INSTALL,
    ),
  );

  // Get current state
  ipcMain.handle(
    AUTO_UPDATE_CHANNELS.GET_STATE,
    createSafeValidatedHandler(
      EmptySchema,
      async () => ({ success: true, data: autoUpdateService.getState() }),
      AUTO_UPDATE_CHANNELS.GET_STATE,
    ),
  );

  // Set update channel
  ipcMain.handle(
    AUTO_UPDATE_CHANNELS.SET_CHANNEL,
    createSafeValidatedHandler(
      SetChannelSchema,
      async (_event, validated) => {
        autoUpdateService.setChannel(validated.channel);
        return { success: true };
      },
      AUTO_UPDATE_CHANNELS.SET_CHANNEL,
    ),
  );

  logger.info('Auto-update IPC handlers registered');
}

/**
 * Initialize the auto-updater with the main window
 * Call this after the main window is created
 */
export function initializeAutoUpdater(mainWindow: BrowserWindow): void {
  autoUpdateService.initialize(mainWindow);
}

/**
 * Update the auto-updater's main window reference.
 * Call this when a new window is created to ensure status events
 * are sent to the correct (current) window.
 */
export function updateAutoUpdaterWindow(mainWindow: BrowserWindow): void {
  autoUpdateService.updateMainWindow(mainWindow);
}

/**
 * Cleanup auto-updater resources
 * Call this when the app is quitting
 */
export function cleanupAutoUpdater(): void {
  autoUpdateService.cleanup();
}
