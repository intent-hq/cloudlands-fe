/**
 * Notification invoke bridge — routes the legacy `notification:test` /
 * `notification:requestPermission` invoke channels per platform:
 *
 *   - web: to the web-platform notification substitute
 *     (`$features/notifications/web-notification-service`), so the settings
 *     test-notification flow shows a browser Notification and the permission
 *     request drives the browser permission prompt.
 *   - electron: forwarded verbatim to the real preload bridge
 *     (`window.electronAPI.invoke`) — both channels are in the preload
 *     invoke allowlist and handled by `setupNotificationIPC()` in main.
 *
 * Envelope parity: both platforms return the Electron handler shapes —
 * `{ success, error? }` for test, `{ success, granted?, error? }` for
 * requestPermission — so callers never branch per platform. Bridge-less
 * non-web builds fold to a shaped not-available failure (auto-update-bridge
 * seeder idiom).
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { getPlatform } from '$lib/utils/platform-capabilities';
import {
  requestWebNotificationPermission,
  showTestWebNotification,
} from '$features/notifications/web-notification-service';

const NOT_AVAILABLE = {
  success: false,
  error: 'Notifications are not available in this build',
} as const;

/** Register the notification invoke bridge handlers. Idempotent. */
export function registerNotificationBridge(): void {
  registerMockIpcHandler(IPC_CHANNELS.NOTIFICATION.TEST, async () => {
    if (getPlatform() === 'web') {
      return showTestWebNotification();
    }
    const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (bridge && typeof bridge.invoke === 'function') {
      return bridge.invoke(IPC_CHANNELS.NOTIFICATION.TEST);
    }
    return NOT_AVAILABLE;
  });

  registerMockIpcHandler(IPC_CHANNELS.NOTIFICATION.REQUEST_PERMISSION, async () => {
    if (getPlatform() === 'web') {
      return requestWebNotificationPermission();
    }
    const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (bridge && typeof bridge.invoke === 'function') {
      return bridge.invoke(IPC_CHANNELS.NOTIFICATION.REQUEST_PERMISSION);
    }
    return NOT_AVAILABLE;
  });
}

registerNotificationBridge();
