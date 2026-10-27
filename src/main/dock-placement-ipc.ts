import { BrowserWindow, ipcMain } from 'electron';
import { WINDOW_CHANNELS } from '../shared/ipc/channels';
import {
  EmptySchema,
  WindowSetDockPointerRegionSchema,
  WindowUpdateDockPlacementSchema,
} from './ipc-schemas';
import { createSafeValidatedHandler } from './ipc-validation-middleware';
import {
  getDockWindow,
  getDockPlacementSnapshot,
  updateDockPlacement,
  setDockPointerRegions,
} from './dock-window';

/** Shared production registration used by the system feature and native E2E harness. */
export function registerDockPlacementHandlers(): void {
  ipcMain.handle(
    WINDOW_CHANNELS.SET_DOCK_POINTER_REGION,
    createSafeValidatedHandler(
      WindowSetDockPointerRegionSchema,
      async (event, validated) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window || window !== getDockWindow()) return { success: false, supported: false };
        return { success: true, supported: setDockPointerRegions(window, validated) };
      },
      WINDOW_CHANNELS.SET_DOCK_POINTER_REGION,
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
        if (!window || window !== getDockWindow())
          throw new Error('Only the dock can change placement');
        return updateDockPlacement(window, command);
      },
      WINDOW_CHANNELS.UPDATE_DOCK_PLACEMENT,
    ),
  );
}
