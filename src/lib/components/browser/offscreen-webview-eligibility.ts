/**
 * Whether the OffscreenWebviewHost keeps a browser tab's guest mounted, and
 * if not, why (intent-hq/intent#7855). Pure so the host, its diagnostics and
 * the registration-timeout dump all read the same decision.
 */
import { BROWSER_PROTOCOLS } from '../../../shared/constants';
import type {
  PanelTab,
  WorkspacePanelLayoutState,
} from '$store/renderer/slices/panel-layout/panel-layout-types';

/** Why a browser tab gets no offscreen guest. */
export type OffscreenSkipReason =
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

export type OffscreenEligibility = { eligible: true } | { eligible: false; reason: OffscreenSkipReason };

export type OffscreenTabPlacement = 'panel' | 'hidden';

export interface OffscreenEligibilityContext {
  ownClientId: string | null;
  /** A panel webview currently holds the tab's mount lease. */
  leased: boolean;
  placement: OffscreenTabPlacement;
  /** The tab's workspace is the one this window displays. */
  workspaceDisplayed: boolean;
}

/** A URL a mounted guest may hold; `about:blank` lets a later navigation leave the neutral page. */
export function isOffscreenKeepAliveUrl(url: string): boolean {
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
