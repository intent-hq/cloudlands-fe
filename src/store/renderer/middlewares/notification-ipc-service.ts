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
 *     null/missing payloads.
 *
 * Dependency-light per src/store/renderer/AGENTS.md: state is read directly
 * off `appStore.state` (no selector modules) and the sound util is imported
 * lazily like the deleted saga did.
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { goto } from "$app/navigation";
import { store as appStore } from "$store/renderer/store";
import type { StoreState } from "../types";
import { isElectron } from "$lib/electron-bridge";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("NotificationIpcService");

/** Payload of `notification:show` (see notification.service.ts in main). */
interface NotificationShowEvent {
  title?: string;
  body?: string;
  timestamp?: string;
}

/** Payload of `notification:navigate` (sent on notification click). */
interface NotificationNavigateEvent {
  workspaceId?: string;
}

async function handleNotificationShow(_data?: NotificationShowEvent): Promise<void> {
  const state = appStore.state as StoreState;
  const { soundEnabled, soundOnlyWhenUnfocused, volume } = state.userPreferences;

  if (!soundEnabled) {
    return;
  }
  if (soundOnlyWhenUnfocused && document.hasFocus()) {
    return;
  }

  try {
    const { playNotificationSound } = await import("$lib/utils/notification-sound");
    await playNotificationSound(volume);
  } catch (error) {
    // Sound is best-effort — never let playback failures propagate.
    logger.warn("Failed to play notification sound", { error });
  }
}

async function handleNotificationNavigate(data?: NotificationNavigateEvent): Promise<void> {
  if (!data?.workspaceId) {
    return;
  }

  try {
    await goto(`/workspace/${data.workspaceId}`);
  } catch (error) {
    logger.warn("Failed to navigate from notification click", {
      workspaceId: data.workspaceId,
      error,
    });
  }
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
