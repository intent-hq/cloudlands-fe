/** Browser Notification helpers used by the platform bridge. */
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { playNotificationSoundPerSettings } from './notification-sound-gate';

const logger = createLogger('WebNotificationService');
let loggedPermissionSkip = false;
let pendingPermissionRequest: Promise<NotificationPermission> | null = null;
const activeNotifications = new Set<Notification>();

function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && typeof Notification !== 'undefined';
}

async function resolvePermission(): Promise<NotificationPermission> {
  let permission = Notification.permission;
  if (permission === 'default') {
    pendingPermissionRequest ??= Promise.resolve(Notification.requestPermission()).finally(() => {
      pendingPermissionRequest = null;
    });
    permission = await pendingPermissionRequest;
  }
  return permission;
}

async function ensurePermission(): Promise<boolean> {
  if (!isNotificationSupported()) {
    if (!loggedPermissionSkip)
      logger.warn('Browser Notification API is not available; skipping web notifications');
    loggedPermissionSkip = true;
    return false;
  }
  try {
    const permission = await resolvePermission();
    if (permission === 'granted') return true;
    if (!loggedPermissionSkip)
      logger.info('Notification permission not granted; web notifications disabled', {
        permission,
      });
  } catch (error) {
    if (!loggedPermissionSkip) logger.warn('Notification permission request failed', { error });
  }
  loggedPermissionSkip = true;
  return false;
}

async function showTestBrowserNotification(): Promise<void> {
  void playNotificationSoundPerSettings();
  const notification = new Notification(m.notification_specialist_agent(), {
    body: m.notification_test_body(),
  });
  activeNotifications.add(notification);
  notification.onclose = () => activeNotifications.delete(notification);
  notification.onerror = () => {
    activeNotifications.delete(notification);
    logger.warn('Web notification failed to show', { title: m.notification_specialist_agent() });
  };
}

export async function showTestWebNotification(): Promise<{ success: boolean; error?: string }> {
  try {
    if (!isNotificationSupported()) {
      return { success: false, error: m.notification_not_supported() };
    }
    if (!(await ensurePermission())) {
      return { success: false, error: m.notifications_web_permissionNotGranted_error() };
    }
    await showTestBrowserNotification();
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : m.notifications_web_unknown_error();
    logger.error('Failed to show test notification', error);
    return { success: false, error: message };
  }
}

export async function requestWebNotificationPermission(): Promise<{
  success: boolean;
  granted?: boolean;
  error?: string;
}> {
  try {
    if (!isNotificationSupported()) {
      return { success: false, error: m.notification_not_supported() };
    }
    return { success: true, granted: (await resolvePermission()) === 'granted' };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : m.notifications_web_unknown_error(),
    };
  }
}

/** Test-only reset for permission and strong-reference state. @internal */
export function __resetWebNotificationServiceForTesting(): void {
  loggedPermissionSkip = false;
  pendingPermissionRequest = null;
  activeNotifications.clear();
}
