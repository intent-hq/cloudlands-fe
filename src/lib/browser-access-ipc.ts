/**
 * Browser access IPC: one function per BROWSER_ACCESS channel, called by the
 * browser-access saga;
 * main owns the setting and the server.
 */
import { BROWSER_ACCESS_CHANNELS } from '$shared/ipc/channels';
import type { BrowserAccessSignInCode, BrowserAccessState } from '$shared/types/browser-access';

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

function expectState(payload: unknown): BrowserAccessState {
  const state = parseBrowserAccessState(payload);
  if (!state) throw new Error('Malformed browser access response');
  return state;
}

function missingBridge(): Error {
  return new Error('electronAPI is not available');
}

export async function getBrowserAccessState(): Promise<BrowserAccessState> {
  const bridge = getBridge();
  if (!bridge) throw missingBridge();
  return expectState(await bridge.invoke(BROWSER_ACCESS_CHANNELS.GET_STATE, {}));
}

export async function setBrowserAccessEnabled(enabled: boolean): Promise<BrowserAccessState> {
  const bridge = getBridge();
  if (!bridge) throw missingBridge();
  return expectState(await bridge.invoke(BROWSER_ACCESS_CHANNELS.SET_ENABLED, { enabled }));
}

export async function setBrowserAccessPort(port: number): Promise<BrowserAccessState> {
  const bridge = getBridge();
  if (!bridge) throw missingBridge();
  return expectState(await bridge.invoke(BROWSER_ACCESS_CHANNELS.SET_PORT, { port }));
}

function expectSignInCode(payload: unknown): BrowserAccessSignInCode {
  const value = payload as Partial<BrowserAccessSignInCode> | null | undefined;
  if (
    !value ||
    typeof value.code !== 'string' ||
    typeof value.expiresAt !== 'number' ||
    (value.link !== null && typeof value.link !== 'string')
  ) {
    throw new Error('Malformed browser access sign-in code');
  }
  return { code: value.code, expiresAt: value.expiresAt, link: value.link };
}

export async function createBrowserAccessSignInCode(): Promise<BrowserAccessSignInCode> {
  const bridge = getBridge();
  if (!bridge) throw missingBridge();
  return expectSignInCode(await bridge.invoke(BROWSER_ACCESS_CHANNELS.CREATE_SIGN_IN_CODE, {}));
}

export async function resetBrowserAccessKey(): Promise<BrowserAccessState> {
  const bridge = getBridge();
  if (!bridge) throw missingBridge();
  return expectState(await bridge.invoke(BROWSER_ACCESS_CHANNELS.RESET_KEY, {}));
}
