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
import { SetChannelRequestSchema } from '../auto-update-validation';
import { autoUpdateService } from './auto-update.service';

const logger = new Logger('AutoUpdateIPC');

// Validation schemas
const EmptySchema = z.object({}).optional();

// Gate for boot-time GET_STATE reads. setupAutoUpdateIPC() runs before window
// creation, but initialize() only starts later in the deferred
// secondary-startup task — so an early renderer GET_STATE could otherwise see
// no pending initialization and answer the pre-init default (stable) even
// when local-prefs.json holds a beta preference. The gate settles when the
// boot flow decides the updater's fate:
//   - initializeAutoUpdater() completed (channel loaded from local-prefs;
//     failures settle too and are logged there), or
//   - markAutoUpdaterNotInitialized() declared the updater will never start
//     this run (dev mode / no window) — the default state is the real answer.
let settleChannelLoaded: () => void = () => {};
const channelLoaded = new Promise<void>((resolve) => {
  settleChannelLoaded = resolve;
});

/**
 * Setup auto-update IPC handlers
 */
export function setupAutoUpdateIPC(): void {
  logger.info('Setting up auto-update IPC handlers');

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
      async () => {
        // Answer after the boot flow settles the gate so the read reflects
        // the channel loaded from local-prefs (or the default state when the
        // updater is never initialized). Init errors are already logged by
        // initializeAutoUpdater; fall through to current state.
        await channelLoaded;
        return { success: true, data: autoUpdateService.getState() };
      },
      AUTO_UPDATE_CHANNELS.GET_STATE,
    ),
  );

  // Set update channel
  ipcMain.handle(
    AUTO_UPDATE_CHANNELS.SET_CHANNEL,
    createSafeValidatedHandler(
      SetChannelRequestSchema,
      async (_event, validated) => {
        await autoUpdateService.setChannel(validated.channel);
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
  void autoUpdateService
    .initialize(mainWindow)
    .catch((error) => {
      logger.error('AutoUpdateService initialization failed', error as Error);
    })
    .finally(() => {
      settleChannelLoaded();
    });
}

/**
 * Declare that the auto-updater will not be initialized this run (dev mode or
 * no main window). Unblocks boot-time GET_STATE waiters so they answer the
 * default state instead of waiting on an initialization that never comes.
 */
export function markAutoUpdaterNotInitialized(): void {
  settleChannelLoaded();
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
