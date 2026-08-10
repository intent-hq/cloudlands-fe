/**
 * Panel Layout History Client
 *
 * Renderer-side IPC client for panel layout history persistence.
 * Wraps the main-process handlers in panel-layout-history.ipc.ts.
 */

import { PANEL_LAYOUT_CHANNELS } from '../../shared/ipc/channels';

export interface PanelLayoutHistoryData {
  version: number;
  workspaceId: string;
  history: any[];
  historyIndex: number;
  lastUpdated: string;
}

/**
 * Save panel layout history to disk (via main process).
 * Non-critical — errors are silently ignored.
 */
export async function savePanelLayoutHistory(
  workspaceId: string,
  data: PanelLayoutHistoryData,
  backendId?: string,
): Promise<boolean> {
  try {
    const result = await window.electronAPI.invoke(PANEL_LAYOUT_CHANNELS.SAVE, {
      workspaceId,
      backendId,
      data,
    });
    return result === true;
  } catch {
    return false;
  }
}

/**
 * Load panel layout history from disk (via main process).
 * Returns null if not found or on error.
 */
export async function loadPanelLayoutHistory(
  workspaceId: string,
  backendId?: string,
): Promise<PanelLayoutHistoryData | null> {
  try {
    const result = await window.electronAPI.invoke(PANEL_LAYOUT_CHANNELS.LOAD, {
      workspaceId,
      backendId,
    });
    return result ?? null;
  } catch {
    return null;
  }
}
