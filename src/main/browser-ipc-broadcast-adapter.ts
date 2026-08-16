/**
 * Browser-mode IPC broadcast adapter.
 *
 * This adapter owns the legacy `global.__browserIpcBroadcast` compatibility
 * hook used by browser-mode renderer clients. Callers should import the named
 * functions below instead of reading or writing the global directly. The global
 * remains only so older bridge call sites continue to work during migration.
 */

/**
 * Broadcast hook contract. A hook must return `true` to acknowledge that at
 * least one connected client actually received the message; any other return
 * value (including the legacy `void`) is treated as "not delivered", so a
 * registered-but-clientless bridge can never fake delivery
 * (intent-hq/monorepo#2602).
 */
export type BrowserIpcBroadcastFn = (
  channel: string,
  data: unknown,
  workspaceId?: string,
) => boolean | void;

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

/**
 * Returns `true` only when a registered hook explicitly acknowledged delivery
 * to at least one connected client. A missing hook, or a hook that returns
 * anything other than `true`, counts as no delivery.
 */
export function broadcastToBrowserIpcClients(
  channel: string,
  data: unknown,
  workspaceId?: string,
): boolean {
  const broadcast = getBrowserIpcGlobal().__browserIpcBroadcast;
  if (typeof broadcast !== 'function') return false;

  return broadcast(channel, data, workspaceId) === true;
}
