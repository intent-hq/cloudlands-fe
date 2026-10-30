/**
 * Whether the OffscreenWebviewHost keeps a browser tab's guest mounted, and
 * if not, why (intent-hq/intent#7855). Pure so the OffscreenWebviewHost, its diagnostics and
 * the registration-timeout dump all read the same decision.
 */
import { BROWSER_PROTOCOLS } from '$shared/constants';
import type { PanelTab, WorkspacePanelLayoutState } from './panel-layout-types';

/** Why a browser tab gets no offscreen guest. */
type OffscreenSkipReason =
  /** Not a browser tab. */
  | 'not-browser'
  /** A visible panel tab of the workspace this window displays: its panel renders it. */
  | 'workspace-displayed'
  /** A mounted panel webview holds the tab's lease and owns its guest. */
  | 'claimed-by-panel'
  /** No URL to load (e.g. a registry-hosted shell restored without its URL). */
  | 'no-url'
  /** A URL the embedded browser does not navigate to. */
  | 'url-not-loadable'
  /** The registry homes the tab on another client (or this client's id is unknown). */
  | 'hosted-elsewhere';

export type OffscreenEligibility =
  { eligible: true } | { eligible: false; reason: OffscreenSkipReason };

type OffscreenTabPlacement = 'panel' | 'hidden';

export interface OffscreenEligibilityContext {
  ownClientId: string | null;
  /** A panel webview currently holds the tab's mount lease. */
  leased: boolean;
  placement: OffscreenTabPlacement;
  /** The tab's workspace is the one this window displays. */
  workspaceDisplayed: boolean;
}

