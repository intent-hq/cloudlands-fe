import { getPageHost, type BrowserAccessHost } from '$lib/client/live/browser-access-host';
import type { PreloadedStoreState } from '$store/renderer/types';
import type { ConnectionsBrowserHost, ConnectionsState } from './connections-types';

/** What the connections slice records about a Browser access host. */
export function toConnectionsBrowserHost(host: BrowserAccessHost): ConnectionsBrowserHost {
  return {
    manageConnections: host.canManageConnections,
    backendBound: host.backendId !== null,
    tailcatAvailable: host.tailcatAvailable,
  };
}

/**
 * Seed `connections.browserHost` from the page's runtime config when the store
 * is created. `/runtime-config.js` runs before the bundle, so the answer is
 * known synchronously; waiting for `connectionsSaga` to record it is too late
 * for components that mount in the same tick, because selector readables
 * replay the frame-cadenced state snapshot taken before the sagas started. On
 * intent-web that showed host-gated UI (the Settings → Mobile tab) for one
 * frame. Leaves an explicit preloaded `browserHost` alone.
 */
export function withPageBrowserHost(
  loadedState?: PreloadedStoreState,
): PreloadedStoreState | undefined {
  const host = getPageHost();
  const connections = loadedState?.connections as Partial<ConnectionsState> | undefined;
  if (!host || (connections && 'browserHost' in connections)) return loadedState;
  // The store merges each preloaded domain over that slice's initial state.
  const seeded = { ...connections, browserHost: toConnectionsBrowserHost(host) };
  return { ...loadedState, connections: seeded as ConnectionsState };
}
