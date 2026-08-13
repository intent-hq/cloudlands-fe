/**
 * Auto-Update IPC Handlers
 *
 * Provides IPC handlers for auto-update operations.
 * Bridges the auto-update service with the renderer process.
 */

import { ipcMain } from 'electron';
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
//   - setupAutoUpdateIPC() settles it at registration in development (the
//     updater never initializes in dev — the default state is the answer),
//   - initializeAutoUpdater() completed (channel loaded from local-prefs;
//     failures settle too and are logged there), or
//   - markAutoUpdaterNotInitialized() declared the updater will never start
//     this run (no window) — the default state is the real answer.
let settleChannelLoaded: () => void = () => {};
const channelLoaded = new Promise<void>((resolve) => {
  settleChannelLoaded = resolve;
});

/**
 * Setup auto-update IPC handlers
 */
export function setupAutoUpdateIPC(): void {
  logger.info('Setting up auto-update IPC handlers');

  // Dev bypass: the updater is never initialized in development, so settle
  // the gate at registration — GET_STATE must not wait on the deferred
  // secondary-startup task for an initialization that will never come.
  if (process.env.NODE_ENV === 'development') {
    settleChannelLoaded();
  }

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
        // User-initiated channel switch: check the new channel's feed right
        // away with manual-check feedback (checking → up-to-date /
        // update-available toast) instead of waiting for the hourly timer.
        // Only user actions reach this handler — initialize()'s internal
        // setChannel call never does, so startup keeps its single delayed
        // check. checkForUpdatesManual() itself skips the check while a
        // download is in progress or already complete. Fire-and-forget: a
        // slow or failed check must not delay or fail the SET_CHANNEL ack,
        // which the renderer awaits to confirm the switch.
        void autoUpdateService.checkForUpdatesManual().catch((error) => {
          logger.debug('Post-channel-switch update check failed', {
            error: (error as Error).message,
          });
        });
        return { success: true };
      },
      AUTO_UPDATE_CHANNELS.SET_CHANNEL,
    ),
  );

  logger.info('Auto-update IPC handlers registered');
}

/**
 * Initialize the auto-updater. Initialization does not depend on
 * window-creation timing (intent-hq/monorepo#1848): the deferred
 * secondary-startup task can run before any window exists, and renderer
 * notifications are broadcast to whatever windows are live at send time.
 */
export function initializeAutoUpdater(): void {
  void autoUpdateService
    .initialize()
    .catch((error) => {
      logger.error('AutoUpdateService initialization failed', error as Error);
    })
    .finally(() => {
      settleChannelLoaded();
    });
}

/**
 * Declare that the auto-updater will not be initialized this run (dev mode).
 * Unblocks boot-time GET_STATE waiters so they answer the default state
 * instead of waiting on an initialization that never comes.
 */
export function markAutoUpdaterNotInitialized(): void {
  settleChannelLoaded();
}

/**
 * Cleanup auto-updater resources
 * Call this when the app is quitting
 */
export function cleanupAutoUpdater(): void {
  autoUpdateService.cleanup();
}
