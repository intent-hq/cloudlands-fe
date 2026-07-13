/**
 * Browser-mode IPC broadcast adapter.
 *
 * This adapter owns the legacy `global.__browserIpcBroadcast` compatibility
 * hook used by browser-mode renderer clients. Callers should import the named
 * functions below instead of reading or writing the global directly. The global
 * remains only so older bridge call sites continue to work during migration.
 */

export type BrowserIpcBroadcastFn = (
  channel: string,
  data: unknown,
  workspaceId?: string,
) => void;

type BrowserIpcGlobal = typeof globalThis & {
  __browserIpcBroadcast?: BrowserIpcBroadcastFn;
};

function getBrowserIpcGlobal(): BrowserIpcGlobal {
  return global as BrowserIpcGlobal;
}

export function registerBrowserIpcBroadcast(fn: BrowserIpcBroadcastFn): () => void {
  const bridgeGlobal = getBrowserIpcGlobal();
  bridgeGlobal.__browserIpcBroadcast = fn;

  return () => {
    if (bridgeGlobal.__browserIpcBroadcast === fn) {
      delete bridgeGlobal.__browserIpcBroadcast;
    }
  };
}

export function broadcastToBrowserIpcClients(
  channel: string,
  data: unknown,
  workspaceId?: string,
): boolean {
  const broadcast = getBrowserIpcGlobal().__browserIpcBroadcast;
  if (typeof broadcast !== 'function') return false;

  broadcast(channel, data, workspaceId);
  return true;
}