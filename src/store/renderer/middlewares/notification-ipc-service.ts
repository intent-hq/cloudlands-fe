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
 *     `handleNotificationNavigate` as a native notification click. The toast
 *     is suppressed only when THIS window is both focused
 *     (`document.hasFocus()`) AND already viewing the target workspace's
 *     route (`isViewingWorkspace`) — the user is looking at the workspace
 *     the notification is about, so there is nothing to open. The focus
 *     check matters because `notification:show` is broadcast to every
 *     window/tab with the workspace open (main's `sendToWorkspaceWindows`):
 *     without it, a backgrounded window merely parked on the workspace route
 *     would wrongly swallow its own toast even while some other window is
 *     frontmost and would otherwise show nothing (web-notification-service
 *     parity: "Focused tab is viewing the workspace, suppressing banner").
 *     Chief-of-staff payloads have no visible workspace route, so they are
 *     never suppressed. The sound gate runs regardless — it stays the single
 *     sound decision point.
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
import { isViewingWorkspace } from "$features/workspace/mark-workspace-seen";
import { CHIEF_WORKSPACE_ID } from "$shared/types/branded-ids";
import { m } from "$shared/paraglide/messages.js";

/**
 * Structured content parts of `notification:show` (see notification.service.ts
 * in main). Present only for non-chief agent-idle notifications; passed
 * through to the custom toast for the three-line layout.
 */
interface NotificationStructuredContent {
  /** Emitting agent id — seeds the deterministic auggie avatar colors. */
  agentId?: string;
  /** Untruncated workspace title (the renderer truncates via CSS). */
  workspaceTitle?: string;
  /** Raw specialist id, e.g. "spec-writer". */
  specialist?: string;
  /** Localized specialist display name, e.g. "Coordinator". */
  specialistDisplayName: string;
  taskTitle?: string;
  /** ACP provider id (auggie, claude-code, codex, ...). */
  provider?: string;
}

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
  /** Structured parts for the custom toast; absent for chief / old daemons. */
  structured?: NotificationStructuredContent;
}

/**
 * True when the toast would only point at the page already on screen in THIS
 * window: the window is focused AND its route is the target workspace (or a
 * subroute of it). The focus check matters because `notification:show` is
 * broadcast to every window/tab with the workspace open — an unfocused
 * window parked on the workspace route must still show its toast, since no
 * other (focused) window is guaranteed to be viewing that workspace.
 * Chief-of-staff payloads are exempt — the chief workspace page is hidden, so
 * its toast routes to the sidebar Assistant panel and always stays useful.
 */
function isToastRedundant(navigateTarget: NotificationNavigatePayload): boolean {
  const { workspaceId } = navigateTarget;
  if (!workspaceId) return false;
  if (navigateTarget.chief === true || workspaceId === CHIEF_WORKSPACE_ID) return false;
  return document.hasFocus() && isViewingWorkspace(workspaceId);
}

async function handleNotificationShow(data?: NotificationShowEvent): Promise<void> {
  await playNotificationSoundPerSettings();
  if (data?.navigateTarget && !isToastRedundant(data.navigateTarget)) {
    await showNavigateToast(data, data.navigateTarget);
  }
}

/**
 * In-app replacement for the suppressed frontmost OS banner: a toast with the
 * notification title/body whose "Open" action routes through the shared
 * `handleNotificationNavigate` (same routing as `notification:navigate`,
 * including the chief → Assistant panel case) and dismisses.
 *
 * When the payload carries `structured` content OR the target workspace
 * resolves to a connected-micro key slot, the toast renders through a custom
 * component that carries the three-line layout and/or the slot square (a
 * plain `toast(...)` cannot); only when both are absent is the plain toast
 * used. Both the resolver and the component are lazy-imported per middleware
 * conventions. Key-slot resolution is best-effort: a resolver import or
 * resolution failure degrades to a slot-less custom toast when `structured`
 * is present (plain toast otherwise) — a custom component import/render
 * failure falls back to the plain toast, and only a missing toast lib drops
 * the toast entirely.
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
    let keySlot: number | null = null;
    try {
      const { resolveConnectedWorkspaceKeySlot } = await import(
        "$features/hardware-console/assignment/connected-key-slot"
      );
      keySlot = resolveConnectedWorkspaceKeySlot(navigateTarget.workspaceId);
    } catch {
      // Slot resolution is best-effort - render without the slot square
    }
    if (keySlot === null && !data.structured) {
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
        structured: data.structured,
        actionLabel: m.notifications_toast_open_label(),
        onAction: () => {
          if (toastId !== undefined) toast.dismiss(toastId);
          void handleNotificationNavigate(navigateTarget);
        },
      },
    });
  } catch {
    // Custom toast path failed - degrade to the plain toast
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
