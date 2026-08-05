/**
 * Window workspace-state invoke bridge — forwards `window:set-in-workspace`
 * and `window:set-open-workspace-tabs` to the real Electron preload bridge
 * (`window.electronAPI.invoke`) when present.
 *
 * The generated `invoke()` routes ALL legacy renderer invokes through the
 * mock router in every build, including the packaged app. These two channels
 * used to be UNBRIDGED_INVOKE_ALLOWLIST absences, so the main-process
 * handlers in features/system/main/system.ipc.ts never ran and the
 * `windowWorkspaceIds` / `windowOpenWorkspaceTabs` maps stayed empty. That
 * broke every consumer of that window-tracking state: the Window menu,
 * `sendToWorkspaceWindows` (dropped `notification:show`, so no notification
 * sound), and the per-workspace focus gating / click routing used by the
 * app-wide NotificationService.
 *
 * Same pattern as auto-update-bridge-seeder: forward verbatim when the
 * preload bridge exists; resolve undefined when it does not (browser dev /
 * bridge-less build) — every caller is fire-and-forget with `.catch(() => {})`,
 * matching the former allowlist disposition.
 */
import { emitMockIpcEvent, registerMockIpcHandler } from "$shared/ipc-mock-router";
import { IPC_CHANNELS } from "$shared/ipc-registry";

const WINDOW_STATE_INVOKE_CHANNELS = [
  IPC_CHANNELS.WINDOW.SET_IN_WORKSPACE,
  IPC_CHANNELS.WINDOW.SET_OPEN_WORKSPACE_TABS,
] as const;

/** Register the window workspace-state invoke bridge handlers. Idempotent. */
export function registerWindowStateBridge(): void {
  for (const channel of WINDOW_STATE_INVOKE_CHANNELS) {
    // Forward exactly one payload argument — the real preload bridge signature
    // is `invoke(channel, data?)`, so extra args would be silently dropped.
    registerMockIpcHandler(channel, async (payload?: unknown) => {
      const bridge = typeof window !== "undefined" ? window.electronAPI : undefined;
      if (bridge && typeof bridge.invoke === "function") {
        return bridge.invoke(channel, payload);
      }
      return undefined;
    });
  }
}

/**
 * Register the window full-screen invoke bridge handlers (HUD full-screen
 * toggle). Forwards to the real preload bridge when present so the
 * main-process handlers in features/system/main/system.ipc.ts run
 * (`BrowserWindow.setFullScreen` / `isFullScreen`); in browser dev builds it
 * falls back to the DOM Fullscreen API so the toggle still works. Idempotent.
 */
export function registerWindowFullScreenBridge(): void {
  registerMockIpcHandler(IPC_CHANNELS.WINDOW.SET_FULL_SCREEN, async (payload?: unknown) => {
    const bridge = typeof window !== "undefined" ? window.electronAPI : undefined;
    if (bridge && typeof bridge.invoke === "function") {
      return bridge.invoke(IPC_CHANNELS.WINDOW.SET_FULL_SCREEN, payload);
    }
    const wantFullScreen = !!(payload as { fullScreen?: boolean } | undefined)?.fullScreen;
    try {
      if (wantFullScreen) {
        await document.documentElement.requestFullscreen();
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
      return { success: true, fullScreen: !!document.fullscreenElement };
    } catch {
      return { success: false, fullScreen: !!document.fullscreenElement };
    }
  });
  registerMockIpcHandler(IPC_CHANNELS.WINDOW.GET_FULL_SCREEN, async (payload?: unknown) => {
    const bridge = typeof window !== "undefined" ? window.electronAPI : undefined;
    if (bridge && typeof bridge.invoke === "function") {
      return bridge.invoke(IPC_CHANNELS.WINDOW.GET_FULL_SCREEN, payload);
    }
    return {
      success: true,
      fullScreen: typeof document !== "undefined" && !!document.fullscreenElement,
    };
  });
}

/**
 * Relay full-screen state changes onto the mock-router event channel that
 * `listenSync('window:fullscreen')` consumers subscribe to. In Electron the
 * main process sends `window:fullscreen` on every enter/leave-full-screen
 * (including OS gestures) to the real preload bridge; in browser dev builds
 * the DOM `fullscreenchange` event drives the same channel.
 */
export function registerWindowFullScreenEventRelay(): void {
  if (typeof window === "undefined") return;
  const bridge = window.electronAPI;
  if (bridge && typeof bridge.on === "function") {
    bridge.on("window:fullscreen", (fullScreen: boolean) => {
      emitMockIpcEvent("window:fullscreen", fullScreen);
    });
  } else if (typeof document !== "undefined") {
    document.addEventListener("fullscreenchange", () => {
      emitMockIpcEvent("window:fullscreen", !!document.fullscreenElement);
    });
  }
}

registerWindowStateBridge();
registerWindowFullScreenBridge();
registerWindowFullScreenEventRelay();
