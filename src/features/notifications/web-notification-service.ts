/**
 * Web-platform notification helpers behind the settings page's
 * `notification:test` and `notification:requestPermission` bridge
 * (notification-bridge-seeder). Agent-idle notifications on web are shown by
 * the notifications saga, not here.
 *
 * Permission is requested lazily (never at boot); concurrent prompts share
 * one `Notification.requestPermission()` call.
 */
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import type { NotificationContent } from './utils/notification-content';
import { playNotificationSoundPerSettings } from './notification-sound-gate';

const logger = createLogger('WebNotificationService');

/** Log the missing-permission skip once. */
let loggedPermissionSkip = false;
/** In-flight permission prompt, shared so concurrent callers coalesce into
 * ONE `Notification.requestPermission()` call (overlapping prompts throw or
 * misbehave in some browsers). */
let pendingPermissionRequest: Promise<NotificationPermission> | null = null;
/** Strong refs so pending notifications aren't GC'd before click (parity with main). */
const activeNotifications = new Set<Notification>();

/** True when the browser exposes the Notification API (jsdom-safe guard). */
function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && typeof Notification !== 'undefined';
}

/**
 * Resolve notification permission, requesting it lazily on 'default'.
 * Concurrent callers share one in-flight `requestPermission()` prompt.
 * REJECTS when the browser's request itself throws — callers decide whether
 * to fold that to a skip (test notification) or a shaped error (permission
 * request).
 */
async function resolvePermission(): Promise<NotificationPermission> {
  let permission = Notification.permission;
  if (permission === 'default') {
    if (!pendingPermissionRequest) {
      pendingPermissionRequest = Promise.resolve(Notification.requestPermission()).finally(() => {
        pendingPermissionRequest = null;
      });
    }
    permission = await pendingPermissionRequest;
  }
  return permission;
}

/**
 * Resolve notification permission for the notification path. Returns true
 * only when granted. Never rejects; 'denied' and request failures fold to
 * false (logged once).
 */
async function ensurePermission(): Promise<boolean> {
  if (!isNotificationSupported()) {
    if (!loggedPermissionSkip) {
      loggedPermissionSkip = true;
      logger.warn('Browser Notification API is not available; skipping web notifications');
    }
    return false;
  }
  let permission: NotificationPermission;
  try {
    permission = await resolvePermission();
  } catch (error) {
    if (!loggedPermissionSkip) {
      loggedPermissionSkip = true;
      logger.warn('Notification permission request failed', { error });
    }
    return false;
  }
  if (permission !== 'granted') {
    if (!loggedPermissionSkip) {
      loggedPermissionSkip = true;
      logger.info('Notification permission not granted; web notifications disabled', {
        permission,
      });
    }
    return false;
  }
  return true;
}

/**
 * Show a browser notification (permission already granted) and run the sound
 * gate. Clicking focuses the tab.
 */
function showWebNotification(content: NotificationContent): void {
  void playNotificationSoundPerSettings();
  try {
    const notification = new Notification(content.title, { body: content.body });
    activeNotifications.add(notification);
    notification.onclick = () => {
      activeNotifications.delete(notification);
      try {
        window.focus();
      } catch {
        // window.focus() can throw in exotic embeddings.
      }
      notification.close();
    };
    notification.onclose = () => activeNotifications.delete(notification);
    notification.onerror = () => {
      activeNotifications.delete(notification);
      logger.warn('Web notification failed to show', { title: content.title });
    };
  } catch (error) {
    logger.warn('Failed to show web notification', { error });
  }
}

/**
 * Show a test notification (settings-page test button via the
 * `notification:test` bridge). Mirrors the main-process
 * `showTestNotification` payload and `{ success, error? }` envelope.
 */
export async function showTestWebNotification(): Promise<{ success: boolean; error?: string }> {
  try {
    if (!isNotificationSupported()) {
      return {
        success: false,
        error: m.notification_not_supported(),
      };
    }
    const granted = await ensurePermission();
    if (!granted) {
      return { success: false, error: m.notifications_web_permissionNotGranted_error() };
    }
    showWebNotification({
      title: m.notification_specialist_agent(),
      body: m.notification_test_body(),
    });
    return { success: true };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : m.notifications_web_unknown_error();
    logger.error('Failed to show test notification', error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Request browser notification permission (settings-page flow via the
 * `notification:requestPermission` bridge). Envelope parity with the Electron
 * handler: `{ success: true, granted }` / `{ success: false, error }`.
 */
export async function requestWebNotificationPermission(): Promise<{
  success: boolean;
  granted?: boolean;
  error?: string;
}> {
  try {
    if (!isNotificationSupported()) {
      return {
        success: false,
        error: m.notification_not_supported(),
      };
    }
    // resolvePermission (not ensurePermission): a thrown requestPermission
    // must surface as the { success: false, error } arm here — the settings
    // flow reports real failures instead of folding them to granted: false.
    const permission = await resolvePermission();
    return { success: true, granted: permission === 'granted' };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : m.notifications_web_unknown_error(),
    };
  }
}

/** Test-only: reset module state between tests. @internal */
export function __resetWebNotificationServiceForTesting(): void {
  loggedPermissionSkip = false;
  pendingPermissionRequest = null;
  activeNotifications.clear();
}
