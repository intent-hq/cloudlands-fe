import { BrowserWindow, session } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';

const trustedBrowserBridgeBrand = Symbol('trusted-browser-bridge-ipc-context');

export interface TrustedBrowserBridgeIpcContext {
  readonly kind: 'trusted-browser-bridge';
  readonly [trustedBrowserBridgeBrand]: true;
}

export type PrivilegedIpcContext = IpcMainInvokeEvent | TrustedBrowserBridgeIpcContext;

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

export function isTrustedBrowserBridgeIpcContext(
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

export function assertAuthorizedIpcContext(context: PrivilegedIpcContext, channel: string): void {
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
  if (sender.session !== session.defaultSession) {
    throw new IpcAuthorizationError(channel, 'unexpected session');
  }

  const owner = BrowserWindow.fromWebContents(sender);
  if (!owner || owner.isDestroyed() || owner.webContents !== sender) {
    throw new IpcAuthorizationError(channel, 'sender is not an app window');
  }
  if (!isTrustedRendererUrl(senderFrame.url)) {
    throw new IpcAuthorizationError(channel, 'unexpected renderer URL');
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
