import { BrowserWindow, ipcMain } from 'electron';
import { WINDOW_CHANNELS } from '../shared/ipc/channels';
import {
  EmptySchema,
  WindowShowDockMenuSchema,
  WindowSetDockPointerRegionSchema,
  WindowUpdateDockPlacementSchema,
  WindowSwitchDockBackendSchema,
} from './ipc-schemas';
import { createSafeValidatedHandler, createValidatedHandler } from './ipc-validation-middleware';
import {
  getDockWindow,
  getDockPointerPublication,
  getDockPlacementSnapshot,
  markDockRendererReady,
  updateDockPlacement,
  setDockPointerRegions,
  switchDockBackend,
} from './dock-window';
import { showDockContextMenu } from './dock-context-menu';

/** Shared production registration used by the system feature and native E2E harness. */
export function registerDockPlacementHandlers(): void {
  ipcMain.handle(
    WINDOW_CHANNELS.SWITCH_DOCK_BACKEND,
    createValidatedHandler(
      WindowSwitchDockBackendSchema,
      async (event, request) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window || window !== getDockWindow() || !event.senderFrame)
          throw new Error('Only the current dock document can select its machine');
        return switchDockBackend(window, request, event.senderFrame);
      },
      WINDOW_CHANNELS.SWITCH_DOCK_BACKEND,
    ),
  );
  ipcMain.handle(
    WINDOW_CHANNELS.SET_DOCK_POINTER_REGION,
    createSafeValidatedHandler(
      WindowSetDockPointerRegionSchema,
      async (event, validated) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (
          !window ||
          window !== getDockWindow() ||
          event.senderFrame !== event.sender.mainFrame ||
          (validated.revision !== undefined &&
            validated.revision !== getDockPlacementSnapshot(window)?.revision)
        )
          return { success: false, supported: false };
        const supported = setDockPointerRegions(window, validated);
        return { success: true, supported, version: getDockPointerPublication(window) };
      },
      WINDOW_CHANNELS.SET_DOCK_POINTER_REGION,
    ),
  );

  ipcMain.handle(
    WINDOW_CHANNELS.DOCK_RENDERER_READY,
    createSafeValidatedHandler(
      EmptySchema,
      async (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        // Only the dock's own top-level document can reveal it.
        if (!window || window !== getDockWindow() || event.senderFrame !== event.sender.mainFrame)
          return { shown: false };
        return { shown: markDockRendererReady(window) };
      },
      WINDOW_CHANNELS.DOCK_RENDERER_READY,
    ),
  );
  ipcMain.handle(
    WINDOW_CHANNELS.GET_DOCK_PLACEMENT,
    createSafeValidatedHandler(
      EmptySchema,
      async (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window || window !== getDockWindow())
          throw new Error('Only the dock can read placement');
        return getDockPlacementSnapshot(window);
      },
      WINDOW_CHANNELS.GET_DOCK_PLACEMENT,
    ),
  );
  ipcMain.handle(
    WINDOW_CHANNELS.UPDATE_DOCK_PLACEMENT,
    createSafeValidatedHandler(
      WindowUpdateDockPlacementSchema,
      async (event, command) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window || window !== getDockWindow() || event.senderFrame !== event.sender.mainFrame)
          throw new Error('Only the dock document can change placement');
        return updateDockPlacement(window, command);
      },
      WINDOW_CHANNELS.UPDATE_DOCK_PLACEMENT,
    ),
  );
  ipcMain.handle(
    WINDOW_CHANNELS.SHOW_DOCK_MENU,
    createSafeValidatedHandler(
      WindowShowDockMenuSchema,
      async (event, request) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        // Only the dock's own top-level document can open its menu.
        if (!window || window !== getDockWindow() || event.senderFrame !== event.sender.mainFrame)
          return { shown: false };
        const frame = event.senderFrame;
        const result = await showDockContextMenu(window, request);
        if (window.isDestroyed() || window !== getDockWindow() || frame !== event.sender.mainFrame)
          return { shown: false };
        return result;
      },
      WINDOW_CHANNELS.SHOW_DOCK_MENU,
    ),
  );
}

/**
 * Dock header double-click: bring Intent forward as it was. `activate` is the app's
 * own activation (the app-icon click), run on behalf of the dock's top-level
 * document only.
 */
export function registerDockActivateAppHandler(activate: () => Promise<unknown>): void {
  ipcMain.handle(
    WINDOW_CHANNELS.ACTIVATE_APP,
    createSafeValidatedHandler(
      EmptySchema,
      async (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window || window !== getDockWindow() || event.senderFrame !== event.sender.mainFrame)
          return { activated: false };
        await activate();
        return { activated: true };
      },
      WINDOW_CHANNELS.ACTIVATE_APP,
    ),
  );
}
