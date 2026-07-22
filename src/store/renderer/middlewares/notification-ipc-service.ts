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
 *   - `system:memory-pressure` → surface a toast on memory pressure level
 *     transitions so users see why background watchers and idle agents paused.
 *
 * Dependency-light per src/store/renderer/AGENTS.md: state is read directly
 * off `appStore.state` (no selector modules) and the sound util is imported
 * lazily like the deleted saga did.
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { navigateToRoute } from "$lib/utils/navigation.client";
import { store as appStore } from "$store/renderer/store";
import type { StoreState } from "../types";
import { isElectron } from "$lib/electron-bridge";
import { createLogger } from "$lib/utils/client-logger";
import { CHIEF_WORKSPACE_ID } from "$shared/types/branded-ids";
import {
  openPanel,
  setChiefActiveAgentId,
} from "$store/renderer/slices/sidebar-nav/sidebar-nav-slice";

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
  /** Set for chief-of-staff completions — route to the sidebar Assistant panel. */
  chief?: boolean;
  /** Chief chat thread (agent) to select in the Assistant panel. */
  agentId?: string;
}

/** Payload of `system:memory-pressure` (sent on pressure level transitions). */
interface MemoryPressureEvent {
  level?: "normal" | "warning" | "critical";
  previousLevel?: "normal" | "warning" | "critical";
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

  // Chief-of-staff completions: never navigate to the hidden chief workspace
  // page — open the sidebar Assistant panel and select the chat thread.
  if (data.chief === true || data.workspaceId === CHIEF_WORKSPACE_ID) {
    try {
      if (data.agentId) {
        appStore.dispatch(setChiefActiveAgentId(data.agentId));
      }
      appStore.dispatch(openPanel("chief"));
    } catch (error) {
      logger.warn("Failed to open Assistant panel from notification click", { error });
    }
    return;
  }

  try {
    await navigateToRoute(`/workspace/${data.workspaceId}`);
  } catch (error) {
    logger.warn("Failed to navigate from notification click", {
      workspaceId: data.workspaceId,
      error,
    });
  }
}

async function handleMemoryPressure(data?: MemoryPressureEvent): Promise<void> {
  try {
    const { toast } = await import("svelte-sonner");
    if (data?.level === "critical") {
      toast.error("App is low on memory", {
        description:
          "Background file watchers and idle agents are paused to recover. Active agents keep running. Closing unused workspaces helps.",
        duration: 8000,
        id: "memory-pressure",
      });
    } else if (data?.level === "warning") {
      toast.warning("Memory usage is high", {
        description: "Background work may slow down. Closing unused workspaces can help.",
        duration: 6000,
        id: "memory-pressure",
      });
    } else if (data?.level === "normal" && data.previousLevel && data.previousLevel !== "normal") {
      toast.success("Memory pressure cleared", {
        description: "Background watchers and agents will resume on demand.",
        duration: 4000,
        id: "memory-pressure",
      });
    }
  } catch (error) {
    // Toasts are best-effort — never let UI notification failures propagate.
    logger.warn("Failed to show memory pressure toast", { error });
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
      window.electronAPI.on("system:memory-pressure", handleMemoryPressure);
      // Note: No cleanup is performed. The listeners persist for the lifetime
      // of the renderer process (same as zoom-sync-service).
    }

    return (next) => (action) => {
      return next(action);
    };
  };
}
