import { BrowserWindow } from 'electron';
import { protocolAdapter } from '$features/protocol/main/protocol-adapter';
import type { Workspace } from '../../shared/types';
import { Logger } from '../../shared/logger';

const mainLogger = new Logger('DeepLinkHandler');

export interface DeepLinkAction {
  type: 'open' | 'create' | 'clone';
  params: Record<string, string>;
}

export class DeepLinkHandler {
  private pendingUrl: string | null = null;

  constructor() {
    // No dependencies needed - uses protocol adapter
  }

  /**
   * Parse a deep link URL and extract the action and parameters
   * Examples:
   * - intent://open?id=workspace_123
   * - intent://create?title=New%20Project&repo=https://github.com/user/repo&branch=main
   * - intent://clone?repo=https://github.com/user/repo&branch=develop&title=Feature%20Work
   */
  parseDeepLink(url: string): DeepLinkAction | null {
    try {
      mainLogger.info('[DeepLinkHandler] Parsing URL:', { url });

      // Remove the protocol prefix
      const urlWithoutProtocol = url.replace('intent://', 'http://');
      const parsed = new URL(urlWithoutProtocol);

      // Extract the action from the hostname/pathname
      let action = parsed.hostname;
      if (!action || action === 'http:') {
        // Handle case where URL might be intent:///open?id=...
        action = parsed.pathname.replace(/^\/+/, '').split('/')[0];
      }

      // Validate action
      if (!['open', 'create', 'clone'].includes(action)) {
        mainLogger.warn('[DeepLinkHandler] Invalid action:', { action });
        return null;
      }

      // Extract parameters
      const params: Record<string, string> = {};
      parsed.searchParams.forEach((value, key) => {
        params[key] = value;
      });

      mainLogger.info(`[DeepLinkHandler] Parsed action: ${action}`, { params });

      // Validate action type
      const validActions = ['open', 'create', 'clone'] as const;
      if (!validActions.includes(action as any)) {
        mainLogger.warn(`[DeepLinkHandler] Invalid action type: ${action}`);
        return null;
      }

      return {
        type: action as 'open' | 'create' | 'clone',
        params,
      };
    } catch (error) {
      mainLogger.error('[DeepLinkHandler] Failed to parse URL:', error as Error);
      return null;
    }
  }

  /**
   * Handle a deep link URL
   */
  async handleDeepLink(url: string, mainWindow: BrowserWindow | null): Promise<void> {
    const action = this.parseDeepLink(url);

    if (!action) {
      mainLogger.warn('[DeepLinkHandler] Could not parse deep link:', { url });
      return;
    }

    // If the app isn't ready yet, store the URL for later
    if (!mainWindow) {
      mainLogger.info('[DeepLinkHandler] App not ready, storing URL for later');
      this.pendingUrl = url;
      return;
    }

    // Send the action to the renderer process
    mainWindow.webContents.send('deep-link', action);

    // Focus the window
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  }

  /**
   * Process any pending deep link URL
   */
  async processPendingUrl(mainWindow: BrowserWindow): Promise<void> {
    if (this.pendingUrl) {
      mainLogger.info('[DeepLinkHandler] Processing pending URL:', {
        url: this.pendingUrl,
      });
      const url = this.pendingUrl;
      this.pendingUrl = null;
      await this.handleDeepLink(url, mainWindow);
    }
  }

  /**
   * Validate workspace exists before attempting to open
   */
  async validateWorkspaceId(workspaceId: string): Promise<boolean> {
    try {
      const result = await protocolAdapter.listWorkspaces();
      if (!result.ok) {
        mainLogger.error('Failed to list workspaces', undefined, { error: result.error });
        return false;
      }
      return result.data.some((w: Workspace) => w.id === workspaceId);
    } catch (error) {
      mainLogger.error('Failed to validate workspace', error as Error);
      return false;
    }
  }

}
