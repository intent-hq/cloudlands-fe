/**
 * Embedded mode: this renderer is one machine's view inside the Unified window
 * (Labs). The shell owns the tab strip, so the view shows no title bar and hands
 * "open workspace" jumps to the shell instead of opening its own tab.
 *
 * Main loads a view with `?embedded=1`; the flag is kept for the life of the
 * renderer (sessionStorage survives a reload of the same view, SvelteKit
 * navigation drops the query).
 */
import { IPC_CHANNELS } from '$shared/ipc-registry';

const STORAGE_KEY = 'intent.unified-embedded';

function detect(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (new URLSearchParams(window.location.search).get('embedded') === '1') {
      window.sessionStorage.setItem(STORAGE_KEY, '1');
      return true;
    }
    return window.sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

const embedded = detect();

export function isUnifiedEmbedded(): boolean {
  return embedded;
}

interface BridgeLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, handler: (...args: unknown[]) => void): string;
  offById(channel: string, listenerId: string): void;
}

function bridge(): BridgeLike | null {
  return (globalThis as { electronAPI?: BridgeLike }).electronAPI ?? null;
}

/**
 * Ask the shell to open (or select) `workspaceId` on this view's machine as a
 * Unified tab and show `route`. Main resolves the machine from this view's own
 * binding. Resolves false when there is no bridge or main refused.
 */
export async function requestUnifiedWorkspace(workspaceId: string, route: string): Promise<boolean> {
  const api = bridge();
  if (!api) return false;
  try {
    const result = (await api.invoke(IPC_CHANNELS.UNIFIED.OPEN_WORKSPACE, {
      workspaceId,
      route,
    })) as { ok?: boolean } | null;
    return result?.ok === true;
  } catch {
    return false;
  }
}

/** Follow the shell: navigate requests and this machine's open tab list. */
export function listenToUnifiedShell(handlers: {
  navigate(route: string): void;
  tabs(workspaceIds: string[]): void;
}): () => void {
  const api = bridge();
  if (!api || !embedded) return () => {};
  const navigateId = api.on(IPC_CHANNELS.UNIFIED.NAVIGATE, (payload) => {
    const route = (payload as { route?: unknown } | null)?.route;
    if (typeof route === 'string' && route.startsWith('/')) handlers.navigate(route);
  });
  const tabsId = api.on(IPC_CHANNELS.UNIFIED.TABS, (payload) => {
    const ids = (payload as { workspaceIds?: unknown } | null)?.workspaceIds;
    if (Array.isArray(ids)) handlers.tabs(ids.filter((id): id is string => typeof id === 'string'));
  });
  return () => {
    api.offById(IPC_CHANNELS.UNIFIED.NAVIGATE, navigateId);
    api.offById(IPC_CHANNELS.UNIFIED.TABS, tabsId);
  };
}
