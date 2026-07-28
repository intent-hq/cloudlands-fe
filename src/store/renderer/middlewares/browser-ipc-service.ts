/**
 * Browser IPC service — restores the renderer half of the deleted
 * `watchBrowserOpenTabSaga` (app-layout/sagas/app-layout-saga.ts, removed with
 * the saga runtime in 95d908a2 without re-homing). With no listener, every
 * `browser:open-tab` event the main process forwards over IPC (agent/MCP
 * `openBrowserTab` calls) was a silent no-op.
 *
 * This reconnects the path WITHOUT re-adding a saga, following the
 * menu-ipc-service pattern: on middleware creation it registers a window IPC
 * listener for the preload-allowed `browser:open-tab` channel. The payload
 * carries `{ url, position?, workspaceId? }`; the target workspace is the
 * payload's `workspaceId`, falling back to the active workspace (no-op when
 * neither is available). Position semantics match the deleted saga:
 *   - `"replace"` → update + activate an existing browser tab, else open one.
 *   - `"adjacent"` (default) → `openTabInAdjacentOrSplit`.
 *   - anything else (e.g. `"same"`) → plain `openTab`.
 *
 * Dependency-light per src/store/renderer/AGENTS.md: no selector imports —
 * reads `appStore.state` directly.
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { store as appStore } from "$store/renderer/store";
import { isElectron } from "$lib/electron-bridge";
import {
  openTab,
  openTabInAdjacentOrSplit,
  setActiveTab,
  updateTabBrowserUrl,
} from "../slices/panel-layout/panel-layout-slice";
import type { PanelTab } from "../slices/panel-layout/panel-layout-types";

type BrowserOpenTabEvent = {
  url: string;
  position?: "adjacent" | "replace" | "same";
  workspaceId?: string;
};

/** Minimal structural view of the state slices this service reads directly. */
interface BrowserStateSlice {
  workspace?: { activeWorkspaceId?: string | null };
  panelLayout?: {
    byWorkspaceId?: Record<
      string,
      { panels: Record<string, { tabs: Array<{ id: string; type: string }> }> }
    >;
  };
}

function getState(): BrowserStateSlice {
  return appStore.state as unknown as BrowserStateSlice;
}

function getActiveWorkspaceId(): string | null {
  const wsId = getState().workspace?.activeWorkspaceId;
  return typeof wsId === "string" && wsId.length > 0 ? wsId : null;
}

function findExistingBrowserTab(workspaceId: string): { id: string; type: string } | undefined {
  const ws = getState().panelLayout?.byWorkspaceId?.[workspaceId];
  if (!ws?.panels) return undefined;
  for (const panel of Object.values(ws.panels)) {
    const browserTab = panel.tabs?.find((tab) => tab.type === "browser");
    if (browserTab) return browserTab;
  }
  return undefined;
}

function makeBrowserTab(url: string): Omit<PanelTab, "id"> {
  return {
    type: "browser",
    title: "Browser",
    browserUrl: url,
    closable: true,
  };
}

function handleBrowserOpenTab(data?: BrowserOpenTabEvent | null): void {
  if (!data || typeof data.url !== "string") return;
  const workspaceId = data.workspaceId || getActiveWorkspaceId();
  if (!workspaceId) return;

  const { url, position = "adjacent" } = data;

  if (position === "replace") {
    const existingBrowserTab = findExistingBrowserTab(workspaceId);
    if (existingBrowserTab) {
      appStore.dispatch(updateTabBrowserUrl(workspaceId, existingBrowserTab.id, url));
      appStore.dispatch(setActiveTab(workspaceId, existingBrowserTab.id));
      return;
    }
    appStore.dispatch(openTab(workspaceId, makeBrowserTab(url)));
    return;
  }

  if (position === "adjacent") {
    appStore.dispatch(openTabInAdjacentOrSplit(workspaceId, makeBrowserTab(url)));
    return;
  }

  appStore.dispatch(openTab(workspaceId, makeBrowserTab(url)));
}

export function createBrowserIpcMiddleware(): StoreMiddleware {
  return () => {
    // Register the listener once on middleware creation
    if (isElectron() && typeof window !== "undefined" && window.electronAPI?.on) {
      window.electronAPI.on("browser:open-tab", handleBrowserOpenTab);
      // Note: No cleanup is performed. The listener persists for the lifetime
      // of the renderer process (same as menu-ipc-service).
    }

    return (next) => (action) => {
      return next(action);
    };
  };
}
