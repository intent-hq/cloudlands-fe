export type WorkspaceCommandPayload = {
  workspaceId: string;
};

export type BrowserOpenTabPayload = WorkspaceCommandPayload & {
  url: string;
  position?: 'adjacent' | 'replace' | 'same';
  /** Main-generated id for the new tab so main can lease it immediately (monorepo#2541). */
  tabId?: string;
  /** Skip the panel layout's equivalent-tab dedupe and always create a new tab. */
  allowDuplicate?: boolean;
  /**
   * Pre-rewrite URL when `url` came out of the loopback/tunnel rewrite;
   * persisted with the tab so a restart can re-run the rewrite
   * (monorepo#2789).
   */
  requestedUrl?: string;
};

export type BrowserCloseTabPayload = WorkspaceCommandPayload & {
  tabId: string;
};

export type BrowserFocusTabPayload = WorkspaceCommandPayload & {
  tabId: string;
};

export type BrowserListTabsRequestPayload = WorkspaceCommandPayload & {
  /** Echoed back so main resolves the matching pending request (monorepo#2602). */
  requestId?: string;
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
