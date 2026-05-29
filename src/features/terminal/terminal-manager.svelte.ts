/**
 * Global terminal manager for the renderer process
 * Manages terminal instances across component lifecycles
 */

import { TerminalAdapter } from './TerminalAdapter';
import { TerminalBufferManager } from './terminal-buffer-manager';
import { Logger } from '../../shared/logger';

import {
  removeTerminal,
  saveTerminalMetadata as saveTerminalMetadataAction,
  type TerminalMetadata,
} from '$lib/store/slices/terminals/terminals-slice';
import { selectTerminalsForWorkspace } from '$lib/store/slices/terminals/terminals-selectors';
  import { store as appStore } from '$lib/store/store';

const logger = new Logger('TerminalManager');

interface ManagedTerminal {
  adapter: TerminalAdapter;
  terminalId: string;
  workspaceId: string;
  isAttached: boolean;
  container: HTMLElement | null;
}

class RendererTerminalManager {
  private terminals = new Map<string, ManagedTerminal>();

  /**
   * Save terminal metadata through Redux. Persistence is saga-owned.
   */
  saveTerminalMetadata(terminalId: string, workspaceId: string, title?: string): void {
    try {
      appStore.dispatch(saveTerminalMetadataAction(workspaceId, terminalId, title || 'Terminal', new Date().toISOString()));
      logger.debug(`[RendererTerminalManager] Saved terminal metadata for ${terminalId}`);
    } catch (error) {
      logger.error('[RendererTerminalManager] Failed to save terminal metadata:', error);
    }
  }

  /**
   * Load terminal metadata from Redux. Persistence hydration is saga-owned.
   */
  loadTerminalMetadata(workspaceId: string): TerminalMetadata[] {
    try {
      return selectTerminalsForWorkspace.select(appStore.state, workspaceId).map((terminal) => ({
        terminalId: terminal.id,
        workspaceId: terminal.workspaceId ?? workspaceId,
        createdAt: terminal.createdAt ?? '',
        title: terminal.customName || terminal.name,
      }));
    } catch (error) {
      logger.error('[RendererTerminalManager] Failed to load terminal metadata:', error);
    }
    return [];
  }

  /**
   * Remove terminal metadata through Redux. Persistence is saga-owned.
   */
  removeTerminalMetadata(terminalId: string, workspaceId: string): void {
    try {
      appStore.dispatch(removeTerminal(workspaceId, terminalId));
      logger.debug(`[RendererTerminalManager] Removed terminal metadata for ${terminalId}`);
    } catch (error) {
      logger.error('[RendererTerminalManager] Failed to remove terminal metadata:', error);
    }
  }

  /**
   * Check if a terminal exists
   */
  hasTerminal(terminalId: string): boolean {
    return this.terminals.has(terminalId);
  }

  /**
   * Get or create a terminal for the given ID
   */
  async getOrCreateTerminal(
    terminalId: string,
    workspaceId: string,
    container: HTMLElement,
    callbacks?: {
      onReady?: () => void;
      onExit?: (exitCode: number) => void;
      onCommandStart?: () => void;
      onCommandFinished?: () => void;
      onCwdChanged?: (cwd: string) => void;
      onSearchResultsChange?: (resultIndex: number, resultCount: number) => void;
      onToggleSearch?: () => void;
    },
    forceNew: boolean = false, // Add parameter to force creating a new terminal
  ): Promise<TerminalAdapter> {
    let managed = this.terminals.get(terminalId);

    // If forceNew is true, dispose the existing terminal first
    if (forceNew && managed) {
      logger.info(
        `[RendererTerminalManager] Force creating new terminal, disposing existing: ${terminalId}`,
      );
      this.disposeTerminal(terminalId);
      managed = undefined;
    }

    if (managed) {
      // Check if the workspaceId matches - if not, we need to recreate the terminal
      // This prevents terminals from a different workspace from being reused
      if (managed.workspaceId !== workspaceId) {
        logger.warn(
          `[RendererTerminalManager] Terminal ${terminalId} has mismatched workspaceId (has: ${managed.workspaceId}, requested: ${workspaceId}). Disposing and recreating.`,
        );
        this.disposeTerminal(terminalId);
        managed = undefined;
      } else {
        logger.info(
          `[RendererTerminalManager] Reattaching to existing terminal: ${terminalId} (was attached: ${managed.isAttached})`,
        );

        // Update container and reattach
        managed.container = container;
        managed.isAttached = true;

        // Reattach the terminal to the new container
        await managed.adapter.reattach(container);

        // Update callbacks if provided
        if (callbacks) {
          managed.adapter.updateCallbacks(callbacks);
          // Terminal is already ready, call the onReady callback immediately
          callbacks.onReady?.();
        }

        logger.info(`[RendererTerminalManager] Successfully reattached terminal: ${terminalId}`);
        return managed.adapter;
      }
    }

    // Create new terminal
    logger.info(`[RendererTerminalManager] Creating new terminal: ${terminalId}`);

    const adapter = new TerminalAdapter({
      workspaceId,
      terminalId,
      container,
      ...callbacks,
    });

    managed = {
      adapter,
      terminalId,
      workspaceId,
      isAttached: true,
      container,
    };

    this.terminals.set(terminalId, managed);

    // Save terminal metadata for persistence
    this.saveTerminalMetadata(terminalId, workspaceId);

    // Initialize the terminal (skip buffer restore if this is a forced new terminal)
    await adapter.initialize(forceNew);

    return adapter;
  }

