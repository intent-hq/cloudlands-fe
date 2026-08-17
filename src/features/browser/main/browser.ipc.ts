/**
 * Browser IPC Handlers
 *
 * Provides IPC handlers for browser CDP access via a declarative action DSL.
 * Instead of executing arbitrary code, we validate and execute a sequence
 * of known browser actions.
 */

import { app, ipcMain } from 'electron';
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
import { loopbackContextFromTransport, type LoopbackRewriteContext } from './loopback-rewrite';
import { resolveBrowserUrl, type ResolvedBrowserUrl } from './loopback-url-resolver';
import { getBackendClient, isSameHostBackendActive } from '../../backend/main/backend.ipc';
import { TunnelManager } from '../../backend/main/tunnel-manager';
import { sendToWorkspaceWindows } from '../../system/main/system.ipc';

const logger = new Logger('BrowserIPC');

/**
 * Open a browser tab in the renderer.
 * Validates the URL protocol before sending to the renderer.
 * When workspaceId is provided, sends only to the window displaying that workspace.
 * Falls back to broadcasting to all windows if no workspaceId or no matching window found.
 *
 * The tab id is generated here (main) and passed to the renderer so the
 * caller can lease the new tab immediately — the executor needs the id to
 * mark agent-opened tabs for exact-URL dedupe (intent-hq/monorepo#2541).
 * `allowDuplicate` is forwarded so the renderer's own equivalent-tab dedupe
 * doesn't override an explicit request for a genuinely new tab.
 */
function openBrowserTab(
  url: string,
  position: 'adjacent' | 'replace' | 'same' = 'adjacent',
  workspaceId?: string,
  allowDuplicate?: boolean,
  pin?: boolean,
): { success: boolean; message: string; tabId?: string } {
  // Validate URL before sending to renderer
  try {
    const parsed = new URL(url);
    if (!BROWSER_PROTOCOLS.NAVIGATION_ALLOWED.includes(parsed.protocol)) {
      // i18n-ignore (agent-facing protocol error, not user-facing)
      const msg = `Protocol "${parsed.protocol}" is not allowed. Supported: ${BROWSER_PROTOCOLS.NAVIGATION_ALLOWED.join(', ')}`;
      logger.warn('Rejected browser:open-tab with disallowed protocol', {
        url,
        protocol: parsed.protocol,
      });
      return { success: false, message: msg };
    }
  } catch {
    // i18n-ignore (agent-facing protocol error, not user-facing)
    const msg = `Invalid URL: "${url}"`;
    logger.warn('Rejected browser:open-tab with invalid URL', { url });
    return { success: false, message: msg };
  }

  // Pre-generate the tab id so main knows the id of the tab the renderer
  // will create (same shape as the renderer's own generateTabId()).
  const tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  // Send to workspace windows (falls back to all windows if no workspaceId).
  // Include workspaceId in the payload so the renderer can open the browser tab
  // in the correct workspace's panel layout — not just whichever workspace the
  // user happens to be viewing at the moment.
  sendToWorkspaceWindows(workspaceId, IPC_CHANNELS.BROWSER.OPEN_TAB, {
    url,
    position,
    workspaceId,
    tabId,
    ...(allowDuplicate === undefined ? {} : { allowDuplicate }),
    ...(pin === undefined ? {} : { pin }),
  });
  logger.info('Sent browser:open-tab', { url, position, workspaceId, tabId, allowDuplicate, pin });
  // i18n-ignore (agent-facing protocol message, not user-facing)
  return { success: true, message: `Opening browser tab with URL: ${url}`, tabId };
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

const ResolveUrlSchema = z.object({
  url: z.string(),
  /** `rewrite-only` applies the loopback rewrite with no probe and no tunnel (display-only). */
  mode: z.enum(['full', 'rewrite-only']).optional(),
});

/**
 * Resolve the daemon loopback locality from the active backend connection so
 * `navigate`/`openTab` URLs can be rewritten per the loopback-hostname table
 * (intent-hq/monorepo#2323). Falls back to a local daemon (no bare-loopback
 * rewriting; `*.localhost` aliases still resolve to `127.0.0.1`) if the
 * connection state cannot be read.
 */
function getDaemonLoopbackContext(): LoopbackRewriteContext {
  try {
    return loopbackContextFromTransport(isSameHostBackendActive(), getBackendClient().getConfig());
  } catch (err) {
    logger.warn('Could not resolve daemon loopback context; assuming local daemon', {
      error: (err as Error).message,
    });
    return { daemonIsRemote: false };
  }
}

/**
 * Lazy singleton TunnelManager backing the executor's probe-failure fallback:
 * when a rewritten remote origin is unreachable, the port is forwarded over
 * the daemon's `/tunnel` WebSocket and the embedded browser loads the local
 * forward instead (intent-hq/monorepo#2323). Reset on backend switch (see
 * `registerBrowserHandlers`) so forwards never outlive the connection they
 * were opened against.
 */
let tunnelManager: TunnelManager | null = null;

function getBrowserTunnelProvider(): TunnelManager {
  if (!tunnelManager) {
    tunnelManager = new TunnelManager({
      getConfig: () => {
        try {
          return getBackendClient().getConfig();
        } catch (err) {
          logger.warn('Could not resolve backend config for the browser tunnel', {
            error: (err as Error).message,
          });
          return null;
        }
      },
    });
  }
  return tunnelManager;
}

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
    (url, position, allowDuplicate, pin) =>
      openBrowserTab(url, position, workspaceId, allowDuplicate, pin),
    agentId,
    workspaceId,
    getDaemonLoopbackContext,
    getBrowserTunnelProvider,
  );
}

