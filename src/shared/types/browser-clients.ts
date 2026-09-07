/**
 * REV-2 browser-client routing wire shapes (PROTOCOL §5.17 `client.list`,
 * `workspace.getBrowserClient` / `workspace.setBrowserClient`, and the
 * `browser.*` tab registry). Field names match the daemon structs 1:1
 * (`ReverseLiveClient`, `ResolvedClient`, `BrowserTab`, `BrowserTabInput`);
 * the renderer mirrors these verbatim and never heals them.
 */

/** Capabilities a client advertised on `client.hello` (opaque JSON object). */
export type ClientCapabilities = Record<string, unknown> & { browserExec?: boolean };

/**
 * One connected logical client (`client.list` row). `hostname` /
 * `prettyHostname` / `deviceKind` are the hello host triple, present only
 * when the client sent them; the sidebar indicator displays
 * `prettyHostname ?? hostname ?? name`.
 */
export interface LiveClient {
  clientId: string;
  name?: string;
  capabilities: ClientCapabilities;
  hostname?: string;
  prettyHostname?: string;
  deviceKind?: string;
  /** Live connection count behind this logical client (≥ 1 while listed). */
  connections: number;
  transports: string[];
  connectedAt: string;
}

/** `client:connected` / `client:disconnected` payload (global events). */
export interface LiveClientTransition {
  clientId: string;
  name?: string;
  capabilities: ClientCapabilities;
}

/** The client an agent `browser.exec` would reach right now. */
export interface ResolvedBrowserClient {
  clientId: string;
  name?: string;
}

/**
 * `workspace.getBrowserClient` / `workspace.setBrowserClient` result.
 * `clientId` is the persisted pin (omitted when unpinned → `source:
 * "default"`); `resolved` is `null` when the pin is offline or, unpinned,
 * no eligible client is connected.
 */
export interface WorkspaceBrowserClient {
  clientId?: string;
  source: 'workspace' | 'default';
  resolved: ResolvedBrowserClient | null;
}

export type BrowserTabVisibility = 'visible' | 'hidden';

export interface BrowserTabSize {
  width: number;
  height: number;
}

/** Host-reported tab fields (`browser.upsertTab` `tab`, `browser.syncTabs` entries). */
export interface BrowserTabInput {
  tabId: string;
  workspaceId: string;
  url: string;
  requestedUrl?: string;
  title?: string;
  ownerAgentId?: string;
  ownerAgentName?: string;
  visibility?: BrowserTabVisibility;
  emulatedSize?: BrowserTabSize;
}

/** Daemon tab-registry row (`browser.upsertTab` result, `browser:tab-*` payload). */
export interface BrowserTab extends Omit<BrowserTabInput, 'visibility'> {
  hostClientId: string;
  visibility: BrowserTabVisibility;
  createdAt: string;
  updatedAt: string;
}

/**
 * `browser.listTabs` row: the registry row decorated with the host's live
 * presence (`hostConnected`) and, while connected, its hello `name`.
 */
export interface BrowserTabListing extends BrowserTab {
  hostConnected: boolean;
  hostName?: string;
}

/** `browser:tab-*` event payload: `{ tab, changes? }` (workspace-scoped). */
export interface BrowserTabEventData {
  tab: BrowserTab;
  changes?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isLiveClient(value: unknown): value is LiveClient {
  return (
    isRecord(value) &&
    typeof value.clientId === 'string' &&
    isRecord(value.capabilities) &&
    typeof value.connections === 'number' &&
    Array.isArray(value.transports) &&
    typeof value.connectedAt === 'string'
  );
}

export function isLiveClientTransition(value: unknown): value is LiveClientTransition {
  return isRecord(value) && typeof value.clientId === 'string' && isRecord(value.capabilities);
}

export function isWorkspaceBrowserClient(value: unknown): value is WorkspaceBrowserClient {
  if (!isRecord(value)) return false;
  if (value.source !== 'workspace' && value.source !== 'default') return false;
  if (value.clientId !== undefined && typeof value.clientId !== 'string') return false;
  const resolved = value.resolved;
  return resolved === null || (isRecord(resolved) && typeof resolved.clientId === 'string');
}

export function isBrowserTab(value: unknown): value is BrowserTab {
  return (
    isRecord(value) &&
    typeof value.tabId === 'string' &&
    typeof value.workspaceId === 'string' &&
    typeof value.hostClientId === 'string' &&
    typeof value.url === 'string' &&
    (value.visibility === 'visible' || value.visibility === 'hidden') &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

export function isBrowserTabListing(value: unknown): value is BrowserTabListing {
  return (
    isBrowserTab(value) && typeof (value as { hostConnected?: unknown }).hostConnected === 'boolean'
  );
}
