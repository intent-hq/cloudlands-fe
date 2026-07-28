/**
 * Menu IPC service — restores the renderer halves of the deleted
 * `app-layout/sagas/app-layout-saga.ts` menu/navigation watchers (removed with
 * the saga runtime in 95d908a2 without re-homing). With no listener, every
 * menu bar action the main process forwards over IPC (Settings..., New
 * Workspace, Open Recent, New Agent/Note/Terminal/Browser, Close Tab, Reopen
 * Closed Tab, Select Previous/Next Tab, browser zoom) was a silent no-op.
 *
 * This reconnects the paths WITHOUT re-adding a saga, following the
 * notification-ipc-service pattern: on middleware creation it registers window
 * IPC listeners for the preload-allowed channels:
 *   - `navigate` (path string) → `/?create=true` / `/workspace/new` open the
 *     create-workspace modal; anything else goes through SvelteKit `goto`.
 *   - `menu:new-agent` → new terminal event when focus is in a terminal,
 *     else `createAgentRequested`.
 *   - `menu:new-note` / `menu:new-terminal` / `menu:new-browser` → dispatch
 *     the matching create trigger / open a browser tab.
 *   - `menu:close-tab` / `menu:reopen-closed-tab` /
 *     `menu:select-previous-tab` / `menu:select-next-tab` → dispatch the
 *     matching panel-layout action.
 *   - `menu:zoom-in` / `menu:zoom-out` / `menu:reset-zoom` → dispatch
 *     `browserTabZoomRequested` when the focused panel's active tab is a
 *     browser tab, else no-op.
 * All `menu:*` handlers no-op when there is no active workspace.
 *
 * Dependency-light per src/store/renderer/AGENTS.md: no selector imports —
 * reads `appStore.state` directly.
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { store as appStore } from "$store/renderer/store";
import { isElectron } from "$lib/electron-bridge";
import { navigateToRoute } from "$lib/utils/navigation.client";
import { isFocusInTerminal } from "$lib/utils/keyboardShortcuts";
import { dispatchWindowEvent } from "$lib/utils/window-events";
import { createLogger } from "$lib/utils/client-logger";
import { setShowCreateModal } from "../slices/sidebar-nav/sidebar-nav-slice";
import { createAgentRequested } from "../slices/workspace-agents/workspace-agents-slice";
import { createNoteRequested } from "../slices/note-read-tracking/note-read-tracking-slice";
import { createTerminalRequested } from "../slices/terminals/terminals-slice";
import {
  openTab,
  closeActiveTab,
  reopenClosedTab,
  selectPreviousTab,
  selectNextTab,
} from "../slices/panel-layout/panel-layout-slice";
import { browserTabZoomRequested } from "../slices/browser/browser-slice";
import type { BrowserZoomAction } from "../slices/browser/browser-types";

const logger = createLogger("MenuIpcService");

/** Minimal structural view of the state slices this service reads directly. */
interface MenuStateSlice {
  workspace?: { activeWorkspaceId?: string | null };
  panelLayout?: {
    byWorkspaceId?: Record<
      string,
      {
        focusedPanelId: string | null;
        panels: Record<
          string,
          { activeTabId: string | null; tabs: Array<{ id: string; type: string }> }
        >;
      }
    >;
  };
}

function getState(): MenuStateSlice {
  return appStore.state as unknown as MenuStateSlice;
}

function getActiveWorkspaceId(): string | null {
  const wsId = getState().workspace?.activeWorkspaceId;
  return typeof wsId === "string" && wsId.length > 0 ? wsId : null;
}

async function handleNavigate(path?: string | null): Promise<void> {
  if (typeof path !== "string" || path.length === 0) {
    return;
  }
  if (path === "/?create=true" || path === "/workspace/new") {
    appStore.dispatch(setShowCreateModal(true));
    return;
  }
  try {
    await navigateToRoute(path);
  } catch (error) {
    logger.warn("Failed to navigate from menu IPC", { path, error });
  }
}

function handleMenuNewAgent(): void {
  const wsId = getActiveWorkspaceId();
  if (!wsId) return;
  if (isFocusInTerminal()) {
    dispatchWindowEvent("workspace:new-terminal", { workspaceId: wsId });
    return;
  }
  appStore.dispatch(createAgentRequested(wsId));
}

/** Dispatch a workspace-scoped action for the active workspace, or no-op. */
function withActiveWorkspace(makeAction: (wsId: string) => unknown): () => void {
  return () => {
    const wsId = getActiveWorkspaceId();
    if (!wsId) return;
    appStore.dispatch(makeAction(wsId));
  };
}

function handleMenuNewBrowser(): void {
  const wsId = getActiveWorkspaceId();
  if (!wsId) return;
  appStore.dispatch(
    openTab(wsId, {
      type: "browser",
      title: "Browser",
      browserUrl: "https://google.com",
      closable: true,
    }),
  );
}

/** Zoom the focused panel's active browser tab; no-op for non-browser tabs. */
function handleMenuZoom(zoom: BrowserZoomAction): void {
  const wsId = getActiveWorkspaceId();
  if (!wsId) return;
  const ws = getState().panelLayout?.byWorkspaceId?.[wsId];
  if (!ws?.focusedPanelId) return;
  const panel = ws.panels?.[ws.focusedPanelId];
  if (!panel?.activeTabId) return;
  const activeTab = panel.tabs.find((tab) => tab.id === panel.activeTabId);
  if (!activeTab || activeTab.type !== "browser") return;
  appStore.dispatch(browserTabZoomRequested(wsId, activeTab.id, zoom));
}

export function createMenuIpcMiddleware(): StoreMiddleware {
  return () => {
    // Register the listeners once on middleware creation
    if (isElectron() && typeof window !== "undefined" && window.electronAPI?.on) {
      window.electronAPI.on("navigate", handleNavigate);
      window.electronAPI.on("menu:new-agent", handleMenuNewAgent);
      window.electronAPI.on("menu:new-note", withActiveWorkspace(createNoteRequested));
      window.electronAPI.on("menu:new-terminal", withActiveWorkspace(createTerminalRequested));
      window.electronAPI.on("menu:new-browser", handleMenuNewBrowser);
      window.electronAPI.on("menu:close-tab", withActiveWorkspace((wsId) => closeActiveTab(wsId)));
      window.electronAPI.on("menu:reopen-closed-tab", withActiveWorkspace((wsId) => reopenClosedTab(wsId)));
      window.electronAPI.on("menu:select-previous-tab", withActiveWorkspace((wsId) => selectPreviousTab(wsId)));
      window.electronAPI.on("menu:select-next-tab", withActiveWorkspace((wsId) => selectNextTab(wsId)));
      window.electronAPI.on("menu:zoom-in", () => handleMenuZoom("in"));
      window.electronAPI.on("menu:zoom-out", () => handleMenuZoom("out"));
      window.electronAPI.on("menu:reset-zoom", () => handleMenuZoom("reset"));
      // Note: No cleanup is performed. The listeners persist for the lifetime
      // of the renderer process (same as notification-ipc-service).
    }

    return (next) => (action) => {
      return next(action);
    };
  };
}
