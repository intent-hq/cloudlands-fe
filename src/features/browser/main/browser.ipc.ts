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
import { workspaceCommandPayload } from '../../../shared/ipc/workspace-command-payloads';
import { Logger } from '../../../shared/logger';
import {
  executeActions,
  type ExecutionResult,
  type ActionSequence,
} from './browser-action-executor';
import { embeddedBrowserCdp } from './embedded-browser-cdp-service';
import { loopbackContextFromTransport, type LoopbackRewriteContext } from './loopback-rewrite';
import {
  resolveBrowserUrl,
  type ResolvedBrowserUrl,
  type TunnelProvider,
} from './loopback-url-resolver';
import {
  ForwardOwnershipRegistry,
  wrapTunnelProviderWithOwnership,
} from './tunnel-forward-ownership';
import { ensureWorkspaceForwardCleanup } from './workspace-forward-cleanup.service';
import { getBackendClient, isSameHostBackendActive } from '../../backend/main/backend.ipc';
import { DirectRelay } from '../../backend/main/direct-relay';
import { TunnelManager } from '../../backend/main/tunnel-manager';
import { sendToWorkspaceWindows } from '../../system/main/system.ipc';

const logger = new Logger('BrowserIPC');

/**
 * Open a browser tab in the renderer.
 * Validates the URL protocol before sending to the renderer.
 * Requires workspaceId and sends only to windows displaying that workspace.
 *
 * The tab id is generated here (main) and passed to the renderer so the
 * caller can record ownership of the new tab immediately — the executor
 * needs the id to mark agent-opened tabs for exact-URL dedupe
 * (intent-hq/monorepo#2541). `allowDuplicate` is forwarded so the renderer's
 * own equivalent-tab dedupe doesn't override an explicit request for a
 * genuinely new tab. `ownerAgentId` (agent opens) is persisted with the tab
 * so ownership survives restart (monorepo#2857).
 */