  /**
   * Detach a terminal (when component unmounts)
   */
  detachTerminal(terminalId: string): void {
    const managed = this.terminals.get(terminalId);
    if (managed) {
      logger.info(`[RendererTerminalManager] Detaching terminal: ${terminalId}`);
      managed.isAttached = false;
      // Call detach first before clearing container
      managed.adapter.detach();
      managed.container = null;
    }
  }

  /**
   * Dispose a terminal completely
   */
  disposeTerminal(terminalId: string): void {
    const managed = this.terminals.get(terminalId);
    if (managed) {
      logger.info(`[RendererTerminalManager] Disposing terminal: ${terminalId}`);
      managed.adapter.dispose();
      this.terminals.delete(terminalId);
      // Remove from metadata
      this.removeTerminalMetadata(terminalId, managed.workspaceId);
    }
  }

  /**
   * Clear a terminal's content
   */
  clearTerminal(terminalId: string): void {
    const managed = this.terminals.get(terminalId);
    if (managed) {
      logger.info(`[RendererTerminalManager] Clearing terminal: ${terminalId}`);
      managed.adapter.clear();
    }
  }

  /**
   * Get terminal info
   */
  getTerminalInfo(terminalId: string): { cwd?: string; isExecuting?: boolean } | null {
    const managed = this.terminals.get(terminalId);
    if (managed) {
      return managed.adapter.getInfo();
    }
    return null;
  }

  /**
   * Get terminal buffer content as a string.
   * Tries the live xterm buffer first, then falls back to the persisted buffer snapshot.
   */
  async getBufferContent(terminalId: string, workspaceId: string): Promise<string | null> {
    // Try live terminal first
    const managed = this.terminals.get(terminalId);
    if (managed?.adapter) {
      try {
        const xterm = (managed.adapter as any).xterm;
        if (xterm?.buffer?.active) {
          const buffer = xterm.buffer.active;
          const lines: string[] = [];
          for (let i = 0; i < buffer.length; i++) {
            const line = buffer.getLine(i);
            if (line) {
              lines.push(line.translateToString(true));
            }
          }
          // Trim trailing empty lines
          while (lines.length > 0 && !lines[lines.length - 1].trim()) {
            lines.pop();
          }
          if (lines.length > 0) {
            return lines.join('\n');
          }
        }
      } catch (error) {
        logger.warn('[RendererTerminalManager] Failed to read live buffer, falling back:', error);
      }
    }

    // Fall back to persisted buffer snapshot
    try {
      const bufferManager = new TerminalBufferManager(workspaceId, terminalId);
      const snapshot = await bufferManager.restoreBuffer();
      if (snapshot && snapshot.lines.length > 0) {
        const lines = [...snapshot.lines];
        // Trim trailing empty lines
        while (lines.length > 0 && !lines[lines.length - 1].trim()) {
          lines.pop();
        }
        return lines.join('\n');
      }
    } catch (error) {
      logger.error('[RendererTerminalManager] Failed to read persisted buffer:', error);
    }

    return null;
  }

  /**
   * Dispose all terminals for a specific workspace
   * This should be called when switching workspaces to prevent cross-workspace terminal reuse
   */
  disposeWorkspaceTerminals(workspaceId: string): void {
    const terminalsToDispose: string[] = [];
    for (const [id, managed] of this.terminals) {
      if (managed.workspaceId === workspaceId) {
        terminalsToDispose.push(id);
      }
    }

    if (terminalsToDispose.length > 0) {
      logger.info(
        `[RendererTerminalManager] Disposing ${terminalsToDispose.length} terminals for workspace ${workspaceId}`,
      );
      for (const id of terminalsToDispose) {
        try {
          const managed = this.terminals.get(id);
          if (managed) {
            managed.adapter.dispose();
            this.terminals.delete(id);
          }
        } catch (error) {
          logger.error(`[RendererTerminalManager] Failed to dispose terminal ${id}:`, error);
        }
      }
    }
  }

  /**
   * Dispose all terminals
   */
  disposeAll(): void {
    logger.info(`[RendererTerminalManager] Disposing all ${this.terminals.size} terminals`);
    for (const [id, managed] of this.terminals) {
      try {
        managed.adapter.dispose();
      } catch (error) {
        logger.error(`[RendererTerminalManager] Failed to dispose terminal ${id}:`, error);
      }
    }
    this.terminals.clear();
  }
}

// Export singleton instance - store on window to survive HMR
declare global {
  interface Window {
    __terminalManager?: RendererTerminalManager;
  }
}

if (typeof window !== 'undefined' && !window.__terminalManager) {
  window.__terminalManager = new RendererTerminalManager();

  // NOTE: We intentionally do NOT dispose terminals on beforeunload.
  // Terminals should persist across page refreshes - the backend PTY keeps running
  // and we reconnect to it after the page reloads.
  // Terminals are only disposed when explicitly closed by the user.
}

export const terminalManager = window.__terminalManager!;