// Re-export types for MCP tools
export type { ExecutionResult, ActionSequence };

/**
 * Register browser IPC handlers
 */
export function registerBrowserHandlers(): void {
  logger.info('Registering browser IPC handlers');

  // A backend switch invalidates every tunnel forward (they target the old
  // daemon's loopback); dispose the manager so the next fallback rebuilds it
  // against the new connection. Cast: 'backend-connection-changed' is a
  // custom app event (emitted by backend.ipc.ts), not in Electron's App type.
  (app as NodeJS.EventEmitter).on('backend-connection-changed', () => {
    if (tunnelManager) {
      tunnelManager.dispose();
      tunnelManager = null;
    }
  });

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

  // Resolve a URL through the shared rewrite → probe → tunnel pipeline so
  // programmatic renderer entry points (script URL clicks, terminal links)
  // reach the same target `browser.exec` navigate/openTab would — the
  // address bar never resolves (intent-hq/monorepo#2404). `mode:
  // "rewrite-only"` skips the probe/tunnel stage for display-only callers.
  // Never throws: probe+tunnel failures return the rewritten URL plus a
  // structured `error`, and unexpected failures degrade to a non-rewritten
  // passthrough.
  ipcMain.handle(
    IPC_CHANNELS.BROWSER.RESOLVE_URL,
    createSafeValidatedHandler(
      ResolveUrlSchema,
      async (_event, validated): Promise<ResolvedBrowserUrl> => {
        try {
          return await resolveBrowserUrl(
            validated.url,
            getDaemonLoopbackContext(),
            getBrowserTunnelProvider,
            { rewriteOnly: validated.mode === 'rewrite-only' },
          );
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          logger.warn('browser:resolve-url failed; passing the URL through unresolved', {
            url: validated.url,
            error: detail,
          });
          return {
            url: validated.url,
            rewritten: false,
            // i18n-ignore (agent/renderer-facing protocol error, not user-facing)
            error: `URL resolution failed: ${detail}`,
          };
        }
      },
      IPC_CHANNELS.BROWSER.RESOLVE_URL,
    ),
  );

  logger.info('Browser IPC handlers registered');
}
