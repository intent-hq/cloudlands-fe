/**
 * Panel Layout History Client
 *
 * Renderer-side client for loading and saving panel layout history via IPC.
 */

import type { WorkspaceId } from '../../shared/types';
import { createLogger } from '$lib/utils/client-logger';
import { invoke as invokeIpc } from '../../shared/generated/ipc-client';

const logger = createLogger('PanelLayoutHistoryClient');

/**
 * A snapshot of the panel layout state at a point in time
 */
export interface LayoutSnapshot {
  root: any;
  panels: Record<string, any>;
  focusedPanelId: string | null;
  timestamp: number;
}

/**
 * Persisted panel layout history data
 */
export interface PanelLayoutHistoryData {
  version: number;
  workspaceId: string;
  history: LayoutSnapshot[];
  historyIndex: number;
  lastUpdated: string;
}

class PanelLayoutHistoryClient {
  /**
   * Load panel layout history for a workspace
   */
  async load(workspaceId: WorkspaceId): Promise<PanelLayoutHistoryData | null> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        return await invokeIpc<PanelLayoutHistoryData | null>('panel-layout:load', { workspaceId });
      }
      logger.warn('[PanelLayoutHistoryClient] IPC not available');
      return null;
    } catch (error) {
      logger.error(
        `[PanelLayoutHistoryClient] Failed to load history for workspace: ${workspaceId}`,
        error,
      );
      return null;
    }
  }

  /**
   * Save panel layout history for a workspace
   */
  async save(workspaceId: WorkspaceId, data: PanelLayoutHistoryData): Promise<boolean> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        return await invokeIpc<boolean>('panel-layout:save', { workspaceId, data });
      }
      logger.warn('[PanelLayoutHistoryClient] IPC not available');
      return false;
    } catch (error) {
      logger.error(
        `[PanelLayoutHistoryClient] Failed to save history for workspace: ${workspaceId}`,
        error,
      );
      return false;
    }
  }
}

export const panelLayoutHistoryClient = new PanelLayoutHistoryClient();
