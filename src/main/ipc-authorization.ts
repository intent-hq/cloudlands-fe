import { BrowserWindow, session } from 'electron';
import { BROWSER_PANEL_PARTITION } from '../shared/constants';
import { browserPanelPageOwner } from './browser-panel-pages';
import { IPC_CHANNELS } from '../shared/ipc-registry';
import { isMachineViewOf } from './window-backend';
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';

const trustedBrowserBridgeBrand = Symbol('trusted-browser-bridge-ipc-context');

export interface TrustedBrowserBridgeIpcContext {
  readonly kind: 'trusted-browser-bridge';
  readonly [trustedBrowserBridgeBrand]: true;
}

type PrivilegedIpcContext = IpcMainInvokeEvent | TrustedBrowserBridgeIpcContext;

export class IpcAuthorizationError extends Error {
  constructor(
    public readonly channel: string,
    public readonly reason: string,
  ) {
    super(`Unauthorized IPC invocation on ${channel}: ${reason}`);
    this.name = 'IpcAuthorizationError';
  }
}

export function createTrustedBrowserBridgeIpcContext(): TrustedBrowserBridgeIpcContext {
  return Object.freeze({
    kind: 'trusted-browser-bridge',
    [trustedBrowserBridgeBrand]: true as const,
  });
}

function isTrustedBrowserBridgeIpcContext(
  context: unknown,
): context is TrustedBrowserBridgeIpcContext {
  return (
    typeof context === 'object' &&
    context !== null &&
    trustedBrowserBridgeBrand in context &&
    (context as TrustedBrowserBridgeIpcContext)[trustedBrowserBridgeBrand] === true
  );
}

export function isTrustedRendererUrl(
  value: string,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'app:') {
      return url.hostname === 'workspaces' && !url.port && !url.username && !url.password;
    }

    if (environment.NODE_ENV !== 'development' || url.protocol !== 'http:') return false;
    const expectedPort = environment.DEV_PORT || '5190';
    return (
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
      url.port === expectedPort &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/** Throws unless `sender` is an app renderer: an app window's contents or its machine view. */
function assertAppRenderer(sender: WebContents, channel: string): void {
  if (sender.session !== session.defaultSession) {
    throw new IpcAuthorizationError(channel, 'unexpected session');
  }
  const owner = BrowserWindow.fromWebContents(sender);
  if (
    !owner ||
    owner.isDestroyed() ||
    (owner.webContents !== sender && !isMachineViewOf(owner, sender))
  ) {
    throw new IpcAuthorizationError(channel, 'sender is not an app window');
  }
}

function assertAuthorizedIpcContext(context: PrivilegedIpcContext, channel: string): void {
  if (isTrustedBrowserBridgeIpcContext(context)) return;

  const event = context as IpcMainInvokeEvent;
  const sender = event?.sender;
  const senderFrame = event?.senderFrame;
  if (!sender || sender.isDestroyed() || sender.getType() !== 'window') {
    throw new IpcAuthorizationError(channel, 'unexpected sender');
  }
  if (!senderFrame || senderFrame !== sender.mainFrame) {
    throw new IpcAuthorizationError(channel, 'subframe invocation');
  }
  assertAppRenderer(sender, channel);
  if (!isTrustedRendererUrl(senderFrame.url)) {
    throw new IpcAuthorizationError(channel, 'unexpected renderer URL');
  }
}

/**
 * Channels that web pages in the browser panel (`<webview>` guests and
 * main-owned pages) may invoke (through the passkey frame preload). Closed list: every other channel admits app
 * renderers only. The handlers still check the frame origin and RP ID.
 * @internal Exported for the authorization tests.
 */
export const BROWSER_PANEL_GUEST_IPC_CHANNELS: ReadonlySet<string> = new Set([
  IPC_CHANNELS.PASSKEYS.PAGE_CREATE,
  IPC_CHANNELS.PASSKEYS.PAGE_GET,
  IPC_CHANNELS.PASSKEYS.PAGE_CANCEL,
  IPC_CHANNELS.PASSKEYS.PAGE_CAPABILITIES,
]);

function assertBrowserPanelGuestIpcContext(context: unknown, channel: string): void {
  if (isTrustedBrowserBridgeIpcContext(context)) {
    throw new IpcAuthorizationError(channel, 'browser bridge cannot act as a web page');
  }
  const event = context as IpcMainInvokeEvent;
  const sender = event?.sender;
  const senderFrame = event?.senderFrame;
  const type = sender && !sender.isDestroyed() ? sender.getType() : null;
  // A `<webview>` guest, or a main-owned page (a WebContentsView reports
  // 'window'); browserPanelPageOwner admits only pages BrowserViewService made.
  if (type !== 'webview' && type !== 'window') {
    throw new IpcAuthorizationError(channel, 'unexpected sender');
  }
  if (sender.session !== session.fromPartition(BROWSER_PANEL_PARTITION)) {
    throw new IpcAuthorizationError(channel, 'unexpected session');
  }
  if (!senderFrame || senderFrame.isDestroyed()) {
    throw new IpcAuthorizationError(channel, 'frame is gone');
  }
  // The owner comes from main's records (webview host, BrowserViewService), never from the page.
  const host = browserPanelPageOwner(sender)?.host;
  if (!host || host.isDestroyed() || host.getType() !== 'window') {
    throw new IpcAuthorizationError(channel, 'page has no app host');
  }
  assertAppRenderer(host, channel);
  if (!isTrustedRendererUrl(host.getURL())) {
    throw new IpcAuthorizationError(channel, 'unexpected host URL');
  }
}

export function createAuthorizedIpcHandler<T extends (...args: any[]) => any>(
  channel: string,
  handler: T,
): T {
  return (async (context: PrivilegedIpcContext, ...args: unknown[]) => {
    assertAuthorizedIpcContext(context, channel);
    return handler(context, ...args);
  }) as T;
}

/**
 * A handler for a {@link BROWSER_PANEL_GUEST_IPC_CHANNELS} channel: browser-panel pages only
 * (`<webview>` guests and main-owned pages owned by a trusted app renderer).
 * @internal Exported for the authorization tests.
 */
export function createBrowserPanelGuestIpcHandler<T extends (...args: any[]) => any>(
  channel: string,
  handler: T,
): T {
  return (async (context: IpcMainInvokeEvent, ...args: unknown[]) => {
    assertBrowserPanelGuestIpcContext(context, channel);
    return handler(context, ...args);
  }) as T;
}

/**
 * Makes every `ipcMain.handle` registration authorized: browser-panel guest
 * channels get the guest guard, all others the app-renderer guard.
 * `onRegister` receives handlers the HTTP IPC bridge may call (guest channels
 * are excluded: a web-page request has no meaning there).
 */
export function installIpcHandleAuthorization(
  ipcMain: IpcMain,
  onRegister: (channel: string, handler: ((...args: any[]) => any) | null) => void = () => {},
): void {
  const originalHandle = ipcMain.handle.bind(ipcMain);
  Object.defineProperty(ipcMain, 'handle', {
    value(channel: string, handler: (...args: any[]) => any) {
      const guest = BROWSER_PANEL_GUEST_IPC_CHANNELS.has(channel);
      const authorized = guest
        ? createBrowserPanelGuestIpcHandler(channel, handler)
        : createAuthorizedIpcHandler(channel, handler);
      onRegister(channel, guest ? null : authorized);
      return originalHandle(channel, authorized);
    },
    writable: false,
    configurable: true,
  });
}
