/**
 * Browser Action Executor
 *
 * Executes a declarative sequence of browser actions instead of arbitrary code.
 * This is a secure alternative to executeCode() that validates each action
 * against a known schema before execution.
 *
 * Actions are executed sequentially, with each action's result available
 * to subsequent actions via variable references.
 */

import { z } from 'zod';
import { BROWSER_PROTOCOLS } from '../../../shared/constants';
import { Logger } from '../../../shared/logger';
import { embeddedBrowserCdp } from './embedded-browser-cdp-service';
import { browserCapture } from './browser-capture-service';
import type { SnapshotOptions, SessionOptions, CaptureStepOptions } from './browser-capture-types';
import {
  rewriteLoopbackUrl,
  type LoopbackRewriteContext,
  type LoopbackRewriteResult,
} from './loopback-rewrite';
import { resolveRewrittenRemoteTarget, type TunnelProvider } from './loopback-url-resolver';

const logger = new Logger('BrowserActionExecutor');

// ============================================================================
// Action Schemas
// ============================================================================

const ListTabsActionSchema = z.object({
  action: z.literal('listTabs'),
});

const FocusTabActionSchema = z.object({
  action: z.literal('focusTab'),
  tabId: z.string().optional(),
});

const GetAccessibilityTreeActionSchema = z.object({
  action: z.literal('getAccessibilityTree'),
  tabId: z.string().optional(),
});

const ScreenshotActionSchema = z.object({
  action: z.literal('screenshot'),
  tabId: z.string().optional(),
});

const EvaluateActionSchema = z.object({
  action: z.literal('evaluate'),
  expression: z.string(),
  tabId: z.string().optional(),
});

const WaitForOptionsSchema = z.object({
  console: z.string().optional(),
  networkIdle: z.number().optional(),
  selector: z.string().optional(),
  timeout: z.number().optional(),
});

const SnapshotActionSchema = z
  .object({
    action: z.literal('snapshot'),
    tabId: z.string().optional(),
    name: z.string().optional(),
    reload: z.boolean().optional(),
    waitFor: WaitForOptionsSchema.optional(),
  })
  .strict();

const StartSessionActionSchema = z
  .object({
    action: z.literal('startSession'),
    tabId: z.string().optional(),
    name: z.string().optional(),
  })
  .strict();

const StartCaptureActionSchema = z.object({
  action: z.literal('startCapture'),
  sessionId: z.string(),
});

const EndCaptureActionSchema = z.object({
  action: z.literal('endCapture'),
  sessionId: z.string(),
});

const CaptureStepActionSchema = z.object({
  action: z.literal('captureStep'),
  sessionId: z.string(),
  stepName: z.string(),
  reload: z.boolean().optional(),
  waitFor: WaitForOptionsSchema.optional(),
});

const StartTraceActionSchema = z.object({
  action: z.literal('startTrace'),
  sessionId: z.string(),
  traceName: z.string(),
});

const StopTraceActionSchema = z.object({
  action: z.literal('stopTrace'),
  sessionId: z.string(),
  traceName: z.string(),
});

const EndSessionActionSchema = z.object({
  action: z.literal('endSession'),
  sessionId: z.string(),
});

const ResetTabActionSchema = z.object({
  action: z.literal('resetTab'),
  tabId: z.string().optional(),
});

const GetSummaryActionSchema = z
  .object({
    action: z.literal('getSummary'),
    captureId: z.string(),
  })
  .strict();

const OpenTabActionSchema = z.object({
  action: z.literal('openTab'),
  // `position` only applies when a genuinely new tab is opened — when an
  // existing tab is reused (exact-URL dedupe or idle-tab reuse) it is
  // ignored and the reused tab is focused in place.
  url: z.string(),
  position: z.enum(['adjacent', 'replace', 'same']).optional(),
  // Opt out of tab reuse (exact-URL dedupe and idle-tab reuse) and always
  // open a genuinely new tab (intent-hq/monorepo#2541). Also forwarded to
  // the renderer so its own equivalent-tab dedupe doesn't coalesce the
  // requested duplicate.
  allowDuplicate: z.boolean().optional(),
});

