/**
 * Browser access IPC: the browser-access saga calls `invokeBrowserAccess`;
 * main owns the setting and the server.
 */
import type { BrowserAccessState } from '$shared/types/browser-access';

interface BrowserAccessIpcLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

function getBridge(): BrowserAccessIpcLike | null {
  return (globalThis as { electronAPI?: BrowserAccessIpcLike }).electronAPI ?? null;
}

function parseBrowserAccessState(payload: unknown): BrowserAccessState | null {
  const value = payload as Partial<BrowserAccessState> | null | undefined;
  if (
    !value ||
    typeof value.available !== 'boolean' ||
    typeof value.enabled !== 'boolean' ||
    typeof value.port !== 'number' ||
    typeof value.running !== 'boolean' ||
    typeof value.accessKey !== 'string'
  ) {
    return null;
  }
  return {
    available: value.available,
    enabled: value.enabled,
    port: value.port,
    running: value.running,
    error: value.error ?? null,
    accessKey: value.accessKey,
  };
}

/** Invoke a BROWSER_ACCESS channel; rejects when there is no bridge or the reply is malformed. */
export async function invokeBrowserAccess(
  channel: string,
  payload: Record<string, unknown>,
): Promise<BrowserAccessState> {
  const bridge = getBridge();
  if (!bridge) throw new Error('electronAPI is not available');
  const state = parseBrowserAccessState(await bridge.invoke(channel, payload));
  if (!state) throw new Error(`Malformed ${channel} response`);
  return state;
}
