/**
 * Browser IPC Handlers
 *
 * Provides IPC handlers for browser CDP access via a declarative action DSL.
 * Instead of executing arbitrary code, we validate and execute a sequence
 * of known browser actions.
 */

import { ipcMain } from 'electron';
import { z } from 'zod';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { BROWSER_PROTOCOLS } from '../../../shared/constants';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';
import { Logger } from '../../../shared/logger';
import {
  executeActions,
  type ExecutionResult,
  type ActionSequence,
} from './browser-action-executor';
import { embeddedBrowserCdp } from './embedded-browser-cdp-service';
import { sendToWorkspaceWindows } from '../../system/main/system.ipc';

const logger = new Logger('BrowserIPC');

/**
 * Open a browser tab in the renderer.
 * Validates the URL protocol before sending to the renderer.
 * When workspaceId is provided, sends only to the window displaying that workspace.
 * Falls back to broadcasting to all windows if no workspaceId or no matching window found.
 */
function openBrowserTab(
  url: string,
  position: 'adjacent' | 'replace' | 'same' = 'adjacent',
  workspaceId?: string,
): { success: boolean; message: string } {
  // Validate URL before sending to renderer
  try {
    const parsed = new URL(url);
    if (!BROWSER_PROTOCOLS.NAVIGATION_ALLOWED.includes(parsed.protocol)) {
      const msg = `Protocol "${parsed.protocol}" is not allowed. Supported: ${BROWSER_PROTOCOLS.NAVIGATION_ALLOWED.join(', ')}`;
      logger.warn('Rejected browser:open-tab with disallowed protocol', { url, protocol: parsed.protocol });
      return { success: false, message: msg };
    }
  } catch {
    const msg = `Invalid URL: "${url}"`;
    logger.warn('Rejected browser:open-tab with invalid URL', { url });
    return { success: false, message: msg };
  }

  // Send to workspace windows (falls back to all windows if no workspaceId)
  sendToWorkspaceWindows(workspaceId, IPC_CHANNELS.BROWSER.OPEN_TAB, { url, position });
  logger.info('Sent browser:open-tab', { url, position, workspaceId });
  return { success: true, message: `Opening browser tab with URL: ${url}` };
}

// Schemas for IPC validation
const RegisterTabSchema = z.object({
  tabId: z.string(),
  webContentsId: z.number(),
});

const UnregisterTabSchema = z.object({
  tabId: z.string(),
});

const ExecSchema = z.object({
  actions: z.array(z.record(z.unknown())),
  tabId: z.string().optional(),
});

/**
 * Execute a sequence of browser actions.
 *
 * This is a secure alternative to arbitrary code execution - each action
 * is validated against a known schema before execution.
 *
 * Exported for use by MCP tools.
 */
export async function executeBrowserActions(
  actions: unknown[],
  tabId?: string,
  agentId?: string,
  workspaceId?: string,
): Promise<ExecutionResult> {
  return executeActions(
    { actions, tabId },
    (url, position) => openBrowserTab(url, position, workspaceId),
    agentId,
    workspaceId,
  );
}

// Re-export types for MCP tools
export type { ExecutionResult, ActionSequence };

/**
 * Register browser IPC handlers
 */
export function registerBrowserHandlers(): void {
  logger.info('Registering browser IPC handlers');

  // Register a browser tab for CDP access
  ipcMain.handle(
    IPC_CHANNELS.BROWSER.REGISTER_TAB,
    createSafeValidatedHandler(
      RegisterTabSchema,
      async (_event, validated) => {
        embeddedBrowserCdp.registerTab(validated.tabId, validated.webContentsId);
        return { success: true };
      },
      IPC_CHANNELS.BROWSER.REGISTER_TAB,
    ),
  );

  // Unregister a browser tab
  ipcMain.handle(
    IPC_CHANNELS.BROWSER.UNREGISTER_TAB,
    createSafeValidatedHandler(
      UnregisterTabSchema,
      async (_event, validated) => {
        embeddedBrowserCdp.unregisterTab(validated.tabId);
        return { success: true };
      },
      IPC_CHANNELS.BROWSER.UNREGISTER_TAB,
    ),
  );

  // Execute browser actions
  ipcMain.handle(
    IPC_CHANNELS.BROWSER.EXEC,
    createSafeValidatedHandler(
      ExecSchema,
      async (_event, validated) =>
        // executeBrowserActions returns { success, results, error? } directly
        executeBrowserActions(validated.actions, validated.tabId),
      IPC_CHANNELS.BROWSER.EXEC,
    ),
  );

  logger.info('Browser IPC handlers registered');
}