const NavigateActionSchema = z.object({
  action: z.literal('navigate'),
  url: z.string(),
  tabId: z.string().optional(),
});

// tabId is deliberately REQUIRED (no fallback to the sequence-level default):
// closing is destructive, so an explicit id per action avoids accidentally
// closing the wrong tab (intent-hq/monorepo#1931).
const CloseTabActionSchema = z.object({
  action: z.literal('closeTab'),
  tabId: z.string(),
});

const TunnelPortSchema = z.number().int().min(1).max(65535);

// Programmatic tunnel actions (intent-hq/monorepo#2537): explicit, tab-free
// control of daemon-port forwards. Uniform semantics regardless of transport
// — remote ws/wss forwards ride the daemon /tunnel mux ("tunnel" backend),
// local UDS/TCP get a direct FE-side loopback relay ("direct" backend).
const OpenTunnelActionSchema = z
  .object({
    action: z.literal('openTunnel'),
    remotePort: TunnelPortSchema,
  })
  .strict();

const ListTunnelsActionSchema = z
  .object({
    action: z.literal('listTunnels'),
  })
  .strict();

const CloseTunnelActionSchema = z
  .object({
    action: z.literal('closeTunnel'),
    remotePort: TunnelPortSchema,
  })
  .strict();

// Union of all action schemas
const BrowserActionSchema = z.discriminatedUnion('action', [
  ListTabsActionSchema,
  FocusTabActionSchema,
  GetAccessibilityTreeActionSchema,
  ScreenshotActionSchema,
  EvaluateActionSchema,
  SnapshotActionSchema,
  StartSessionActionSchema,
  StartCaptureActionSchema,
  EndCaptureActionSchema,
  CaptureStepActionSchema,
  StartTraceActionSchema,
  StopTraceActionSchema,
  EndSessionActionSchema,
  ResetTabActionSchema,
  GetSummaryActionSchema,
  OpenTabActionSchema,
  NavigateActionSchema,
  CloseTabActionSchema,
  OpenTunnelActionSchema,
  ListTunnelsActionSchema,
  CloseTunnelActionSchema,
]);

export type BrowserAction = z.infer<typeof BrowserActionSchema>;

/**
 * Validate that a URL is safe to load in the embedded browser.
 * Uses shared protocol constants from src/shared/constants.ts.
 * Returns an error message if invalid, or null if valid.
 */
function validateBrowserUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!BROWSER_PROTOCOLS.NAVIGATION_ALLOWED.includes(parsed.protocol)) {
      // i18n-ignore (agent-facing protocol error, not user-facing)
      return `Protocol "${parsed.protocol}" is not allowed. Supported protocols: ${BROWSER_PROTOCOLS.NAVIGATION_ALLOWED.join(', ')}`;
    }
    return null;
  } catch {
    // i18n-ignore (agent-facing protocol error, not user-facing)
    return `Invalid URL: "${url}". Please provide a valid URL with one of these protocols: ${BROWSER_PROTOCOLS.NAVIGATION_ALLOWED.join(', ')}`;
  }
}

function requireWorkspaceId(workspaceId: string | undefined, action: string): string {
  if (!workspaceId) {
    throw new Error(`Action '${action}' requires workspace context`);
  }
  return workspaceId;
}

/**
 * Echo fields merged into an action's result when its URL was rewritten by
 * the loopback-hostname table (intent-hq/monorepo#2323). Empty for
 * non-rewritten URLs so their result shape is unchanged. `tunneled` adds a
 * `tunneled: true` marker when the URL was further redirected through a
 * daemon tunnel forward after a failed reachability probe.
 */
function rewriteEcho(rewrite: LoopbackRewriteResult, tunneled = false): Record<string, unknown> {
  if (!rewrite.rewritten) return {};
  return {
    ...(tunneled ? { tunneled: true } : {}),
    requestedUrl: rewrite.requestedUrl,
    finalUrl: rewrite.url,
    rewritten: true,
    reason: rewrite.reason,
    ...(rewrite.warning ? { warning: rewrite.warning } : {}),
  };
}

