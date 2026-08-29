/**
 * Window workspace-state invoke bridge — forwards `window:set-in-workspace`,
 * `window:set-open-workspace-tabs`, `window:set-theme`, `window:set-title`,
 * `window:set-browser-focused`, and `window:set-dock-pointer-region` to the real Electron preload bridge
 * (`window.electronAPI.invoke`) when present.
 *
 * The generated `invoke()` routes ALL legacy renderer invokes through the
 * mock router in every build, including the packaged app. The workspace-state
 * channels used to be UNBRIDGED_INVOKE_ALLOWLIST absences, so the main-process
 * handlers in features/system/main/system.ipc.ts never ran and the
 * `windowWorkspaceIds` / `windowOpenWorkspaceTabs` maps stayed empty. That
 * broke every consumer of that window-tracking state: the Window menu,
 * `sendToWorkspaceWindows` (dropped `notification:show`, so no notification
 * sound), and the per-workspace focus gating / click routing used by the
 * app-wide NotificationService.
 *
 * `window:set-theme` (intent-hq/monorepo#2746) is invoked saga-style by
 * theme-saga's `syncWindowTheme` and was never bridged, so the main-process
 * handler (nativeTheme.themeSource + window background color) was unreachable
 * and startup logged `UnbridgedMockIpcChannelError: window:set-theme`.
 *
 * `window:set-title` / `window:set-browser-focused` / `app:get-version`
 * (intent-hq/monorepo#2927, same defect class) were allowlisted absences with
 * a justification written for the bridge-less web build — but the packaged
 * app HAS live main-process handlers for all three in system.ipc.ts, so the
 * swallow meant the native window title never updated (WindowTitleBar) and
 * main never learned browser-panel focus for menu-shortcut gating
 * (PanelLayout via browser-focus-ownership.ts).
 *
 * Same pattern as auto-update-bridge-seeder: forward verbatim when the
 * preload bridge exists; resolve undefined when it does not (browser dev /
 * bridge-less build) — every caller is fire-and-forget or try/catch-guarded,
 * matching the former allowlist disposition.
 */
import { emitMockIpcEvent, registerMockIpcHandler } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';

const WINDOW_STATE_INVOKE_CHANNELS = [
  IPC_CHANNELS.WINDOW.SET_IN_WORKSPACE,
  IPC_CHANNELS.WINDOW.SET_OPEN_WORKSPACE_TABS,
  IPC_CHANNELS.WINDOW.SET_THEME,
  IPC_CHANNELS.WINDOW.SET_TITLE,
  IPC_CHANNELS.WINDOW.SET_BROWSER_FOCUSED,
  IPC_CHANNELS.WINDOW.SET_DOCK_POINTER_REGION,
] as const;

/** Forward the selected app theme to Electron's registered main-process handler. */
export function registerWindowThemeBridge(): void {
  registerMockIpcHandler(IPC_CHANNELS.WINDOW.SET_THEME, async (payload?: unknown) => {
    const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (bridge && typeof bridge.invoke === 'function') {
      return bridge.invoke(IPC_CHANNELS.WINDOW.SET_THEME, payload);
    }
    return undefined;
  });
}

/** Register the window workspace-state invoke bridge handlers. Idempotent. */
export function registerWindowStateBridge(): void {
  for (const channel of WINDOW_STATE_INVOKE_CHANNELS) {
    // Forward exactly one payload argument — the real preload bridge signature
    // is `invoke(channel, data?)`, so extra args would be silently dropped.
    registerMockIpcHandler(channel, async (payload?: unknown) => {
      const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
      if (bridge && typeof bridge.invoke === 'function') {
        return bridge.invoke(channel, payload);
      }
      if (channel === IPC_CHANNELS.WINDOW.SET_DOCK_POINTER_REGION) {
        return { success: false, supported: false };
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
    const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (bridge && typeof bridge.invoke === 'function') {
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
    const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (bridge && typeof bridge.invoke === 'function') {
      return bridge.invoke(IPC_CHANNELS.WINDOW.GET_FULL_SCREEN, payload);
    }
    return {
      success: true,
      fullScreen: typeof document !== 'undefined' && !!document.fullscreenElement,
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
  if (typeof window === 'undefined') return;
  const bridge = window.electronAPI;
  if (bridge && typeof bridge.on === 'function') {
    bridge.on('window:fullscreen', (fullScreen: boolean) => {
      emitMockIpcEvent('window:fullscreen', fullScreen);
    });
  } else if (typeof document !== 'undefined') {
    document.addEventListener('fullscreenchange', () => {
      emitMockIpcEvent('window:fullscreen', !!document.fullscreenElement);
    });
  }
}

/**
 * Forward the Electron app-version read (`app:get-version`) to the registered
 * main-process handler (system.ipc.ts, `app.getVersion()`). No production
 * renderer caller remains today (the analytics common-properties reader was
 * retired in the open-source scrub), but the main handler and preload
 * allowlist entry are live, so any future routed caller gets the real version
 * instead of an allowlisted-absence swallow (intent-hq/monorepo#2927).
 * Resolves undefined without a bridge (browser dev build). Idempotent.
 */
export function registerAppVersionBridge(): void {
  registerMockIpcHandler(IPC_CHANNELS.APP.GET_VERSION, async (payload?: unknown) => {
    const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (bridge && typeof bridge.invoke === 'function') {
      return bridge.invoke(IPC_CHANNELS.APP.GET_VERSION, payload);
    }
    return undefined;
  });
}

registerWindowStateBridge();
registerWindowThemeBridge();
registerWindowFullScreenBridge();
registerWindowFullScreenEventRelay();
registerAppVersionBridge();
