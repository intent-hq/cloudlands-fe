/**
 * PiP Store - Reactive state management for Picture-in-Picture windows
 *
 * Tracks which tabs have open PiP windows and provides reactive updates
 * when PiP windows are opened or closed.
 */

import { createLogger } from '$lib/utils/client-logger';
import { PIP_CHANNELS } from '$shared/ipc/channels';
import type { PanelTab } from '$features/layout/panel-layout-manager.svelte';

const logger = createLogger('PipStore');

/**
 * State of a single PiP window
 */
export interface PipWindowState {
  workspaceId: string;
  tabId: string;
  tabType: string;
  windowId: number;
  panelId: string;
}

class PipStore {
  // Track which tabs have open PiP windows: Map<"workspaceId:tabId", PipWindowState>
  openPipWindows = $state<Map<string, PipWindowState>>(new Map());

  private initialized = false;
  private openedHandler: ((data: any) => void) | null = null;
  private closedHandler: ((data: any) => void) | null = null;

  /**
   * Generate a key for the PiP windows map
   */
  private getKey(workspaceId: string, tabId: string): string {
    return `${workspaceId}:${tabId}`;
  }

  /**
   * Check if a tab has an open PiP window
   */
  hasPipWindow(workspaceId: string, tabId: string): boolean {
    const key = this.getKey(workspaceId, tabId);
    return this.openPipWindows.has(key);
  }

  /**
   * Get the PiP window state for a tab
   */
  getPipWindow(workspaceId: string, tabId: string): PipWindowState | undefined {
    const key = this.getKey(workspaceId, tabId);
    return this.openPipWindows.get(key);
  }

  /**
   * Get all PiP windows for a workspace
   */
  getPipWindowsForWorkspace(workspaceId: string): PipWindowState[] {
    const result: PipWindowState[] = [];
    for (const [key, state] of this.openPipWindows) {
      if (key.startsWith(`${workspaceId}:`)) {
        result.push(state);
      }
    }
    return result;
  }

  /**
   * Open or focus a PiP window for a tab
   */
  async openOrFocusPip(workspaceId: string, tab: PanelTab, panelId: string): Promise<void> {
    try {
      if (typeof window === 'undefined' || !window.electronAPI) {
        logger.warn('ElectronAPI not available');
        return;
      }

      const result = await window.electronAPI.invoke(PIP_CHANNELS.OPEN, {
        workspaceId,
        tabId: tab.id,
        tabType: tab.type,
        panelId,
      });

      logger.debug('Opened/focused PiP window', {
        workspaceId,
        tabId: tab.id,
        windowId: result,
      });
    } catch (error) {
      logger.error('Failed to open/focus PiP window', error);
      throw error;
    }
  }

  /**
   * Close a PiP window for a tab
   */
  async closePip(workspaceId: string, tabId: string): Promise<void> {
    try {
      if (typeof window === 'undefined' || !window.electronAPI) {
        logger.warn('ElectronAPI not available');
        return;
      }

      await window.electronAPI.invoke(PIP_CHANNELS.CLOSE, {
        workspaceId,
        tabId,
      });

      logger.debug('Closed PiP window', { workspaceId, tabId });
    } catch (error) {
      logger.error('Failed to close PiP window', error);
      throw error;
    }
  }

  /**
   * Close all PiP windows for a workspace
   */
  async closeAllPipForWorkspace(workspaceId: string): Promise<void> {
    try {
      if (typeof window === 'undefined' || !window.electronAPI) {
        logger.warn('ElectronAPI not available');
        return;
      }

      await window.electronAPI.invoke(PIP_CHANNELS.CLOSE_ALL_FOR_WORKSPACE, {
        workspaceId,
      });

      logger.debug('Closed all PiP windows for workspace', { workspaceId });
    } catch (error) {
      logger.error('Failed to close all PiP windows for workspace', error);
      throw error;
    }
  }

  /**
   * Close all PiP windows
   */
  async closeAllPip(): Promise<void> {
    try {
      // Close all windows by iterating through current state
      const allWindows = Array.from(this.openPipWindows.values());
      for (const window of allWindows) {
        await this.closePip(window.workspaceId, window.tabId);
      }

      logger.debug('Closed all PiP windows');
    } catch (error) {
      logger.error('Failed to close all PiP windows', error);
      throw error;
    }
  }

