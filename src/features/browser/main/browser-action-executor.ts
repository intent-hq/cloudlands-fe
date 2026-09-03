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
import {
  AGENT_VIEWPORT_MAX_PX,
  AGENT_VIEWPORT_MIN_PX,
  DEFAULT_AGENT_VIEWPORT,
  embeddedBrowserCdp,
} from './embedded-browser-cdp-service';
import { browserCapture } from './browser-capture-service';
import type { SnapshotOptions, SessionOptions, CaptureStepOptions } from './browser-capture-types';
import {
  rewriteLoopbackUrl,
  type LoopbackRewriteContext,
  type LoopbackRewriteResult,
} from './loopback-rewrite';
import { resolveRewrittenRemoteTarget, type TunnelProvider } from './loopback-url-resolver';
import { getWindowIdForWorkspace, getWindowIdsForWorkspace } from '../../system/main/system.ipc';

const logger = new Logger('BrowserActionExecutor');

/**
 * Registration-wait budget for the capture-path mount-on-demand
 * (intent-hq/monorepo#4103). Deliberately shorter than the service default:
 * intentd caps a browser.exec batch containing a screenshot at 20s
 * (SCREENSHOT_REVERSE_TIMEOUT), so the mount wait must leave room for the
 * CDP capture itself — otherwise a slow-but-successful mount would surface
 * as a generic transport timeout instead of a structured result.
 */
const CAPTURE_MOUNT_TIMEOUT_MS = 10_000;

// ============================================================================
// Action Schemas
// ============================================================================

const ListTabsActionSchema = z.object({
  action: z.literal('listTabs'),
  scope: z.enum(['mine', 'unclaimed', 'all']).optional(),
});

const FocusTabActionSchema = z.object({
  action: z.literal('focusTab'),
  tabId: z.string().optional(),
});

