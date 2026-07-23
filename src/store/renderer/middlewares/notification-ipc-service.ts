/**
 * Notification IPC service — restores the renderer halves of the deleted
 * `ui-notifications/sagas/ui-notifications-saga.ts` (removed with the saga
 * runtime in 95d908a2 without re-homing). With no listener, the main-process
 * NotificationService's `notification:show` never played a sound and
 * `notification:navigate` (notification click) focused the window but never
 * navigated to the emitting workspace.
 *
 * This reconnects both paths WITHOUT re-adding a saga, following the
 * zoom-sync-service pattern: on middleware creation it registers window IPC
 * listeners for the two preload-allowed channels:
 *   - `notification:show` → play the notification sound, honoring the sound
 *     settings (`soundEnabled` off = no sound; `soundOnlyWhenUnfocused` on +
 *     document focused = no sound; else play at `volume`).
 *   - `notification:navigate` → `goto(/workspace/{workspaceId})`, guarding
 *     null/missing payloads. Chief-of-staff payloads (`chief: true` or the
 *     chief virtual workspace id) open the sidebar Assistant panel and select
 *     the chat thread instead — the chief workspace page is hidden.
 *
 * The sound gate and click-navigation routing are shared with the
 * web-platform substitute (`$features/notifications/web-notification-service`)
 * via `notification-sound-gate.ts` / `notification-navigation.ts` — extracted
 * verbatim from this module so both delivery paths behave identically.
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { isElectron } from "$lib/electron-bridge";
import { handleNotificationNavigate } from "$features/notifications/notification-navigation";
import { playNotificationSoundPerSettings } from "$features/notifications/notification-sound-gate";

/** Payload of `notification:show` (see notification.service.ts in main). */
interface NotificationShowEvent {
  title?: string;
  body?: string;
  timestamp?: string;
}

async function handleNotificationShow(_data?: NotificationShowEvent): Promise<void> {
  await playNotificationSoundPerSettings();
}

export function createNotificationIpcMiddleware(): StoreMiddleware {
  return () => {
    // Register the listeners once on middleware creation
    if (isElectron() && typeof window !== "undefined" && window.electronAPI?.on) {
      // Handlers are async but never reject (errors are caught and logged),
      // so registering them directly is safe — and lets tests await them.
      window.electronAPI.on("notification:show", handleNotificationShow);
      window.electronAPI.on("notification:navigate", handleNotificationNavigate);
      // Note: No cleanup is performed. The listeners persist for the lifetime
      // of the renderer process (same as zoom-sync-service).
    }

    return (next) => (action) => {
      return next(action);
    };
  };
}