  /**
   * Handle pip:opened event from main process
   */
  private handlePipOpened(data: any): void {
    try {
      const { workspaceId, tabId, windowId } = data;

      if (!workspaceId || !tabId || !windowId) {
        logger.warn('Invalid pip:opened event data', data);
        return;
      }

      const key = this.getKey(workspaceId, tabId);

      // Update state - we don't have full PipWindowState from event,
      // but we can store what we have
      const existing = this.openPipWindows.get(key);
      if (existing) {
        existing.windowId = windowId;
      } else {
        // Create minimal state from event
        this.openPipWindows.set(key, {
          workspaceId,
          tabId,
          tabType: '', // Will be filled in when tab is opened
          windowId,
          panelId: '', // Will be filled in when tab is opened
        });
      }

      logger.debug('PiP window opened', { workspaceId, tabId, windowId });
    } catch (error) {
      logger.error('Error handling pip:opened event', error);
    }
  }

  /**
   * Handle pip:closed event from main process
   */
  private handlePipClosed(data: any): void {
    try {
      const { workspaceId, tabId } = data;

      if (!workspaceId || !tabId) {
        logger.warn('Invalid pip:closed event data', data);
        return;
      }

      const key = this.getKey(workspaceId, tabId);
      this.openPipWindows.delete(key);

      logger.debug('PiP window closed', { workspaceId, tabId });
    } catch (error) {
      logger.error('Error handling pip:closed event', error);
    }
  }

  /**
   * Initialize the store and set up IPC listeners
   */
  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    logger.debug('Initializing PiP store');

    if (typeof window !== 'undefined' && window.electronAPI) {
      // Set up handlers
      this.openedHandler = (data: any) => this.handlePipOpened(data);
      this.closedHandler = (data: any) => this.handlePipClosed(data);

      // Register listeners and store IDs for reliable cleanup with context isolation
      this.openedListenerId = window.electronAPI.on('pip:opened', this.openedHandler);
      this.closedListenerId = window.electronAPI.on('pip:closed', this.closedHandler);

      logger.info('PiP store initialized with IPC listeners');
    }
  }

  // Listener IDs for ID-based removal
  private openedListenerId: string | null = null;
  private closedListenerId: string | null = null;

  /**
   * Cleanup IPC listeners
   */
  cleanup(): void {
    if (typeof window === 'undefined' || !window.electronAPI) {
      return;
    }

    // Use ID-based removal for reliable cleanup with context isolation
    if (this.openedListenerId) {
      window.electronAPI.offById('pip:opened', this.openedListenerId);
      this.openedListenerId = null;
      this.openedHandler = null;
    }

    if (this.closedListenerId) {
      window.electronAPI.offById('pip:closed', this.closedListenerId);
      this.closedListenerId = null;
      this.closedHandler = null;
    }

    this.initialized = false;
    logger.debug('PiP store cleaned up');
  }
}

// Export singleton instance
export const pipStore = new PipStore();

// Export convenience functions that delegate to the singleton
export function hasPipWindow(workspaceId: string, tabId: string): boolean {
  return pipStore.hasPipWindow(workspaceId, tabId);
}

export function getPipWindow(workspaceId: string, tabId: string): PipWindowState | undefined {
  return pipStore.getPipWindow(workspaceId, tabId);
}

export function getPipWindowsForWorkspace(workspaceId: string): PipWindowState[] {
  return pipStore.getPipWindowsForWorkspace(workspaceId);
}

export async function openOrFocusPip(
  workspaceId: string,
  tab: PanelTab,
  panelId: string,
): Promise<void> {
  return pipStore.openOrFocusPip(workspaceId, tab, panelId);
}

export async function closePip(workspaceId: string, tabId: string): Promise<void> {
  return pipStore.closePip(workspaceId, tabId);
}

export async function closeAllPipForWorkspace(workspaceId: string): Promise<void> {
  return pipStore.closeAllPipForWorkspace(workspaceId);
}

export async function closeAllPip(): Promise<void> {
  return pipStore.closeAllPip();
}

export function initPipStore(): void {
  pipStore.initialize();
}