function openBrowserTab(
  url: string,
  position: 'adjacent' | 'replace' | 'same' = 'adjacent',
  workspaceId?: string,
  allowDuplicate?: boolean,
  requestedUrl?: string,
  pin?: boolean,
  ownerAgentId?: string,
  replaceTabId?: string,
): { success: boolean; message: string; tabId?: string } {
  const workspacePayload = workspaceCommandPayload(workspaceId);
  if (!workspacePayload) {
    return { success: false, message: 'workspaceId is required to open a browser tab' };
  }

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

  // Send only to windows displaying the requested workspace.
  // Include workspaceId in the payload so the renderer can open the browser tab
  // in the correct workspace's panel layout — not just whichever workspace the
  // user happens to be viewing at the moment.
  const delivery = sendToWorkspaceWindows(
    workspacePayload.workspaceId,
    IPC_CHANNELS.BROWSER.OPEN_TAB,
    {
      url,
      position,
      ...workspacePayload,
      tabId,
      ...(allowDuplicate === undefined ? {} : { allowDuplicate }),
      ...(requestedUrl === undefined ? {} : { requestedUrl }),
      ...(pin === undefined ? {} : { pin }),
      ...(ownerAgentId === undefined ? {} : { ownerAgentId }),
      ...(replaceTabId === undefined ? {} : { replaceTabId }),
    },
  );
  if (!delivery.delivered) {
    // No window (or browser-mode client) received the message, so no tab was
    // created — returning the pre-generated tabId here would hand the caller
    // a phantom tab (intent-hq/monorepo#2602).
    logger.warn('browser:open-tab reached no window', { url, workspaceId });
    return {
      success: false,
      // i18n-ignore (agent-facing protocol error, not user-facing)
      message: `Cannot open browser tab: workspace ${workspacePayload.workspaceId} is not open in any window.`,
    };
  }
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

// Omitted width/height is an explicit clear: the reporting element stopped
// displaying the tab (unmount/handoff), so its bounds no longer apply.
const ReportTabBoundsSchema = z.object({
  tabId: z.string(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});

const ExecSchema = z.object({
  actions: z.array(z.record(z.unknown())),
  tabId: z.string().optional(),
  // i18n-ignore (agent-facing IPC validation message, not user-facing)
  workspaceId: z.string().refine((value) => value.trim().length > 0, 'Workspace ID is required'),
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
 * Lazy singleton tunnel backends behind the executor's provider seam
 * (intent-hq/monorepo#2323, #2537). Remote daemons (ws/wss transports)
 * forward ports over the daemon's `/tunnel` WebSocket mux (TunnelManager);
 * local daemons (UDS / loopback ws / tcp) get a direct FE-side loopback
 * relay instead (DirectRelay) — routing locally through the daemon would be
 * a pointless double hop, and `/tunnel` does not exist for UDS transports.
 * Both are reset on backend switch (see `registerBrowserHandlers`) so
 * forwards never outlive the connection they were opened against.
 */
let tunnelManager: TunnelManager | null = null;
let directRelay: DirectRelay | null = null;

function getBrowserTunnelProvider(): TunnelManager | DirectRelay {
  // Unlike `getDaemonLoopbackContext()`'s assume-local fallback (benign for
  // URL rewriting), the backend choice decides WHICH MACHINE a forward lands
  // on: assuming local here would silently relay to the CLIENT's loopback and
  // report success on a misdirected forward. Unknown locality must fail the
  // tunnel action instead (the resolver's probe-fallback paths catch getter
  // throws and degrade to their explanatory error).
  let daemonIsRemote: boolean;
  try {
    daemonIsRemote = loopbackContextFromTransport(
      isSameHostBackendActive(),
      getBackendClient().getConfig(),
    ).daemonIsRemote;
  } catch (err) {
    throw new Error(
      // i18n-ignore (agent-facing protocol error, not user-facing)
      `Cannot select a tunnel backend: the backend connection state is unreadable (${(err as Error).message}).`,
    );
  }
  if (daemonIsRemote) {
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
  if (!directRelay) {
    directRelay = new DirectRelay();
  }
  return directRelay;
}

/**
 * Workspace → forward ownership registry (refcount semantics): forwards a
 * workspace opened are closed when its last owning workspace is archived or
 * deleted (see workspace-forward-cleanup.service.ts). Reset on backend
 * switch alongside the providers.
 */
const forwardOwnership = new ForwardOwnershipRegistry();

// Wrapper memo (keyed by workspace id, '' = app-lifetime) so repeated getter
// calls hand back the SAME provider object while the underlying backend is
// unchanged — callers treat the provider as a stable singleton.
const ownershipWrappers = new Map<string, { inner: TunnelProvider; wrapper: TunnelProvider }>();

/** Close a forward on whichever live provider carries it; never constructs one. */
function closeOwnedForward(remotePort: number): void {
  tunnelManager?.closeForward(remotePort);
  directRelay?.closeForward(remotePort);
}

/**
 * The ownership-recording provider seam: every handout goes through the
 * wrapper so all forwardPort paths (explicit `openTunnel`, the implicit
 * navigate/openTab tunnel fallback, `browser:resolve-url`) record ownership
 * — for `workspaceId` when present, app-lifetime otherwise. Also (re)arms
 * the cleanup subscription lazily.
 */
function getOwnedBrowserTunnelProvider(workspaceId?: string): TunnelProvider {
  ensureWorkspaceForwardCleanup({ registry: forwardOwnership, closeForward: closeOwnedForward });
  const inner = getBrowserTunnelProvider();
  const key = workspaceId ?? '';
  const cached = ownershipWrappers.get(key);
  if (cached && cached.inner === inner) return cached.wrapper;
  const wrapper = wrapTunnelProviderWithOwnership(inner, forwardOwnership, workspaceId);
  ownershipWrappers.set(key, { inner, wrapper });
  return wrapper;
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
    (url, position, allowDuplicate, requestedUrl, pin, ownerAgentId, replaceTabId) =>
      openBrowserTab(
        url,
        position,
        workspaceId,
        allowDuplicate,
        requestedUrl,
        pin,
        ownerAgentId,
        replaceTabId,
      ),
    agentId,
    workspaceId,
    getDaemonLoopbackContext,
    () => getOwnedBrowserTunnelProvider(workspaceId),
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
  // daemon's loopback); dispose both backends so the next use rebuilds them
  // against the new connection. Cast: 'backend-connection-changed' is a
  // custom app event (emitted by backend.ipc.ts), not in Electron's App type.
  (app as NodeJS.EventEmitter).on('backend-connection-changed', () => {
    if (tunnelManager) {
      tunnelManager.dispose();
      tunnelManager = null;
    }
    if (directRelay) {
      directRelay.dispose();
      directRelay = null;
    }
    forwardOwnership.reset();
    ownershipWrappers.clear();
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

  // Visible webview element bounds, reported by the renderer so emulated
  // (agent-owned) tabs scale-to-fit their panel (docs/protocol §5.9).
  ipcMain.handle(
    IPC_CHANNELS.BROWSER.REPORT_TAB_BOUNDS,
    createSafeValidatedHandler(
      ReportTabBoundsSchema,
      async (_event, validated) => {
        if (validated.width !== undefined && validated.height !== undefined) {
          embeddedBrowserCdp.reportTabViewBounds(validated.tabId, validated.width, validated.height);
        } else {
          embeddedBrowserCdp.clearTabViewBounds(validated.tabId);
        }
        return { success: true };
      },
      IPC_CHANNELS.BROWSER.REPORT_TAB_BOUNDS,
    ),
  );

  // Execute browser actions
  ipcMain.handle(
    IPC_CHANNELS.BROWSER.EXEC,
    createSafeValidatedHandler(
      ExecSchema,
      async (_event, validated) =>
        // executeBrowserActions returns { success, results, error? } directly
        executeBrowserActions(validated.actions, validated.tabId, undefined, validated.workspaceId),
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
            // No workspaceId on this renderer-facing path: any forward it
            // mints is app-lifetime (never workspace-cleaned).
            () => getOwnedBrowserTunnelProvider(),
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