// Reveal a hidden agent-owned tab into a panel (monorepo#3045). Owner-only;
// idempotent on an already-visible tab. `focus` defaults to false: the tab is
// mounted WITHOUT being activated and without moving panel focus;
// `focus: true` reveals AND activates (and still activates when already
// visible). tabId is explicit (no sequence-level default), like claimTab: a
// reveal is a significant state change and must name its target.
const ShowTabActionSchema = z.object({
  action: z.literal('showTab'),
  tabId: z.string(),
  focus: z.boolean().optional(),
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

// Emulated viewport bounds for agent-owned tabs (monorepo#2857).
const ViewportDimensionSchema = z
  .number()
  .int()
  .min(AGENT_VIEWPORT_MIN_PX)
  .max(AGENT_VIEWPORT_MAX_PX);

const OpenTabActionSchema = z.object({
  action: z.literal('openTab'),
  // `position` only applies when a genuinely new tab is opened — when an
  // existing tab is reused (per-agent exact-URL dedupe) it is ignored and
  // the reused tab is focused in place.
  url: z.string(),
  position: z.enum(['adjacent', 'replace', 'same']).optional(),
  // Opt out of the per-agent exact-URL dedupe and always open a genuinely
  // new tab (intent-hq/monorepo#2541). Also forwarded to the renderer so
  // its own equivalent-tab dedupe doesn't coalesce the requested duplicate.
  allowDuplicate: z.boolean().optional(),
  // Pin the panel resolved by this open, including an existing reused panel.
  pin: z.boolean().optional(),
  // Emulated viewport for agent opens (monorepo#2857); omitting both
  // dimensions selects fit mode. Ignored on user
  // (agentId-less) opens, which stay native-sized and unowned. Like
  // `position`, also ignored when the per-agent exact-URL dedupe reuses an
  // existing tab — the reused tab keeps its current viewport (use resizeTab
  // to change it).
  width: ViewportDimensionSchema.optional(),
  height: ViewportDimensionSchema.optional(),
  // Agent opens are hidden by default (monorepo#3045): omitted or false
  // creates the tab in the workspace's hidden set — alive and
  // CDP-addressable offscreen, never mounted into a panel, no focus or
  // active-tab change. `visible: true` opts into today's panel-mounted
  // open — on FRESH opens only: a dedupe reuse never changes the reused
  // tab's visibility (a hidden tab stays hidden even with visible: true;
  // reveal is showTab-only). Ignored on user (agentId-less) opens, which
  // are always visible.
  visible: z.boolean().optional(),
});

// Atomically claim an unowned tab for the calling agent (monorepo#2857).
// `width` is deliberately REQUIRED: a successful claim transfers ownership
// and enables viewport emulation at the given size in one step — a claim
// without a width fails schema validation before any ownership change.
// tabId is explicit (no sequence-level default), like closeTab: a claim is
// a significant state change and must name its target.
const ClaimTabActionSchema = z.object({
  action: z.literal('claimTab'),
  tabId: z.string(),
  width: ViewportDimensionSchema,
  height: ViewportDimensionSchema.optional(),
});

// Change an owned tab's emulated viewport (docs/protocol §5.9). Omitted
// height keeps the tab's current emulated height; there is no
// reset-to-native form. tabId is explicit (no sequence-level default),
// like claimTab: a resize is a significant state change and must name its
// target.
const ResizeTabActionSchema = z.object({
  action: z.literal('resizeTab'),
  tabId: z.string(),
  width: ViewportDimensionSchema,
  height: ViewportDimensionSchema.optional(),
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
  ShowTabActionSchema,
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
  ClaimTabActionSchema,
  ResizeTabActionSchema,
  NavigateActionSchema,
  CloseTabActionSchema,
  OpenTunnelActionSchema,
  ListTunnelsActionSchema,
  CloseTunnelActionSchema,
]);

type BrowserAction = z.infer<typeof BrowserActionSchema>;

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
 * Workspace-inactive semantics (monorepo#3045): focus-bearing actions
 * (showTab with focus: true, focusTab, openTab with visible: true) still
 * succeed when no window is currently displaying the workspace — their
 * persisted-layout state effects apply (windows hosting the workspace in a
 * background tab receive the IPC) — but the renderer skips the actual UI
 * focus attempt, and the action result carries this warning so the caller
 * knows nothing was brought to the front.
 */
function workspaceNotVisibleWarning(workspaceId: string | undefined): { warning?: string } {
  if (!workspaceId || getWindowIdForWorkspace(workspaceId) !== undefined) return {};
  return {
    // i18n-ignore (agent-facing protocol warning, not user-facing)
    warning: `Workspace ${workspaceId} is not currently visible in the app, so no UI focus was attempted; the tab and layout state were still updated.`,
  };
}

/**
 * Ensure a capture op's target tab has a mounted, CDP-addressable webview,
 * mounting it on demand when possible (intent-hq/monorepo#4103).
 *
 * A tab opened while its workspace is not visible (or whose hosting window
 * never visited the workspace this session) has no mounted webview, so
 * capture ops would fail with a "not mounted" error whose focusTab guidance
 * is a dead end for hidden tabs. Requesting a fresh tab list hydrates the
 * workspace's persisted panel layout in every hosting window, which puts the
 * tab into OffscreenWebviewHost's candidate set — the webview mounts
 * offscreen and registers. The bounded registration wait below then settles
 * the outcome truthfully instead of letting the capture op hang.
 *
 * Returns `{}` to proceed unchanged (tab already mounted, or no target/
 * workspace context — the action fails with its own descriptive error), a
 * `warning` to merge into the success result when the tab was mounted on
 * demand for a not-visible workspace, or a structured `failure` result when
 * the mount is impossible (workspace open nowhere, tab gone, or the webview
 * never registered).
 */
async function ensureCaptureTabMounted(
  actionName: string,
  tabId: string | undefined,
  workspaceId: string | undefined,
): Promise<{ failure?: ActionResult; warning?: string }> {
  if (!tabId || !workspaceId || embeddedBrowserCdp.isTabMounted(tabId)) return {};

  let listed: Awaited<ReturnType<typeof embeddedBrowserCdp.listAllTabs>>;
  try {
    listed = await embeddedBrowserCdp.listAllTabs(workspaceId);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const notVisible = getWindowIdForWorkspace(workspaceId) === undefined;
    return {
      failure: {
        action: actionName,
        success: false,
        ...(notVisible ? { errorCode: 'workspace-not-visible' as const } : {}),
        // i18n-ignore (agent-facing protocol error, not user-facing)
        error: `Cannot run '${actionName}' on tab ${tabId}: the tab has no mounted webview and it cannot be mounted on demand (${detail}). Open workspace ${workspaceId} in a window and retry.`,
      },
    };
  }
  if (!listed.stale && !listed.tabs.some((t) => t.tabId === tabId)) {
    return {
      failure: {
        action: actionName,
        success: false,
        // i18n-ignore (agent-facing protocol error, not user-facing)
        error: `Tab ${tabId} not found in workspace ${workspaceId} — check { action: "listTabs" }.`,
      },
    };
  }
  // A stale (cached) list with no window hosting the workspace means the
  // hydration nudge reached no renderer — a mount can never happen, so fail
  // fast instead of burning the full registration wait.
  if (listed.stale && getWindowIdsForWorkspace(workspaceId).length === 0) {
    return {
      failure: {
        action: actionName,
        success: false,
        errorCode: 'workspace-not-visible' as const,
        // i18n-ignore (agent-facing protocol error, not user-facing)
        error: `Cannot run '${actionName}' on tab ${tabId}: the tab has no mounted webview and workspace ${workspaceId} is not open in any window, so it cannot be mounted on demand. Open the workspace in a window and retry.`,
      },
    };
  }

  // The tab-list request hydrated the layout; the offscreen host mounts the
  // tab and its registerTab settles this bounded wait (never rejects).
  const mounted = await embeddedBrowserCdp.waitForTabRegistration(tabId, CAPTURE_MOUNT_TIMEOUT_MS);
  if (!mounted) {
    const notVisible = getWindowIdForWorkspace(workspaceId) === undefined;
    return {
      failure: {
        action: actionName,
        success: false,
        ...(notVisible ? { errorCode: 'workspace-not-visible' as const } : {}),
        error: notVisible
          ? `Cannot run '${actionName}' on tab ${tabId}: the tab's webview did not mount within the wait budget (workspace ${workspaceId} is not visible in the app and the offscreen mount did not complete). Retry shortly, or use { action: "listTabs" } to verify the tab still exists.` // i18n-ignore (agent-facing protocol error, not user-facing)
          : `Cannot run '${actionName}' on tab ${tabId}: the tab's webview did not mount within the wait budget. Use { action: "focusTab", tabId: "${tabId}" } to mount it, or { action: "listTabs" } to verify the tab still exists.`, // i18n-ignore (agent-facing protocol error, not user-facing)
      },
    };
  }
  // Mounted on demand: when the workspace is not displayed, surface the
  // standard not-visible caveat so the caller knows the capture ran against
  // an offscreen webview (a hidden tab in a displayed workspace mounts with
  // no warning).
  return { ...workspaceNotVisibleWarning(workspaceId) };
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

// ============================================================================
// Execution Result Types
// ============================================================================

interface ActionResult {
  action: string;
  success: boolean;
  result?: unknown;
  error?: string;
  /** Successful result with a caveat (e.g. listTabs answered from a stale cache). */
  warning?: string;
  /**
   * Structured error code: ownership errors (monorepo#2857), or a capture op
   * whose target tab could not be mounted because its workspace is not
   * visible in the app (monorepo#4103).
   */
  errorCode?: 'not-owner' | 'already-claimed' | 'workspace-not-visible';
  /** Owning agent for ownership errors; null when the tab is unowned. */
  ownerAgentId?: string | null;
  /** Owning agent's display name for ownership errors, when resolvable. */
  ownerAgentName?: string;
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
 * Actions that manipulate a specific tab and are therefore ownership-enforced
 * for agent callers (monorepo#2857). `openTab` (creates/reuses own tabs),
 * `claimTab` (the claiming op itself), `listTabs`, and the session/tunnel
 * actions (scoped at session start / tab-free) are deliberately absent.
 * `showTab` (monorepo#3045) enforces ownership in its own handler so an
 * unknown tabId reports "not found" instead of a misleading not-owner error.
 */
const OWNERSHIP_ENFORCED_ACTIONS = new Set([
  'focusTab',
  'getAccessibilityTree',
  'screenshot',
  'evaluate',
  'snapshot',
  'startSession',
  'resetTab',
  'resizeTab',
  'navigate',
  'closeTab',
]);

/**
 * Per-`executeActions` memo of the `agent.list` owner-name lookup, keyed by
 * workspace and single-flight (a shared in-flight promise), so a multi-action
 * batch costs at most one round-trip instead of one per action.
 */
type OwnerNameCache = Map<string, Promise<Map<string, string>>>;

/**
 * Best-effort bulk owner display-name lookup via the daemon's `agent.list`
 * (PROTOCOL.md §5.5) — one request resolves every owner in a tab list.
 * Dynamic import (mirroring browser-exec-reverse) avoids a static
 * main-process dependency cycle and keeps the executor unit-testable; any
 * failure resolves an empty map — callers still carry the owner ids.
 */
async function resolveAgentDisplayNames(
  workspaceId?: string,
  cache?: OwnerNameCache,
): Promise<Map<string, string>> {
  if (!workspaceId) return new Map();
  const cached = cache?.get(workspaceId);
  if (cached) return cached;
  const pending = fetchAgentDisplayNames(workspaceId);
  cache?.set(workspaceId, pending);
  return pending;
}

async function fetchAgentDisplayNames(workspaceId: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    const { getBackendClient } = await import('../../backend/main/backend.ipc');
    const result = (await getBackendClient().request('agent.list', { workspaceId })) as
      { agents?: Array<{ id?: string; name?: string }> } | undefined;
    for (const agent of result?.agents ?? []) {
      if (typeof agent.id === 'string' && typeof agent.name === 'string' && agent.name.length > 0) {
        names.set(agent.id, agent.name);
      }
    }
  } catch {
    // best-effort — fall through with whatever resolved
  }
  return names;
}

/**
 * Best-effort owner display-name lookup for a single agent, so ownership
 * errors can name the owner.
 */
async function resolveAgentDisplayName(
  agentId: string,
  workspaceId?: string,
  cache?: OwnerNameCache,
): Promise<string | undefined> {
  return (await resolveAgentDisplayNames(workspaceId, cache)).get(agentId);
}

/**
 * Structured `not-owner` result for an agent action on a tab it does not own
 * (monorepo#2857). `ownerAgentId` is null for unowned (user) tabs.
 */
async function notOwnerResult(
  actionName: string,
  tabId: string,
  ownerAgentId: string | undefined,
  workspaceId?: string,
  ownerNameCache?: OwnerNameCache,
): Promise<ActionResult> {
  const ownerAgentName = ownerAgentId
    ? await resolveAgentDisplayName(ownerAgentId, workspaceId, ownerNameCache)
    : undefined;
  const ownerLabel = ownerAgentName ? `${ownerAgentName} (${ownerAgentId})` : ownerAgentId;
  let error: string;
  if (ownerAgentId) {
    // i18n-ignore (agent-facing protocol error, not user-facing)
    error = `Tab ${tabId} is owned by agent ${ownerLabel}. Agents may only manipulate tabs they own — use { action: "listTabs" } to see tabs and their owners, or open your own tab with { action: "openTab" }.`;
  } else {
    // i18n-ignore (agent-facing protocol error, not user-facing)
    error = `Tab ${tabId} is not owned by you (it is unowned). Claim it first with { action: "claimTab", tabId: "${tabId}", width: <px> } or open your own tab with { action: "openTab" }.`;
  }
  return {
    action: actionName,
    success: false,
    errorCode: 'not-owner',
    ownerAgentId: ownerAgentId ?? null,
    ...(ownerAgentName !== undefined ? { ownerAgentName } : {}),
    error,
  };
}

/**
 * Execute a single browser action.
 * Agent callers (agentId present) are ownership-enforced: tab-manipulating
 * actions on tabs the agent does not own fail with a structured `not-owner`
 * error. Calls without agentId are the user and are unrestricted
 * (monorepo#2857).
 */
async function executeAction(
  action: BrowserAction,
  defaultTabId?: string,
  openTabFn?: (
    url: string,
    position?: 'adjacent' | 'replace' | 'same',
    allowDuplicate?: boolean,
    requestedUrl?: string,
    pin?: boolean,
    ownerAgentId?: string,
    replaceTabId?: string,
    emulatedSize?: { width: number; height: number },
    visible?: boolean,
    ownerAgentName?: string,
  ) => { success: boolean; message: string; tabId?: string },
  agentId?: string,
  workspaceId?: string,
  getLoopbackContext?: () => LoopbackRewriteContext,
  getTunnelProvider?: () => TunnelProvider | null,
  ownerNameCache?: OwnerNameCache,
): Promise<ActionResult> {
  const tabId = ('tabId' in action ? action.tabId : undefined) || defaultTabId;

  // Ownership enforcement (monorepo#2857): resolve the tab the action will
  // actually hit — including the first-tab fallback the underlying service
  // methods apply — and reject agent calls on tabs the agent does not own.
  // A missing target falls through so the action fails with its own
  // descriptive "no tabs" error.
  if (agentId && OWNERSHIP_ENFORCED_ACTIONS.has(action.action)) {
    const targetTabId = tabId ?? embeddedBrowserCdp.getFirstTab()?.tabId;
    if (targetTabId) {
      const owner = await embeddedBrowserCdp.resolveTabOwner(targetTabId, workspaceId);
      if (owner !== agentId) {
        return notOwnerResult(action.action, targetTabId, owner, workspaceId, ownerNameCache);
      }
    }
  }

  try {
    switch (action.action) {
      case 'listTabs': {
        const scope = action.scope ?? 'all';
        if (scope === 'mine' && !agentId) {
          return {
            action: 'listTabs',
            success: false,
            // i18n-ignore (agent-facing protocol error, not user-facing)
            error: `listTabs scope "mine" requires an agent caller (agentId), but this call carries none — user calls have no owned tabs. Use scope "all" or "unclaimed" instead.`,
          };
        }
        // listAllTabs rejects when the tab list is unavailable (renderer
        // never answered and no cache) — the catch below surfaces that as an
        // action error instead of a silent empty list (monorepo#2756 RC4).
        const { tabs, stale } = await embeddedBrowserCdp.listAllTabs(workspaceId);
        const scoped =
          scope === 'mine'
            ? tabs.filter((t) => t.ownerAgentId === agentId)
            : scope === 'unclaimed'
              ? tabs.filter((t) => !t.ownerAgentId)
              : tabs;
        // Owner display info + effective sizing per §5.9: ownerAgentId is
        // nullable (null = unowned), fit user tabs are native, and fixed or
        // owned tabs are emulated. One bulk agent.list resolves every owner's
        // display name; best-effort — unresolvable owners keep their id.
        const ownerNames = scoped.some((t) => t.ownerAgentId)
          ? await resolveAgentDisplayNames(workspaceId, ownerNameCache)
          : new Map<string, string>();
        const result = scoped.map(({ emulatedSize, viewport, hidden, ...tab }) => {
          const ownerAgentId = tab.ownerAgentId ?? null;
          const ownerAgentName = ownerAgentId ? ownerNames.get(ownerAgentId) : undefined;
          const effectiveSize = embeddedBrowserCdp.getTabEffectiveViewportSize(tab.tabId);
          const fixedViewportSize = viewport && viewport.mode !== 'fit' ? viewport : undefined;
          const fallbackSize = ownerAgentId
            ? (emulatedSize ?? DEFAULT_AGENT_VIEWPORT)
            : fixedViewportSize;
          const size = effectiveSize ?? fallbackSize;
          return {
            ...tab,
            ownerAgentId,
            ...(ownerAgentName !== undefined ? { ownerAgentName } : {}),
            ...(size
              ? { mode: 'emulated' as const, width: size.width, height: size.height }
              : { mode: 'native' as const }),
            // Hidden is an agent-owned-tab state only (monorepo#3045):
            // unowned (user) tabs are always visible.
            visibility:
              ownerAgentId && hidden === true ? ('hidden' as const) : ('visible' as const),
          };
        });
        if (stale) {
          return {
            action: 'listTabs',
            success: true,
            result,
            // i18n-ignore (agent-facing protocol error, not user-facing)
            warning: `The renderer did not answer the tab list request for workspace ${workspaceId}; this list is from a cached snapshot and may be outdated.`,
          };
        }
        return { action: 'listTabs', success: true, result };
      }

      case 'focusTab': {
        // focusTab never reveals a hidden tab (monorepo#3045): reveal is
        // showTab-only, so a hidden target fails with a directive error.
        // Best-effort guard — an unavailable/stale tab list cannot prove
        // hiddenness, so the focus proceeds as before.
        if (tabId) {
          try {
            const { tabs, stale } = await embeddedBrowserCdp.listAllTabs(workspaceId);
            if (!stale && tabs.some((t) => t.tabId === tabId && t.hidden === true)) {
              return {
                action: 'focusTab',
                success: false,
                // i18n-ignore (agent-facing protocol error, not user-facing)
                error: `Tab ${tabId} is hidden — focusTab does not reveal hidden tabs. Use { action: "showTab", tabId: "${tabId}", focus: true } to reveal and activate it.`,
              };
            }
          } catch {
            // Tab list unavailable — fall through to the focus attempt.
          }
        }
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
        return {
          action: 'focusTab',
          success: true,
          result,
          ...workspaceNotVisibleWarning(workspaceId),
        };
      }

      case 'showTab': {
        // Reveal a hidden agent-owned tab (monorepo#3045). Checks run
        // existence-first against a fresh tab list so an unknown tabId
        // reports "not found" (never a misleading not-owner error), then
        // owner-only enforcement for agent callers.
        const { tabs, stale } = await embeddedBrowserCdp.listAllTabs(workspaceId);
        const target = tabs.find((t) => t.tabId === action.tabId);
        if (!target || stale) {
          return {
            action: 'showTab',
            success: false,
            error: stale
              ? `Cannot show tab ${action.tabId}: the tab list for workspace ${workspaceId} could not be refreshed (renderer unavailable), so the tab's existence cannot be verified. Retry shortly.` // i18n-ignore (agent-facing protocol error, not user-facing)
              : `Tab ${action.tabId} not found in workspace ${workspaceId} — check { action: "listTabs" }.`, // i18n-ignore (agent-facing protocol error, not user-facing)
          };
        }
        if (agentId && target.ownerAgentId !== agentId) {
          return notOwnerResult(
            'showTab',
            action.tabId,
            target.ownerAgentId,
            workspaceId,
            ownerNameCache,
          );
        }
        const focus = action.focus === true;
        if (target.hidden !== true && !focus) {
          // Idempotent no-op: the tab is already visible and no activation
          // was requested.
          return {
            action: 'showTab',
            success: true,
            result: { tabId: action.tabId, visibility: 'visible', focused: false },
          };
        }
        await embeddedBrowserCdp.showTab(action.tabId, workspaceId, focus);
        return {
          action: 'showTab',
          success: true,
          result: { tabId: action.tabId, visibility: 'visible', focused: focus },
          // A focus-bearing reveal on a not-visible workspace applies its
          // layout-state effects but attempts no UI focus (monorepo#3045).
          ...(focus ? workspaceNotVisibleWarning(workspaceId) : {}),
        };
      }

      case 'getAccessibilityTree': {
        const mount = await ensureCaptureTabMounted(action.action, tabId, workspaceId);
        if (mount.failure) return mount.failure;
        const result = await embeddedBrowserCdp.getAccessibilityTree(tabId);
        return {
          action: 'getAccessibilityTree',
          success: true,
          result,
          ...(mount.warning ? { warning: mount.warning } : {}),
        };
      }

      case 'screenshot': {
        const mount = await ensureCaptureTabMounted(action.action, tabId, workspaceId);
        if (mount.failure) return mount.failure;
        const result = await embeddedBrowserCdp.screenshot(tabId);
        return {
          action: 'screenshot',
          success: true,
          result,
          ...(mount.warning ? { warning: mount.warning } : {}),
        };
      }

      case 'evaluate': {
        const mount = await ensureCaptureTabMounted(action.action, tabId, workspaceId);
        if (mount.failure) return mount.failure;
        const result = await embeddedBrowserCdp.evaluate(tabId, action.expression);
        return {
          action: 'evaluate',
          success: true,
          result,
          ...(mount.warning ? { warning: mount.warning } : {}),
        };
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

        // When called by an agent, reuse one of the AGENT'S OWN tabs whose
        // current URL exactly matches instead of opening a duplicate
        // (intent-hq/monorepo#2541). Dedupe is strictly per-agent
        // (monorepo#2857): other agents' and user-opened tabs are never
        // considered — across agents a new tab is opened. Hidden tabs are
        // candidates too (both finders match on the live webview, and hidden
        // owned tabs stay mounted offscreen). A dedupe hit is a PURE reuse
        // with no visibility side effect (monorepo#3045): a hidden tab stays
        // hidden EVEN WHEN the open carried visible: true, and a visible tab
        // stays visible — revealing an existing tab is showTab-only, so the
        // reuse paths never focus. `visible` affects fresh opens only.
        if (agentId && !action.allowDuplicate) {
          const duplicateTabId = await embeddedBrowserCdp.findModelTabByExactUrl(
            finalRewrite.url,
            agentId,
            workspaceId,
          );
          if (duplicateTabId) {
            logger.info('Reusing own tab with matching URL', {
              tabId: duplicateTabId,
              url: finalRewrite.url,
              requestedUrl: action.url,
              agentId,
            });
            // Re-record the ownership identity for this open: tunneled opens
            // set the requested URL backing the requested-URL dedupe fallback
            // below; non-tunneled opens clear any stale identity from the
            // tab's prior use (intent-hq/monorepo#2787).
            embeddedBrowserCdp.setTabOwner(
              duplicateTabId,
              agentId,
              openTabTarget.tunneled ? action.url : null,
            );
            // No focus: the reused tab is already mounted (the finder only
            // returns mounted tabs — hidden ones offscreen), so it stays
            // addressable without any focus/reveal.
            return {
              action: 'openTab',
              success: true,
              result: {
                reused: true,
                focused: false,
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
        // ownership-recorded original requested URL and re-point the tab at
        // the fresh tunnel URL (intent-hq/monorepo#2787).
        if (agentId && !action.allowDuplicate && openTabTarget.tunneled) {
          const requestedTabId = await embeddedBrowserCdp.findModelTabByRequestedUrl(
            action.url,
            agentId,
            workspaceId,
          );
          if (requestedTabId) {
            logger.info('Reusing own tab with matching requested URL', {
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
              // Persist the navigated tab's new URL + requested URL in the
              // panel layout so a restart re-runs the rewrite (monorepo#2789).
              embeddedBrowserCdp.notifyTabNavigated(
                requestedTabId,
                workspaceId,
                finalRewrite.url,
                finalRewrite.rewritten ? finalRewrite.requestedUrl : undefined,
              );
              // Like the exact-URL reuse above: a pure reuse with no
              // visibility side effect — never focus, even on visible: true
              // (reveal is showTab-only, monorepo#3045).
              return {
                action: 'openTab',
                success: true,
                result: {
                  reused: true,
                  focused: false,
                  tabId: requestedTabId,
                  url: finalRewrite.url,
                  ...echo,
                },
              };
            } catch (err) {
              // The tab stays owned by the agent (ownership is persistent);
              // this open just falls through to creating a new tab.
              logger.warn('Failed to reuse requested-URL tab, falling back to opening new tab', {
                tabId: requestedTabId,
                error: (err as Error).message,
              });
            }
          }
        }

        // NOTE: the former 3-minute idle-lease reuse (repurposing another
        // agent's inactive tab) is gone — ownership is persistent and tabs
        // are never transferred between agents (monorepo#2857).

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
          // A replace adopts an existing tab, which is a manipulation of that
          // tab — agents may only replace tabs they own (monorepo#2857).
          // The checked target is bound into the open payload below
          // (replaceTabId) so the renderer replaces exactly this tab — a
          // layout change between this check and the renderer handling the
          // open cannot redirect the replace onto a different (possibly
          // other-agent-owned) tab.
          if (agentId && replaceTargetTabId) {
            const owner = await embeddedBrowserCdp.resolveTabOwner(replaceTargetTabId, workspaceId);
            if (owner !== agentId) {
              return notOwnerResult(
                'openTab',
                replaceTargetTabId,
                owner,
                workspaceId,
                ownerNameCache,
              );
            }
          }
        }
        // For agent-driven opens the executor is the dedupe authority — it
        // already checked the agent's own tabs above — so the renderer must
        // create a genuinely new tab rather than coalesce onto an equivalent
        // one (which could silently hand the agent a user-opened tab).
        // Rewritten opens pass the original requested URL so the renderer
        // persists it with the tab and a restart can re-run the rewrite
        // (intent-hq/monorepo#2789). Agent opens pass the owner and, when
        // explicitly requested, a custom viewport so the renderer persists
        // the mode and a restart rehydrates it (monorepo#2857).
        // The resolved replace target (when any) is bound into the payload
        // so the renderer adopts exactly the checked tab (TOCTOU, #2857).
        const emulatedSize =
          agentId && (action.width !== undefined || action.height !== undefined)
            ? {
                width: action.width ?? DEFAULT_AGENT_VIEWPORT.width,
                height: action.height ?? DEFAULT_AGENT_VIEWPORT.height,
              }
            : undefined;
        // Agent opens are hidden by default (monorepo#3045): without an
        // explicit visible: true the tab is created straight into the
        // workspace's hidden set (offscreen webview, no panel mount, no
        // focus). User (agentId-less) opens are always visible and never
        // carry the flag.
        const visible = agentId ? action.visible === true : undefined;
        // Owner display name for agent opens (monorepo#3438), best-effort:
        // persisted with the tab so the sidebar owner group can label it
        // without an agent-store lookup.
        const openOwnerName = agentId
          ? await resolveAgentDisplayName(agentId, workspaceId, ownerNameCache)
          : undefined;
        // The short call form is for user (agentId-less) opens only. Agent
        // opens take the long form even in fit mode so `visible` rides through.
        const result =
          agentId === undefined && replaceTargetTabId === undefined && emulatedSize === undefined
            ? openTabFn(
                finalRewrite.url,
                action.position,
                agentId ? true : action.allowDuplicate,
                finalRewrite.rewritten ? finalRewrite.requestedUrl : undefined,
                action.pin,
                agentId,
              )
            : openTabFn(
                finalRewrite.url,
                action.position,
                agentId ? true : action.allowDuplicate,
                finalRewrite.rewritten ? finalRewrite.requestedUrl : undefined,
                action.pin,
                agentId,
                replaceTargetTabId,
                emulatedSize,
                visible,
                openOwnerName,
              );
        // The id the caller can address: the adopted existing tab on a
        // replace, otherwise the pre-generated id of the new tab.
        const effectiveTabId =
          result.success && replaceTargetTabId ? replaceTargetTabId : result.tabId;
        // Agent opens create owned, viewport-emulated tabs (monorepo#2857):
        // record ownership right away — a repeat openTab for the same URL
        // then dedupes onto it (intent-hq/monorepo#2541) — with the emulated
        // optional custom size (omitting both dimensions selects fit mode).
        // Tunneled opens record the original requested URL,
        // backing the requested-URL dedupe fallback above; non-tunneled
        // opens clear any stale identity (a replace-position open adopts an
        // existing tab whose record may carry one) (intent-hq/monorepo#2787).
        // The renderer persists the owner from the open payload; main's
        // registry is seeded here.
        if (agentId && result.success && effectiveTabId) {
          embeddedBrowserCdp.setTabOwner(
            effectiveTabId,
            agentId,
            openTabTarget.tunneled ? action.url : null,
            emulatedSize,
          );
          // A replace adopted an existing tab the renderer never saw an
          // ownerAgentId open-payload for — sync it so the layout persists
          // the ownership (monorepo#2857).
          if (replaceTargetTabId) {
            embeddedBrowserCdp.notifyTabOwnerChanged(
              effectiveTabId,
              workspaceId,
              agentId,
              openOwnerName,
            );
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
          // A visible (panel-mounted) agent open on a not-visible workspace
          // applies its layout-state effects but attempts no UI focus
          // (monorepo#3045).
          ...(result.success && visible === true ? workspaceNotVisibleWarning(workspaceId) : {}),
        };
      }

      case 'claimTab': {
        // Atomically claim an unowned tab for the calling agent
        // (monorepo#2857). Schema validation already rejected claims without
        // a width, before any ownership change.
        if (!agentId) {
          return {
            action: 'claimTab',
            success: false,
            error:
              // i18n-ignore (agent-facing protocol error, not user-facing)
              'claimTab requires an agent caller: user-initiated calls are unrestricted and never need to claim a tab.',
          };
        }
        // Verify the tab exists in the requesting workspace's panel layout
        // (also hydrates persisted ownership after a restart). The
        // check-and-set inside claimTab stays synchronous, so a competing
        // claim cannot interleave after this point. A stale (cached) tab
        // list is not proof the tab still exists — the tab may have been
        // closed while the renderer was unavailable — so a claim must not
        // record ownership from it; the persistence event would be a no-op
        // and the "claimed" tab may be gone.
        const { tabs, stale } = await embeddedBrowserCdp.listAllTabs(workspaceId);
        if (stale) {
          return {
            action: 'claimTab',
            success: false,
            // i18n-ignore (agent-facing protocol error, not user-facing)
            error: `Cannot claim tab ${action.tabId}: the tab list for workspace ${workspaceId} could not be refreshed (renderer unavailable), so the tab's existence cannot be verified. Retry shortly.`,
          };
        }
        if (!tabs.some((t) => t.tabId === action.tabId)) {
          return {
            action: 'claimTab',
            success: false,
            // i18n-ignore (agent-facing protocol error, not user-facing)
            error: `Tab ${action.tabId} not found in workspace ${workspaceId} — check { action: "listTabs" }.`,
          };
        }
        const size = {
          width: action.width,
          height: action.height ?? DEFAULT_AGENT_VIEWPORT.height,
        };
        const claim = embeddedBrowserCdp.claimTab(action.tabId, agentId, size);
        if (claim.status === 'already-claimed') {
          const ownerAgentName = await resolveAgentDisplayName(
            claim.ownerAgentId,
            workspaceId,
            ownerNameCache,
          );
          const ownerLabel = ownerAgentName
            ? `${ownerAgentName} (${claim.ownerAgentId})`
            : claim.ownerAgentId;
          return {
            action: 'claimTab',
            success: false,
            errorCode: 'already-claimed',
            ownerAgentId: claim.ownerAgentId,
            ...(ownerAgentName !== undefined ? { ownerAgentName } : {}),
            // i18n-ignore (agent-facing protocol error, not user-facing)
            error: `Tab ${action.tabId} is already claimed by agent ${ownerLabel}. Claims are first-claim-wins with no stealing — open your own tab with { action: "openTab" }.`,
          };
        }
        // Persist the new owner on the panel-layout tab so ownership
        // survives restart (monorepo#2857), with the owner's display name
        // (best-effort) for the sidebar owner group (monorepo#3438).
        embeddedBrowserCdp.notifyTabOwnerChanged(
          action.tabId,
          workspaceId,
          agentId,
          await resolveAgentDisplayName(agentId, workspaceId, ownerNameCache),
        );
        return {
          action: 'claimTab',
          success: true,
          result: {
            tabId: action.tabId,
            ownerAgentId: agentId,
            alreadyOwned: claim.alreadyOwned,
            ...size,
          },
        };
      }

      case 'resizeTab': {
        // Ownership enforcement above already rejected agent calls on tabs
        // the agent does not own. What remains: only agent-owned tabs are
        // emulated and resizable — unowned (user) tabs are always native
        // with no size op (docs/protocol §5.9), which a user-initiated
        // (agentId-less) call can still reach.
        const size = embeddedBrowserCdp.resizeTab(action.tabId, action.width, action.height);
        if (!size) {
          return {
            action: 'resizeTab',
            success: false,
            // i18n-ignore (agent-facing protocol error, not user-facing)
            error: `Tab ${action.tabId} is not agent-owned, so it has no emulated viewport to resize — unowned (user) tabs are always native. Claim it first with { action: "claimTab", tabId: "${action.tabId}", width: <px> }.`,
          };
        }
        // Persist the new size on the panel-layout tab so it survives
        // restart alongside the owner, keeping the renderer's record of the
        // emulated size live for the UI (monorepo#2857). The tab is owned
        // (resizeTab just succeeded), so an owner is always present.
        const sizeOwner = embeddedBrowserCdp.getTabOwner(action.tabId);
        if (sizeOwner) {
          embeddedBrowserCdp.notifyTabOwnerChanged(action.tabId, workspaceId, sizeOwner);
        }
        return {
          action: 'resizeTab',
          success: true,
          result: { tabId: action.tabId, ...size },
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
            error:
              // i18n-ignore (agent-facing protocol error, not user-facing)
              'No browser tabs available. Use { action: "openTab", url: "..." } to open a tab first.',
          };
        }

        // Navigate runs through evaluate(), so it needs a mounted webview too
        // (intent-hq/monorepo#4103).
        const mount = await ensureCaptureTabMounted(action.action, resolvedTabId, workspaceId);
        if (mount.failure) return mount.failure;

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
        // Persist the navigated tab's new URL + requested URL in the panel
        // layout so a restart re-runs the rewrite instead of restoring a
        // dead ephemeral forward port (monorepo#2789).
        embeddedBrowserCdp.notifyTabNavigated(
          resolvedTabId,
          workspaceId,
          navigateTarget.rewrite.url,
          navigateTarget.rewrite.rewritten ? navigateTarget.rewrite.requestedUrl : undefined,
        );
        // The tab's content changed, so refresh its ownership identity:
        // tunneled navigations record the requested URL (a later openTab for
        // it can dedupe onto this tab), non-tunneled ones clear any stale
        // identity — otherwise a later tunneled openTab for the tab's OLD
        // requested URL could match it and navigate away from the new page
        // (intent-hq/monorepo#2787). The enforcement gate above guarantees
        // the agent already owns this tab.
        if (agentId) {
          embeddedBrowserCdp.setTabOwner(
            resolvedTabId,
            agentId,
            navigateTarget.tunneled ? action.url : null,
          );
        }
        return {
          action: 'navigate',
          success: true,
          result: {
            tabId: resolvedTabId,
            url: navigateTarget.rewrite.url,
            ...rewriteEcho(navigateTarget.rewrite, navigateTarget.tunneled),
          },
          ...(mount.warning ? { warning: mount.warning } : {}),
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
    requestedUrl?: string,
    pin?: boolean,
    ownerAgentId?: string,
    replaceTabId?: string,
    emulatedSize?: { width: number; height: number },
    visible?: boolean,
    ownerAgentName?: string,
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
  // Owner display names are resolved at most once per batch — a multi-action
  // sequence (e.g. N openTabs) shares one agent.list round-trip.
  const ownerNameCache: OwnerNameCache = new Map();

  for (const action of actions) {
    const result = await executeAction(
      action,
      defaultTabId,
      openTabFn,
      agentId,
      workspaceId,
      getLoopbackContext,
      getTunnelProvider,
      ownerNameCache,
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
