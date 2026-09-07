/**
 * REV-2 browser-client routing wire shapes (PROTOCOL §5.17 `client.list`,
 * `workspace.getBrowserClient` / `workspace.setBrowserClient`, and the
 * `browser.*` tab registry). Field names match the daemon structs 1:1
 * (`ReverseLiveClient`, `ResolvedClient`, `BrowserTab`, `BrowserTabInput`);
 * the renderer mirrors these verbatim and never heals them.
 */

/** Capabilities a client advertised on `client.hello` (opaque JSON object). */
type ClientCapabilities = Record<string, unknown> & { browserExec?: boolean };

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
interface ResolvedBrowserClient {
  clientId: string;
  name?: string;
}

/**
 * `workspace.getBrowserClient` / `workspace.setBrowserClient` result.
 * `clientId` is the persisted pin, present exactly when `source:
 * "workspace"` and absent when unpinned (`source: "default"`); `resolved`
 * is `null` when the pin is offline or, unpinned, no eligible client is
 * connected.
 */
export type WorkspaceBrowserClient =
  | { source: 'workspace'; clientId: string; resolved: ResolvedBrowserClient | null }
  | { source: 'default'; clientId?: undefined; resolved: ResolvedBrowserClient | null };

type BrowserTabVisibility = 'visible' | 'hidden';

interface BrowserTabSize {
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

/**
 * The routed `browser.exec` action envelope — `browser.navigateTab` returns
 * the `navigate` action's envelope verbatim (`result` is `{ url }` on success).
 */
export interface BrowserActionEnvelope {
  action: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The `{ ok: true }` acknowledgement (`browser.removeTab`, `browser.closeTab`). */
export function isOkResult(value: unknown): value is { ok: true } {
  return isRecord(value) && value.ok === true;
}

export function isBrowserActionEnvelope(value: unknown): value is BrowserActionEnvelope {
  return (
    isRecord(value) &&
    typeof value.action === 'string' &&
    typeof value.success === 'boolean' &&
    (value.error === undefined || typeof value.error === 'string')
  );
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
  if (value.source === 'workspace') {
    if (typeof value.clientId !== 'string') return false;
  } else if (value.source === 'default') {
    if (value.clientId !== undefined) return false;
  } else {
    return false;
  }
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
