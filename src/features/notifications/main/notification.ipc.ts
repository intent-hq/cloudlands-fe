/**
 * Notification IPC Handlers
 *
 * Provides IPC handlers for notification-related operations.
 */

import { ipcMain } from 'electron';
import { Logger } from '../../../shared/logger';
import { NOTIFICATION_CHANNELS } from '../../../shared/ipc/channels';
import { getNotificationService } from './notification.service';

const logger = new Logger('NotificationIPC');

/**
 * Setup notification IPC handlers
 */
export function setupNotificationIPC(): void {
  logger.info('Setting up notification IPC handlers');

  // Test notification handler
  ipcMain.handle(NOTIFICATION_CHANNELS.TEST, async () => {
    try {
      const service = getNotificationService();
      const result = service.showTestNotification();

      if (result.success) {
        logger.info('Test notification triggered successfully');
      } else {
        logger.warn('Test notification may have failed:', result.error);
      }

      return result;
    } catch (error) {
      logger.error('Failed to show test notification', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Request permission handler (for future macOS permissions)
  ipcMain.handle(NOTIFICATION_CHANNELS.REQUEST_PERMISSION, async () => {
    try {
      // On macOS, we might need to request notification permissions
      // For now, this is a placeholder for future implementation
      logger.info('Notification permission requested');
      return { success: true, granted: true };
    } catch (error) {
      logger.error('Failed to request notification permission', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
