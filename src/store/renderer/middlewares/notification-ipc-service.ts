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
 *     document focused = no sound; else play at `volume`). When the payload
 *     carries a `navigateTarget` (main suppressed the OS banner because the
 *     app was frontmost — electron#51885: foreground banner clicks never
 *     fire), also show a clickable in-app toast that routes through the same
 *     `handleNotificationNavigate` as a native notification click.
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
import {
  handleNotificationNavigate,
  type NotificationNavigatePayload,
} from "$features/notifications/notification-navigation";
import { playNotificationSoundPerSettings } from "$features/notifications/notification-sound-gate";
import { m } from "$shared/paraglide/messages.js";

/** Payload of `notification:show` (see notification.service.ts in main). */
interface NotificationShowEvent {
  title?: string;
  body?: string;
  timestamp?: string;
  /**
   * Present only when the main process suppressed the OS banner because the
   * app was frontmost (electron#51885) — the renderer shows a clickable
   * in-app toast instead. Absent for sound-only and banner-accompanying
   * events.
   */
  navigateTarget?: NotificationNavigatePayload;
}

async function handleNotificationShow(data?: NotificationShowEvent): Promise<void> {
  await playNotificationSoundPerSettings();
  if (data?.navigateTarget) {
    await showNavigateToast(data, data.navigateTarget);
  }
}

/**
 * In-app replacement for the suppressed frontmost OS banner: a toast with the
 * notification title/body whose "Open" action routes through the shared
 * `handleNotificationNavigate` (same routing as `notification:navigate`,
 * including the chief → Assistant panel case) and dismisses.
 *
 * When a micro is connected AND the target workspace resolves to a key slot,
 * the toast renders through a custom component that carries the slot square
 * (a plain `toast(...)` cannot); otherwise the plain toast is unchanged. Both
 * the resolver and the component are lazy-imported per middleware
 * conventions. The badge path is best-effort: any failure in it (resolver
 * import/resolution, custom component import/render) falls back to the plain
 * toast — only a missing toast lib drops the toast entirely.
 */
async function showNavigateToast(
  data: NotificationShowEvent,
  navigateTarget: NotificationNavigatePayload,
): Promise<void> {
  let toast: (typeof import("svelte-sonner"))["toast"];
  try {
    ({ toast } = await import("svelte-sonner"));
  } catch {
    // Toast not available - not critical
    return;
  }

  const showPlainToast = () => {
    toast(data.title ?? data.body ?? "", {
      description: data.title ? data.body : undefined,
      action: {
        label: m.notifications_toast_open_label(),
        onClick: () => void handleNotificationNavigate(navigateTarget),
      },
    });
  };

  try {
    const { resolveConnectedWorkspaceKeySlot } = await import(
      "$features/hardware-console/assignment/connected-key-slot"
    );
    const keySlot = resolveConnectedWorkspaceKeySlot(navigateTarget.workspaceId);
    if (keySlot === null) {
      showPlainToast();
      return;
    }
    const { default: NotificationNavigateToast } = await import(
      "$lib/components/ui/toast/NotificationNavigateToast.svelte"
    );
    let toastId: string | number | undefined;
    toastId = toast.custom(NotificationNavigateToast, {
      componentProps: {
        title: data.title ?? data.body ?? "",
        description: data.title ? data.body : undefined,
        keySlot,
        actionLabel: m.notifications_toast_open_label(),
        onAction: () => {
          if (toastId !== undefined) toast.dismiss(toastId);
          void handleNotificationNavigate(navigateTarget);
        },
      },
    });
  } catch {
    // Badge path failed - degrade to the badge-less plain toast
    try {
      showPlainToast();
    } catch {
      // Toast not available - not critical
    }
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
