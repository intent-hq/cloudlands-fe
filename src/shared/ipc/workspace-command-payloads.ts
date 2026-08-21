export type WorkspaceCommandPayload = {
  workspaceId: string;
};

/**
 * Emulated viewport of an agent-owned browser tab (monorepo#2857); owned
 * tabs are always emulated, unowned (user) tabs are always native.
 */
export type BrowserEmulatedSize = {
  width: number;
  height: number;
};

export type BrowserOpenTabPayload = WorkspaceCommandPayload & {
  url: string;
  position?: 'adjacent' | 'replace' | 'same';
  /** Main-generated id for the new tab so main can track ownership immediately (monorepo#2541). */
  tabId?: string;
  /** Skip the panel layout's equivalent-tab dedupe and always create a new tab. */
  allowDuplicate?: boolean;
  /** Pin the panel resolved by this exact open request. */
  pin?: boolean;
  /**
   * Pre-rewrite URL when `url` came out of the loopback/tunnel rewrite;
   * persisted with the tab so a restart can re-run the rewrite
   * (monorepo#2789).
   */
  requestedUrl?: string;
  /**
   * Owning agent when the tab was opened by an agent (monorepo#2857);
   * persisted with the tab so ownership survives restart. Absent for
   * user-opened tabs (unowned).
   */
  ownerAgentId?: string;
  /**
   * Emulated viewport for agent opens (monorepo#2857); persisted with the
   * tab so the size survives restart alongside `ownerAgentId`. Absent for
   * user-opened tabs (unowned, always native).
   */
  emulatedSize?: BrowserEmulatedSize;
  /**
   * With position "replace": the exact tab main resolved (and, for agent
   * opens, ownership-checked) as the adoption target. The renderer replaces
   * only this tab; if it no longer exists a new tab is created instead of
   * replacing whichever tab is first now (monorepo#2857 TOCTOU).
   */
  replaceTabId?: string;
  /**
   * Agent opens only (monorepo#3045): `false` creates the tab directly in
   * the workspace's hidden set — no panel mount, no focus or active-tab
   * change — with its webview mounted offscreen so it stays CDP-addressable.
   * `true` (or absent, e.g. user opens) mounts into the panel layout per
   * `position` as before.
   */
  visible?: boolean;
};

export type BrowserCloseTabPayload = WorkspaceCommandPayload & {
  tabId: string;
};

export type BrowserTabNavigatedPayload = WorkspaceCommandPayload & {
  tabId: string;
  /** Final URL the tab was navigated to (post-rewrite). */
  url: string;
  /**
   * Pre-rewrite URL when `url` came out of the loopback/tunnel rewrite;
   * absent for non-rewritten navigations, which clear any stored requested
   * URL (monorepo#2789).
   */
  requestedUrl?: string;
};

export type BrowserFocusTabPayload = WorkspaceCommandPayload & {
  tabId: string;
  /** Pin the panel that contains the focused browser tab. */
  pin?: boolean;
};

export type BrowserListTabsRequestPayload = WorkspaceCommandPayload & {
  /** Echoed back so main resolves the matching pending request (monorepo#2602). */
  requestId?: string;
};

export type BrowserTabOwnerChangedPayload = WorkspaceCommandPayload & {
  tabId: string;
  /** The agent that now owns the tab (claimTab / agent openTab, monorepo#2857). */
  ownerAgentId: string;
  /**
   * The tab's emulated viewport at the time of the change (claim size /
   * resizeTab); persisted with the tab so the size survives restart
   * (monorepo#2857). Also carried by resize notifications — the owner is
   * unchanged there, only the size — so the renderer's record stays live.
   */
  emulatedSize?: BrowserEmulatedSize;
};

export function workspaceCommandPayload(workspaceId: unknown): WorkspaceCommandPayload | null {
  return typeof workspaceId === 'string' && workspaceId.length > 0 ? { workspaceId } : null;
}

export function isWorkspaceCommandPayload(value: unknown): value is WorkspaceCommandPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'workspaceId' in value &&
    typeof value.workspaceId === 'string' &&
    value.workspaceId.length > 0
  );
}

export function isBrowserEmulatedSize(value: unknown): value is BrowserEmulatedSize {
  return (
    typeof value === 'object' &&
    value !== null &&
    'width' in value &&
    'height' in value &&
    typeof value.width === 'number' &&
    Number.isFinite(value.width) &&
    value.width > 0 &&
    typeof value.height === 'number' &&
    Number.isFinite(value.height) &&
    value.height > 0
  );
}