// Schema for the full action sequence
const ActionSequenceSchema = z.object({
  actions: z.array(BrowserActionSchema),
  tabId: z.string().optional(), // Default tabId for all actions
});

export type ActionSequence = z.infer<typeof ActionSequenceSchema>;

// ============================================================================
// Execution Result Types
// ============================================================================

export interface ActionResult {
  action: string;
  success: boolean;
  result?: unknown;
  error?: string;
  /** Successful result with a caveat (e.g. listTabs answered from a stale cache). */
  warning?: string;
}

export interface ExecutionResult {
  success: boolean;
  results: ActionResult[];
  error?: string;
}

// ============================================================================
// Action Executor
// ============================================================================

/**
 * Execute a single browser action.
 * If agentId is provided, tab leases are touched on every tab-targeting action.
 */
async function executeAction(
  action: BrowserAction,
  defaultTabId?: string,
  openTabFn?: (
    url: string,
    position?: 'adjacent' | 'replace' | 'same',
    allowDuplicate?: boolean,
  ) => { success: boolean; message: string; tabId?: string },
  agentId?: string,
  workspaceId?: string,
  getLoopbackContext?: () => LoopbackRewriteContext,
  getTunnelProvider?: () => TunnelProvider | null,
): Promise<ActionResult> {
  const tabId = ('tabId' in action ? action.tabId : undefined) || defaultTabId;

  // Touch the lease for any action that targets a specific tab
  if (tabId && agentId) {
    embeddedBrowserCdp.touchLease(tabId, agentId);
  }

  try {
    switch (action.action) {
      case 'listTabs': {
        // listAllTabs rejects when the tab list is unavailable (renderer
        // never answered and no cache) — the catch below surfaces that as an
        // action error instead of a silent empty list (monorepo#2756 RC4).
        const { tabs, stale } = await embeddedBrowserCdp.listAllTabs(workspaceId);
        if (stale) {
          return {
            action: 'listTabs',
            success: true,
            result: tabs,
            // i18n-ignore (agent-facing protocol error, not user-facing)
            warning: `The renderer did not answer the tab list request for workspace ${workspaceId}; this list is from a cached snapshot and may be outdated.`,
          };
        }
        return { action: 'listTabs', success: true, result: tabs };
      }

      case 'focusTab': {
        // Resolves true only once the tab's webview is mounted and
        // registered (bounded wait) — not merely when the focus message was
        // delivered (intent-hq/monorepo#2756).
        const result = await embeddedBrowserCdp.focusTab(tabId || '', workspaceId);
        if (!result) {
          const error = tabId
            ? `Could not focus tab ${tabId}: the tab never mounted. Either workspace ${workspaceId} is not open in any window, or no tab with this id exists — check { action: "listTabs" }.` // i18n-ignore (agent-facing protocol error, not user-facing)
            : 'focusTab requires a tabId.'; // i18n-ignore (agent-facing protocol error, not user-facing)
          return { action: 'focusTab', success: false, error };
        }
        return { action: 'focusTab', success: true, result };
      }

      case 'getAccessibilityTree': {
        const result = await embeddedBrowserCdp.getAccessibilityTree(tabId);
        return { action: 'getAccessibilityTree', success: true, result };
      }

      case 'screenshot': {
        const result = await embeddedBrowserCdp.screenshot(tabId);
        return { action: 'screenshot', success: true, result };
      }

      case 'evaluate': {
        const result = await embeddedBrowserCdp.evaluate(tabId, action.expression);
        return { action: 'evaluate', success: true, result };
      }

      case 'snapshot': {
        const captureWorkspaceId = requireWorkspaceId(workspaceId, action.action);
        const options: SnapshotOptions = {
          workspaceId: captureWorkspaceId,
          tabId,
          name: action.name,
          reload: action.reload,
          waitFor: action.waitFor,
        };
        const result = await browserCapture.snapshot(options);
        return { action: 'snapshot', success: true, result };
      }

      case 'startSession': {
        const captureWorkspaceId = requireWorkspaceId(workspaceId, action.action);
        const options: SessionOptions = {
          workspaceId: captureWorkspaceId,
          tabId,
          name: action.name,
        };
        const result = await browserCapture.startSession(options);
        return { action: 'startSession', success: true, result };
      }

      case 'startCapture': {
        await browserCapture.startCapture(
          action.sessionId,
          requireWorkspaceId(workspaceId, action.action),
        );
        return { action: 'startCapture', success: true };
      }

      case 'endCapture': {
        await browserCapture.endCapture(
          action.sessionId,
          requireWorkspaceId(workspaceId, action.action),
        );
        return { action: 'endCapture', success: true };
      }

      case 'captureStep': {
        const options: CaptureStepOptions | undefined =
          action.reload || action.waitFor
            ? { reload: action.reload, waitFor: action.waitFor }
            : undefined;
        const result = await browserCapture.captureStep(
          action.sessionId,
          requireWorkspaceId(workspaceId, action.action),
          action.stepName,
          options,
        );
        return { action: 'captureStep', success: true, result };
      }

      case 'startTrace': {
        const result = await browserCapture.startTrace(
          action.sessionId,
          requireWorkspaceId(workspaceId, action.action),
          action.traceName,
        );
        return { action: 'startTrace', success: true, result };
      }

      case 'stopTrace': {
        const result = await browserCapture.stopTrace(
          action.sessionId,
          requireWorkspaceId(workspaceId, action.action),
          action.traceName,
        );
        return { action: 'stopTrace', success: true, result };
      }

      case 'endSession': {
        const result = await browserCapture.endSession(
          action.sessionId,
          requireWorkspaceId(workspaceId, action.action),
        );
        return { action: 'endSession', success: true, result };
      }

      case 'resetTab': {
        const result = await browserCapture.resetTab(tabId, workspaceId);
        return { action: 'resetTab', success: true, result };
      }

      case 'getSummary': {
        const result = await browserCapture.getSummary(
          requireWorkspaceId(workspaceId, action.action),
          action.captureId,
        );
        return { action: 'getSummary', success: true, result };
      }

      case 'openTab': {
        // Validate URL protocol before attempting to open
        const openTabUrlError = validateBrowserUrl(action.url);
        if (openTabUrlError) {
          return { action: 'openTab', success: false, error: openTabUrlError };
        }

        // Loopback-hostname rewrite (daemon.localhost / client.localhost /
        // bare loopback) — a no-op for non-loopback URLs and local daemons.
        const rewrite = rewriteLoopbackUrl(
          action.url,
          getLoopbackContext?.() ?? { daemonIsRemote: false },
        );

        // Rewritten to a remote host: verify reachability before opening a
        // tab, falling back to a daemon tunnel forward when unreachable.
        const openTabTarget = await resolveRewrittenRemoteTarget(rewrite, getTunnelProvider);
        if (openTabTarget.error) {
          return { action: 'openTab', success: false, error: openTabTarget.error };
        }
        const finalRewrite = openTabTarget.rewrite;
        const echo = rewriteEcho(finalRewrite, openTabTarget.tunneled);

        // When called by an agent, reuse an existing model-opened tab whose
        // current URL exactly matches instead of opening a duplicate
        // (intent-hq/monorepo#2541). User-opened tabs are never considered.
        if (agentId && !action.allowDuplicate) {
          const duplicateTabId = await embeddedBrowserCdp.findModelTabByExactUrl(
            finalRewrite.url,
            agentId,
            workspaceId,
          );
          if (duplicateTabId) {
            logger.info('Reusing existing model-opened tab with matching URL', {
              tabId: duplicateTabId,
              url: finalRewrite.url,
              requestedUrl: action.url,
              agentId,
            });
            const focused = await embeddedBrowserCdp.focusTab(duplicateTabId, workspaceId);
            return {
              action: 'openTab',
              success: true,
              result: {
                reused: true,
                focused,
                tabId: duplicateTabId,
                url: finalRewrite.url,
                ...echo,
              },
            };
          }
        }

        // Tunneled opens: the final URL embeds the tunnel-local forward
        // port, so if the forward was re-minted since the first open the
        // exact-URL match above can never hit. Fall back to matching the
        // lease-recorded original requested URL and re-point the tab at the
        // fresh tunnel URL (intent-hq/monorepo#2787).
        if (agentId && !action.allowDuplicate && openTabTarget.tunneled) {
          const requestedTabId = await embeddedBrowserCdp.findModelTabByRequestedUrl(
            action.url,
            agentId,
            workspaceId,
          );
          if (requestedTabId) {
            logger.info('Reusing existing model-opened tab with matching requested URL', {
              tabId: requestedTabId,
              url: finalRewrite.url,
              requestedUrl: action.url,
              agentId,
            });
            try {
              await embeddedBrowserCdp.evaluate(
                requestedTabId,
                `window.location.href = ${JSON.stringify(finalRewrite.url)}`,
              );
              const focused = await embeddedBrowserCdp.focusTab(requestedTabId, workspaceId);
              return {
                action: 'openTab',
                success: true,
                result: {
                  reused: true,
                  focused,
                  tabId: requestedTabId,
                  url: finalRewrite.url,
                  ...echo,
                },
              };
            } catch (err) {
              logger.warn('Failed to reuse requested-URL tab, falling back to opening new tab', {
                tabId: requestedTabId,
                error: (err as Error).message,
              });
              embeddedBrowserCdp.releaseLease(requestedTabId);
            }
          }
        }

        // When called by an agent, try to reuse an idle browser tab instead of opening a new one
        if (agentId && !action.allowDuplicate) {
          const idleTabId = embeddedBrowserCdp.findIdleTab(agentId);
          if (idleTabId) {
            logger.info('Reusing idle browser tab instead of opening new one', {
              tabId: idleTabId,
              url: finalRewrite.url,
              requestedUrl: action.url,
              agentId,
            });
            try {
              await embeddedBrowserCdp.evaluate(
                idleTabId,
                `window.location.href = ${JSON.stringify(finalRewrite.url)}`,
              );
              await embeddedBrowserCdp.focusTab(idleTabId, workspaceId);
              return {
                action: 'openTab',
                success: true,
                result: { reused: true, tabId: idleTabId, url: finalRewrite.url, ...echo },
              };
            } catch (err) {
              logger.warn('Failed to reuse idle tab, falling back to opening new tab', {
                tabId: idleTabId,
                error: (err as Error).message,
              });
              embeddedBrowserCdp.releaseLease(idleTabId);
            }
          }
        }

        if (!openTabFn) {
          return {
            action: 'openTab',
            success: false,
            error: 'openTab not available in this context',
          };
        }
        // With position "replace" and an existing browser tab, the renderer
        // updates that tab in place and never creates the pre-generated
        // tabId — so resolve the adoption target up front and track it
        // instead of a phantom id whose registration wait would always time
        // out. The renderer replaces the first browser tab in the workspace
        // layout, which is the first entry of the panel tab list here.
        let replaceTargetTabId: string | undefined;
        if (action.position === 'replace') {
          try {
            const { tabs } = await embeddedBrowserCdp.listAllTabs(workspaceId);
            replaceTargetTabId = tabs[0]?.tabId;
          } catch {
            // Tab list unavailable — assume the renderer creates a new tab.
          }
        }
        // For agent-driven opens the executor is the dedupe authority — it
        // already checked model-opened tabs above — so the renderer must
        // create a genuinely new tab rather than coalesce onto an equivalent
        // one (which could silently hand the agent a user-opened tab).
        const result = openTabFn(
          finalRewrite.url,
          action.position,
          agentId ? true : action.allowDuplicate,
        );
        // The id the caller can address: the adopted existing tab on a
        // replace, otherwise the pre-generated id of the new tab.
        const effectiveTabId =
          result.success && replaceTargetTabId ? replaceTargetTabId : result.tabId;
        // Lease the tab to the requesting agent right away so a repeat
        // openTab for the same URL dedupes onto it (intent-hq/monorepo#2541)
        // instead of treating it as an untouchable user-opened tab. Tunneled
        // opens also record the original requested URL, backing the
        // requested-URL dedupe fallback above (intent-hq/monorepo#2787).
        if (agentId && result.success && effectiveTabId) {
          if (openTabTarget.tunneled) {
            embeddedBrowserCdp.touchLease(effectiveTabId, agentId, action.url);
          } else {
            embeddedBrowserCdp.touchLease(effectiveTabId, agentId);
          }
        }
        // Await the renderer's registration of the tab so the returned
        // handle is immediately addressable — returning before the webview
        // mounts made follow-up actions fail with "not found" (RC3,
        // intent-hq/monorepo#2756). Bounded wait; a timeout fails the
        // action truthfully instead of handing back an unusable id.
        if (result.success && effectiveTabId) {
          const registered = await embeddedBrowserCdp.waitForTabRegistration(effectiveTabId);
          if (!registered) {
            return {
              action: 'openTab',
              success: false,
              result: { ...result, tabId: effectiveTabId, ...echo },
              // i18n-ignore (agent-facing protocol error, not user-facing)
              error: `Tab ${effectiveTabId} was requested but its webview did not mount in time. The page may be very slow to load — retry with { action: "focusTab", tabId: "${effectiveTabId}" } or check { action: "listTabs" }.`,
            };
          }
        }
        return {
          action: 'openTab',
          success: result.success,
          result: {
            ...result,
            ...(effectiveTabId ? { tabId: effectiveTabId } : {}),
            ...(result.success && replaceTargetTabId ? { replaced: true } : {}),
            ...echo,
          },
          // Surface the failure message (e.g. "workspace not open in any
          // window", intent-hq/monorepo#2602) as the action error so the
          // sequence-level error is descriptive instead of "undefined".
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case 'closeTab': {
        // Explicit action.tabId only — never the sequence-level default (see schema note).
        const result = await embeddedBrowserCdp.closeTab(action.tabId, workspaceId);
        return { action: 'closeTab', success: true, result };
      }

      case 'navigate': {
        // Validate URL protocol before attempting to navigate
        const navUrlError = validateBrowserUrl(action.url);
        if (navUrlError) {
          return { action: 'navigate', success: false, error: navUrlError };
        }

        // Resolve the target tab: explicit tabId > sequence-level default > first available tab
        const resolvedTabId = tabId ?? embeddedBrowserCdp.getFirstTab()?.tabId;
        if (!resolvedTabId) {
          return {
            action: 'navigate',
            success: false,
            // i18n-ignore (agent-facing protocol error, not user-facing)
            error:
              'No browser tabs available. Use { action: "openTab", url: "..." } to open a tab first.',
          };
        }

        // Loopback-hostname rewrite (daemon.localhost / client.localhost /
        // bare loopback) — a no-op for non-loopback URLs and local daemons.
        const rewrite = rewriteLoopbackUrl(
          action.url,
          getLoopbackContext?.() ?? { daemonIsRemote: false },
        );

        // Rewritten to a remote host: verify reachability before navigating,
        // falling back to a daemon tunnel forward when unreachable.
        const navigateTarget = await resolveRewrittenRemoteTarget(rewrite, getTunnelProvider);
        if (navigateTarget.error) {
          return { action: 'navigate', success: false, error: navigateTarget.error };
        }

        await embeddedBrowserCdp.evaluate(
          resolvedTabId,
          `window.location.href = ${JSON.stringify(navigateTarget.rewrite.url)}`,
        );
        return {
          action: 'navigate',
          success: true,
          result: {
            tabId: resolvedTabId,
            url: navigateTarget.rewrite.url,
            ...rewriteEcho(navigateTarget.rewrite, navigateTarget.tunneled),
          },
        };
      }

      case 'openTunnel': {
        const tunnel = getTunnelProvider?.() ?? null;
        if (!tunnel) {
          return {
            action: 'openTunnel',
            success: false,
            // i18n-ignore (agent-facing protocol error, not user-facing)
            error: 'Tunneling is not available in this context (no tunnel provider).',
          };
        }
        const backend = tunnel.backend ?? 'tunnel';
        // Best-effort echo: true when a READY forward for the port already
        // existed when the action ran. Concurrent openTunnel calls racing
        // forward creation share one forward (the providers dedupe pending
        // creates) but may each report reused: false, and a provider without
        // activeForwards always reports false — don't branch on this flag
        // for correctness, only for diagnostics.
        const reused =
          tunnel.activeForwards?.().some((f) => f.remotePort === action.remotePort) ?? false;
        const localPort = await tunnel.forwardPort(action.remotePort);
        return {
          action: 'openTunnel',
          success: true,
          result: { remotePort: action.remotePort, localPort, backend, reused },
        };
      }

      case 'listTunnels': {
        const tunnel = getTunnelProvider?.() ?? null;
        if (!tunnel) {
          return { action: 'listTunnels', success: true, result: { tunnels: [] } };
        }
        const backend = tunnel.backend ?? 'tunnel';
        const tunnels = (tunnel.activeForwards?.() ?? []).map((f) => ({ ...f, backend }));
        return { action: 'listTunnels', success: true, result: { tunnels } };
      }

      case 'closeTunnel': {
        const tunnel = getTunnelProvider?.() ?? null;
        if (!tunnel?.closeForward) {
          return {
            action: 'closeTunnel',
            success: false,
            // i18n-ignore (agent-facing protocol error, not user-facing)
            error: 'Tunneling is not available in this context (no tunnel provider).',
          };
        }
        const closed = tunnel.closeForward(action.remotePort);
        if (!closed) {
          return {
            action: 'closeTunnel',
            success: false,
            // i18n-ignore (agent-facing protocol error, not user-facing)
            error: `No active tunnel forward for remote port ${action.remotePort}. Use { action: "listTunnels" } to see active forwards.`,
          };
        }
        return {
          action: 'closeTunnel',
          success: true,
          result: { remotePort: action.remotePort, closed: true },
        };
      }

      default: {
        // TypeScript exhaustiveness check
        const _exhaustive: never = action;
        return {
          action: 'unknown',
          success: false,
          // i18n-ignore (agent-facing protocol error, not user-facing)
          error: `Unknown action: ${(_exhaustive as any).action}`,
        };
      }
    }
  } catch (error) {
    logger.error('Action execution failed', { action: action.action, error });
    return {
      action: action.action,
      success: false,
      // i18n-ignore (agent-facing protocol error, not user-facing)
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Execute a sequence of browser actions.
 *
 * Actions are executed sequentially. If any action fails, execution stops
 * and the error is returned along with results from successful actions.
 *
 * @param agentId - If provided, enables tab lease tracking and idle tab reuse
 * @param getLoopbackContext - Injectable resolver for the daemon loopback
 *   locality (see `loopback-rewrite.ts`); defaults to a local daemon, so
 *   `daemon.localhost`/`client.localhost` resolve to `127.0.0.1` and bare
 *   loopback URLs pass through unchanged
 * @param getTunnelProvider - Injectable tunnel seam for the probe-failure
 *   fallback; when absent (non-Electron contexts) an unreachable rewritten
 *   remote origin keeps failing with the explanatory probe error
 */
export async function executeActions(
  input: unknown,
  openTabFn?: (
    url: string,
    position?: 'adjacent' | 'replace' | 'same',
    allowDuplicate?: boolean,
  ) => { success: boolean; message: string; tabId?: string },
  agentId?: string,
  workspaceId?: string,
  getLoopbackContext?: () => LoopbackRewriteContext,
  getTunnelProvider?: () => TunnelProvider | null,
): Promise<ExecutionResult> {
  // Validate input against schema
  const parseResult = ActionSequenceSchema.safeParse(input);
  if (!parseResult.success) {
    logger.error('Invalid action sequence', { errors: parseResult.error.errors });
    return {
      success: false,
      results: [],
      // i18n-ignore (agent-facing protocol error, not user-facing)
      error: `Invalid action sequence: ${parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
    };
  }

  const { actions, tabId: defaultTabId } = parseResult.data;
  const results: ActionResult[] = [];

  for (const action of actions) {
    const result = await executeAction(
      action,
      defaultTabId,
      openTabFn,
      agentId,
      workspaceId,
      getLoopbackContext,
      getTunnelProvider,
    );
    results.push(result);

    if (!result.success) {
      return {
        success: false,
        results,
        error: `Action '${action.action}' failed: ${result.error}`,
      };
    }
  }

  return { success: true, results };
}
