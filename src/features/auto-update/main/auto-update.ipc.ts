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
        // Switching TO 'disabled' suppresses all update activity: there is
        // no /disabled feed to check, so skip the post-switch check (and its
        // "Checking…" toast) entirely — setChannel already neutralized any
        // in-flight download or pending artifact. Switching AWAY from
        // 'disabled' falls through and behaves like any other switch.
        if (validated.channel === 'disabled') {
          logger.info('Channel set to disabled; skipping post-switch update check');
          return { success: true };
        }
        // User-initiated channel switch: check the new channel's feed right
        // away with manual-check feedback instead of waiting for the hourly
        // timer. The service broadcasts 'auto-update:show-toast' first so
        // the "Checking…" toast appears immediately and a failed check has
        // a visible surface (mirroring the menu sites). Only user actions
        // reach this handler — initialize()'s internal setChannel call never
        // does, so startup keeps its single delayed check. If a
        // startup/periodic/focus check is already in flight against the
        // previous feed, the service queues one fresh check for when it
        // settles, so the new channel is always actually queried;
        // available/downloading/downloaded states — whether current or
        // settled into by that old-feed check — cancel/neutralize the
        // old-feed artifact and recheck the new feed
        // (intent-hq/monorepo#2270), and an uninitialized service (dev
        // mode) skips both check and toast.
        // Fire-and-forget: a slow check must not delay or fail the SET_CHANNEL ack, which the
        // renderer awaits to confirm the switch (check errors are reported
        // via the broadcast error status, not a rejection — the catch is
        // defense-in-depth only).
        void autoUpdateService.checkForUpdatesOnChannelSwitch().catch((error) => {
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
