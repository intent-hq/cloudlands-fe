/**
 * Browser access host: when a host server (the desktop app's Settings →
 * Devices → Browser access, or the standalone `intent-web` server) serves this
 * page to a browser, its `/runtime-config.js` names the backend this tab is
 * bound to and where to list the host's connections. The host keeps every
 * token; this tab only sees token-free records and reaches each backend
 * through the host's `/intentd/ws/<id>` bridge.
 *
 * A host that advertises the `connections.manage` capability (intent-web)
 * also accepts add/update/test/capture/rotate/tunnel/forget over HTTP at the
 * same connections path, pushes `connections:*` events over SSE, and may
 * serve a tab with no backend bound yet.
 */
import type {
  AddConnectionParams,
  AddConnectionResult,
  CaptureFingerprintParams,
  CaptureFingerprintResult,
  ConnectionsListResult,
  ConnectionTunnelResult,
  ForgetConnectionResult,
  OpenConnectionResult,
  RotateConnectionSecretParams,
  RotateConnectionSecretResult,
  SetConnectionTunnelParams,
  TestConnectionParams,
  TestConnectionResult,
  UpdateConnectionParams,
  UpdateConnectionResult,
} from '$shared/types/connections';
import { expectsElectronPreloadBridge, isElectronPlatform } from '$lib/utils/platform-capabilities';

const CONNECTION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** Host capability that enables the HTTP connection-management calls below. */
const MANAGE_CONNECTIONS_CAPABILITY = 'connections.manage';

/** `windowBackendId` of a tab the host serves with no backend bound yet. */
const NO_BACKEND_ID = '';

export interface BrowserAccessHost {
  /**
   * Backend this tab is bound to (`local` or a saved connection id), or null
   * when a host that manages connections has no backend to bind yet.
   */
  readonly backendId: string | null;
  /** Same-origin path that lists (and, when managed, edits) the host's connections. */
  readonly connectionsUrl: string;
  /** Same-origin SSE path for `connections:*` pushes, when the host provides one. */
  readonly eventsUrl: string | null;
  /** The host accepts connection writes over HTTP (`connections.manage`). */
  readonly canManageConnections: boolean;
  /** The host can dial tailcat tunnel routes. */
  readonly tailcatAvailable: boolean;
}

/** A host HTTP request that did not succeed; `status` 401 means the session ended. */
export class HostRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HostRequestError';
  }
}

function isSameOriginPath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
}

/** The host config, or null when this page is not served by a Browser access host. */
export function getBrowserAccessHost(): BrowserAccessHost | null {
  const config = (
    globalThis as typeof globalThis & {
      __INTENT_RUNTIME_CONFIG__?: {
        readonly backendId?: unknown;
        readonly connectionsUrl?: unknown;
        readonly eventsUrl?: unknown;
        readonly hostCapabilities?: unknown;
        readonly tailcatAvailable?: unknown;
      };
    }
  ).__INTENT_RUNTIME_CONFIG__;
  if (!config) return null;
  const { backendId, connectionsUrl, eventsUrl, hostCapabilities } = config;
  const canManageConnections =
    Array.isArray(hostCapabilities) && hostCapabilities.includes(MANAGE_CONNECTIONS_CAPABILITY);
  const unbound = backendId === null && canManageConnections;
  if (!unbound && (typeof backendId !== 'string' || !CONNECTION_ID_PATTERN.test(backendId))) {
    return null;
  }
  if (!isSameOriginPath(connectionsUrl)) return null;
  return {
    backendId: unbound ? null : (backendId as string),
    connectionsUrl,
    eventsUrl: isSameOriginPath(eventsUrl) ? eventsUrl : null,
    canManageConnections,
    tailcatAvailable: config.tailcatAvailable === true,
  };
}

/** The page's Browser access host, outside Electron only. */
export function getPageHost(): BrowserAccessHost | null {
  if (expectsElectronPreloadBridge() || isElectronPlatform()) return null;
  return getBrowserAccessHost();
}

/**
 * The page host when it manages connections itself (intent-web advertises
 * `connections.manage`): connection writes go to its HTTP API instead of
 * Electron IPC.
 */
export function getManagingHost(): BrowserAccessHost | null {
  const host = getPageHost();
  return host?.canManageConnections ? host : null;
}

/**
 * Bind a host list (from the list call or an SSE push) to this tab: the host
 * reports its own default backend, but a tab stays bound to the backend it
 * was opened for.
 */
export function bindBrowserAccessList(
  host: BrowserAccessHost,
  result: ConnectionsListResult,
): ConnectionsListResult {
  const backendId = host.backendId ?? NO_BACKEND_ID;
  return {
    ...result,
    activeId: result.activeId ?? NO_BACKEND_ID,
    windowBackendId: backendId,
  };
}