/** A URL a mounted guest may hold; `about:blank` lets a later navigation leave the neutral page. */
function isOffscreenKeepAliveUrl(url: string): boolean {
  if (url === 'about:blank') return true;
  try {
    return BROWSER_PROTOCOLS.NAVIGATION_ALLOWED.includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Only the tab's host mounts a guest (REV-2 §5.45): a tab the registry homes
 * on another client is a mirror here and never gets a webview.
 */
function isHostedHere(tab: PanelTab, ownClientId: string | null): boolean {
  return tab.hostClientId === undefined || tab.hostClientId === ownClientId;
}

export function classifyOffscreenTab(
  tab: PanelTab,
  context: OffscreenEligibilityContext,
): OffscreenEligibility {
  if (tab.type !== 'browser') return { eligible: false, reason: 'not-browser' };
  // Hidden (user-closed or agent-hidden) owned tabs have no panel to render
  // them even in the displayed workspace, so only panel tabs defer to it.
  if (context.placement === 'panel' && context.workspaceDisplayed) {
    return { eligible: false, reason: 'workspace-displayed' };
  }
  if (context.leased) return { eligible: false, reason: 'claimed-by-panel' };
  if (!tab.browserUrl) return { eligible: false, reason: 'no-url' };
  if (!isOffscreenKeepAliveUrl(tab.browserUrl)) {
    return { eligible: false, reason: 'url-not-loadable' };
  }
  if (!isHostedHere(tab, context.ownClientId)) {
    return { eligible: false, reason: 'hosted-elsewhere' };
  }
  return { eligible: true };
}

export interface OffscreenTabDecision {
  tabId: string;
  workspaceId: string;
  placement: OffscreenTabPlacement;
  eligibility: OffscreenEligibility;
  /** The URL to mount, set only when eligible. */
  url?: string;
  /** Agent-owned or hidden tabs stay mounted beyond the cap (monorepo#2857). */
  pinned: boolean;
}

/**
 * Classify every browser tab of every hosted layout, in layout order (panel
 * tabs, then hidden tabs, per workspace). hiddenTabs is a Collection; its
 * ids/map are read directly since components and their helpers must not
 * import collection-utils.
 */
export function collectOffscreenTabDecisions(
  layouts: Readonly<Record<string, WorkspacePanelLayoutState>>,
  options: {
    ownClientId: string | null;
    leasedTabIds: Readonly<Record<string, unknown>>;
    displayedWorkspaceIds: ReadonlySet<string>;
  },
): OffscreenTabDecision[] {
  const out: OffscreenTabDecision[] = [];
  const decide = (tab: PanelTab, workspaceId: string, placement: OffscreenTabPlacement) => {
    if (tab.type !== 'browser') return;
    const eligibility = classifyOffscreenTab(tab, {
      ownClientId: options.ownClientId,
      leased: Boolean(options.leasedTabIds[tab.id]),
      placement,
      workspaceDisplayed: options.displayedWorkspaceIds.has(workspaceId),
    });
    const owned = typeof tab.ownerAgentId === 'string' && tab.ownerAgentId.length > 0;
    out.push({
      tabId: tab.id,
      workspaceId,
      placement,
      eligibility,
      ...(eligibility.eligible ? { url: tab.browserUrl } : {}),
      pinned: placement === 'hidden' || owned,
    });
  };
  for (const [workspaceId, layout] of Object.entries(layouts)) {
    for (const panel of Object.values(layout.panels)) {
      for (const tab of panel.tabs) decide(tab, workspaceId, 'panel');
    }
    for (const id of layout.hiddenTabs?.ids ?? []) {
      const tab = layout.hiddenTabs.map[id];
      if (tab) decide(tab, workspaceId, 'hidden');
    }
  }
  return out;
}

/** A tab's offscreen decision as logged: `eligible`, a skip reason, or `gone` (no longer in any layout). */
export type OffscreenDecisionLabel = 'eligible' | OffscreenSkipReason | 'gone';

export interface OffscreenDecisionChange {
  tabId: string;
  workspaceId: string;
  placement?: OffscreenTabPlacement;
  from: OffscreenDecisionLabel | undefined;
  to: OffscreenDecisionLabel;
}

/**
 * Compare the latest decisions with the labels last seen per tab and return
 * only what changed, plus the labels to remember — so diagnostics log a tab
 * when it enters, changes decision or leaves, never on every reactive pass.
 * Non-browser tabs are ignored.
 */
export function diffOffscreenDecisions(
  previous: ReadonlyMap<string, { label: OffscreenDecisionLabel; workspaceId: string }>,
  decisions: readonly OffscreenTabDecision[],
): {
  changes: OffscreenDecisionChange[];
  next: Map<string, { label: OffscreenDecisionLabel; workspaceId: string }>;
} {
  const changes: OffscreenDecisionChange[] = [];
  const next = new Map<string, { label: OffscreenDecisionLabel; workspaceId: string }>();
  for (const decision of decisions) {
    const label: OffscreenDecisionLabel = decision.eligibility.eligible
      ? 'eligible'
      : decision.eligibility.reason;
    if (label === 'not-browser' || next.has(decision.tabId)) continue;
    next.set(decision.tabId, { label, workspaceId: decision.workspaceId });
    const before = previous.get(decision.tabId)?.label;
    if (before !== label) {
      changes.push({
        tabId: decision.tabId,
        workspaceId: decision.workspaceId,
        placement: decision.placement,
        from: before,
        to: label,
      });
    }
  }
  for (const [tabId, { label, workspaceId }] of previous) {
    if (!next.has(tabId)) changes.push({ tabId, workspaceId, from: label, to: 'gone' });
  }
  return { changes, next };
}

/** One window's view of a tab whose registration timed out (intent-hq/intent#7855). */
export interface OffscreenTabDiagnosis {
  workspaceId: string;
  tabId: string;
  /** Where the tab sits in this window's layout for the workspace. */
  location: 'panel' | 'hidden' | 'absent' | 'no-layout';
  restoreStatus: string | null;
  hasUrl: boolean;
  hasRequestedUrl: boolean;
  owned: boolean;
  hostClientId: string | null;
  ownClientId: string | null;
  leased: boolean;
  workspaceDisplayed: boolean;
  backgroundHosted: boolean;
  /** `eligible` or the reason the offscreen host skips it; null when absent. */
  decision: OffscreenDecisionLabel | null;
  registryPhase: string | null;
  registryReported: boolean;
  registryUnresolved: boolean;
  offscreenElement: boolean;
}

export function diagnoseOffscreenTab(input: {
  workspaceId: string;
  tabId: string;
  layout: WorkspacePanelLayoutState | undefined;
  ownClientId: string | null;
  leasedTabIds: Readonly<Record<string, unknown>>;
  workspaceDisplayed: boolean;
  backgroundHosted: boolean;
  registry: {
    phase: string;
    reported: Readonly<Record<string, unknown>>;
    unresolved: Readonly<Record<string, unknown>>;
  } | null;
  offscreenElement: boolean;
}): OffscreenTabDiagnosis {
  const { workspaceId, tabId, layout } = input;
  const inPanel = layout
    ? Object.values(layout.panels)
        .flatMap((panel) => panel.tabs)
        .find((tab) => tab.id === tabId)
    : undefined;
  const inHidden = !inPanel && layout ? layout.hiddenTabs?.map[tabId] : undefined;
  const tab = inPanel ?? inHidden;
  const placement: OffscreenTabPlacement | undefined = inPanel
    ? 'panel'
    : inHidden
      ? 'hidden'
      : undefined;
  const leased = Boolean(input.leasedTabIds[tabId]);
  let decision: OffscreenDecisionLabel | null = null;
  if (tab && placement) {
    const eligibility = classifyOffscreenTab(tab, {
      ownClientId: input.ownClientId,
      leased,
      placement,
      workspaceDisplayed: input.workspaceDisplayed,
    });
    decision = eligibility.eligible ? 'eligible' : eligibility.reason;
  }
  return {
    workspaceId,
    tabId,
    location: !layout ? 'no-layout' : (placement ?? 'absent'),
    restoreStatus: layout?.restoreStatus ?? null,
    hasUrl: Boolean(tab?.browserUrl),
    hasRequestedUrl: Boolean(tab?.browserRequestedUrl),
    owned: typeof tab?.ownerAgentId === 'string' && tab.ownerAgentId.length > 0,
    hostClientId: tab?.hostClientId ?? null,
    ownClientId: input.ownClientId,
    leased,
    workspaceDisplayed: input.workspaceDisplayed,
    backgroundHosted: input.backgroundHosted,
    decision,
    registryPhase: input.registry?.phase ?? null,
    registryReported: Boolean(input.registry?.reported[tabId]),
    registryUnresolved: Boolean(input.registry?.unresolved[tabId]),
    offscreenElement: input.offscreenElement,
  };
}

/** Skip reasons that mean a guest can never mount here until something else changes. */
const FAILURE_REASONS: ReadonlySet<OffscreenDecisionLabel> = new Set([
  'no-url',
  'url-not-loadable',
  'hosted-elsewhere',
]);

/**
 * Whether a decision change is worth a packaged-build log line: entering or
 * leaving a failure reason. Ordinary workspace switches flip panel tabs
 * between `eligible`, `workspace-displayed` and `claimed-by-panel` and would
 * otherwise log every tab on every switch.
 */
export function isDiagnosticDecisionChange(change: OffscreenDecisionChange): boolean {
  return (
    FAILURE_REASONS.has(change.to) ||
    (change.from !== undefined && FAILURE_REASONS.has(change.from))
  );
}
