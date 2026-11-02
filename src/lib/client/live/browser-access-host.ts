/**
 * Browser access host: when the desktop app serves this page to a browser
 * (Settings → Devices → Browser access), its `/runtime-config.js` names the
 * backend this tab is bound to and where to list the desktop's connections.
 * The desktop keeps every token; this tab only sees token-free records and
 * reaches each backend through the desktop's `/intentd/ws/<id>` bridge.
 */
import type { ConnectionsListResult, OpenConnectionResult } from '$shared/types/connections';

const CONNECTION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export interface BrowserAccessHost {
  /** Backend this tab is bound to (`local` or a saved connection id). */
  readonly backendId: string;
  /** Same-origin path that lists the desktop's connections. */
  readonly connectionsUrl: string;
}

/** The host config, or null when this page is not served by Browser access. */
export function getBrowserAccessHost(): BrowserAccessHost | null {
  const config = (
    globalThis as typeof globalThis & {
      __INTENT_RUNTIME_CONFIG__?: {
        readonly backendId?: unknown;
        readonly connectionsUrl?: unknown;
      };
    }
  ).__INTENT_RUNTIME_CONFIG__;
  const backendId = config?.backendId;
  const connectionsUrl = config?.connectionsUrl;
  if (typeof backendId !== 'string' || !CONNECTION_ID_PATTERN.test(backendId)) return null;
  if (
    typeof connectionsUrl !== 'string' ||
    !connectionsUrl.startsWith('/') ||
    connectionsUrl.startsWith('//')
  ) {
    return null;
  }
  return { backendId, connectionsUrl };
}

/** The desktop's connections list, from the point of view of this tab's backend. */
export async function fetchBrowserAccessConnections(
  host: BrowserAccessHost,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectionsListResult> {
  const url = `${host.connectionsUrl}?backend=${encodeURIComponent(host.backendId)}`;
  const response = await fetchImpl(url, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error(`connections list failed: HTTP ${response.status}`);
  const result = (await response.json()) as ConnectionsListResult;
  return { ...result, windowBackendId: host.backendId };
}

/** Open a backend in a new tab; the tab binds to it through `?backend=`. */
export function openBrowserAccessBackend(
  id: string,
  open: (url: string, target: string, features: string) => unknown = (url, target, features) =>
    globalThis.open?.(url, target, features),
): OpenConnectionResult {
  if (!CONNECTION_ID_PATTERN.test(id)) throw new Error(`invalid connection id: ${id}`);
  open(`/?backend=${encodeURIComponent(id)}`, '_blank', 'noopener');
  return { status: 'opened', id };
}