/** The host's connections list, from the point of view of this tab's backend. */
export async function fetchBrowserAccessConnections(
  host: BrowserAccessHost,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectionsListResult> {
  const url =
    host.backendId === null
      ? host.connectionsUrl
      : `${host.connectionsUrl}?backend=${encodeURIComponent(host.backendId)}`;
  const response = await fetchImpl(url, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) {
    throw new HostRequestError(`connections list failed: HTTP ${response.status}`, response.status);
  }
  return bindBrowserAccessList(host, (await response.json()) as ConnectionsListResult);
}

/**
 * Open a backend; the tab binds to it through `?backend=`. A tab with no
 * backend yet becomes that backend's tab; a bound tab opens a new one.
 */
export function openBrowserAccessBackend(
  id: string,
  open: (url: string, target: string, features: string) => unknown = (url, target, features) =>
    globalThis.open?.(url, target, features),
  navigate: (url: string) => void = (url) => globalThis.location?.assign(url),
  replaceCurrentTab = false,
): OpenConnectionResult {
  if (!CONNECTION_ID_PATTERN.test(id)) throw new Error(`invalid connection id: ${id}`);
  const url = `/?backend=${encodeURIComponent(id)}`;
  if (replaceCurrentTab) navigate(url);
  else open(url, '_blank', 'noopener');
  return { status: 'opened', id };
}

function connectionPath(host: BrowserAccessHost, id: string, action?: string): string {
  if (!CONNECTION_ID_PATTERN.test(id)) throw new Error(`invalid connection id: ${id}`);
  return `${host.connectionsUrl}/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;
}

async function requestHost<T>(
  fetchImpl: typeof fetch,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  body?: object,
): Promise<T> {
  const response = await fetchImpl(url, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new HostRequestError(
      `connections request failed: HTTP ${response.status}`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

/** Capture a backend's certificate fingerprint through the host. */
export async function captureHostFingerprint(
  host: BrowserAccessHost,
  params: CaptureFingerprintParams,
  fetchImpl: typeof fetch = fetch,
): Promise<CaptureFingerprintResult> {
  const result = await requestHost<
    | { ok: true; fingerprint: string; tokenValid: boolean; statusCode?: number }
    | { ok: false; error?: string }
  >(fetchImpl, 'POST', `${host.connectionsUrl}/capture-fingerprint`, {
    host: params.host,
    port: params.port,
    ...(params.token ? { token: params.token } : {}),
  });
  // Same reduction as the desktop's connections:capture-fingerprint handler.
  if (!result.ok) throw new Error(result.error ?? 'fingerprint capture failed');
  return {
    fingerprint: result.fingerprint,
    tokenValid: result.tokenValid,
    ...(result.statusCode !== undefined ? { statusCode: result.statusCode } : {}),
  };
}

/** Save a new backend on the host. The host has no keychain sync, so `syncExcluded` stays local. */
export function addHostConnection(
  host: BrowserAccessHost,
  params: AddConnectionParams,
  fetchImpl: typeof fetch = fetch,
): Promise<AddConnectionResult> {
  const { syncExcluded: _syncExcluded, ...body } = params;
  return requestHost(fetchImpl, 'POST', host.connectionsUrl, body);
}

export function updateHostConnection(
  host: BrowserAccessHost,
  params: UpdateConnectionParams,
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateConnectionResult> {
  const { id, syncExcluded: _syncExcluded, ...body } = params;
  return requestHost(fetchImpl, 'PATCH', connectionPath(host, id), body);
}

export function testHostConnection(
  host: BrowserAccessHost,
  params: TestConnectionParams,
  fetchImpl: typeof fetch = fetch,
): Promise<TestConnectionResult> {
  const { id, ...body } = params;
  return requestHost(fetchImpl, 'POST', connectionPath(host, id, 'test'), body);
}

export function rotateHostConnectionSecret(
  host: BrowserAccessHost,
  params: RotateConnectionSecretParams,
  fetchImpl: typeof fetch = fetch,
): Promise<RotateConnectionSecretResult> {
  const { id, ...body } = params;
  return requestHost(fetchImpl, 'POST', connectionPath(host, id, 'rotate-secret'), body);
}

export function getHostConnectionTunnel(
  host: BrowserAccessHost,
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectionTunnelResult> {
  return requestHost(fetchImpl, 'GET', connectionPath(host, id, 'tunnel'));
}

export function setHostConnectionTunnel(
  host: BrowserAccessHost,
  params: SetConnectionTunnelParams,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectionTunnelResult> {
  return requestHost(fetchImpl, 'PUT', connectionPath(host, params.id, 'tunnel'), {
    enabled: params.enabled,
  });
}

/** Forget a backend. The host only accepts JSON writes, so the DELETE carries `{}`. */
export async function forgetHostConnection(
  host: BrowserAccessHost,
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ForgetConnectionResult> {
  await requestHost<{ ok: true }>(fetchImpl, 'DELETE', connectionPath(host, id), {});
  return { id };
}
