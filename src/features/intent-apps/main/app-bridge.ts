/**
 * The app bridge (`window.intent`, `docs/protocol/methods/apps.md` → "The app
 * bridge"): one IPC call from an app window becomes either a request on the
 * app's own attached connection or a host-local action. The host maps only the
 * names below; any other name is `not-supported`.
 *
 * Daemon calls are checked by the daemon (level allowlist and features); the
 * host does not pre-filter them. Host-local calls are checked here against the
 * session's level and features.
 *
 * No Electron imports: the window, notification and shortcut effects are
 * injected, so tests drive the whole table.
 */
import type {
  IntentAppPlatform,
  IntentAppSession,
} from '../../../shared/intent-apps/intent-apps-types';

export const BRIDGE_VERSION = 1;

/** `{ code, message, data? }`: what the app's promise rejects with (`IntentError`). */
export interface BridgeError {
  code: string;
  message: string;
  data?: unknown;
}

export type BridgeResponse = { ok: true; result: unknown } | { ok: false; error: BridgeError };

/** A JSON-RPC error answer on the app connection. */
export class AppRpcError extends Error {
  constructor(
    readonly rpcCode: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'AppRpcError';
  }
}

/** The app connection closed, or the session ended, before the answer. */
export class AppDisconnectedError extends Error {
  constructor(message = 'The app session is not connected') {
    super(message);
    this.name = 'AppDisconnectedError';
  }
}

/** A refusal the host makes itself, with a bridge error code. */
export class BridgeCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'BridgeCallError';
  }
}

export interface AppInfo {
  appId: string;
  name: string;
  version: string;
  bundleHash: string;
  level: 1 | 2 | 3;
  features: string[];
  platform: IntentAppPlatform;
  bridgeVersion: 1;
}

export interface BridgeContext {
  readonly session: IntentAppSession;
  readonly info: AppInfo;
  /** A request on the app's attached connection. */
  request(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  showNotification(notification: { title: string; body?: string; tag?: string }): void;
  setAlwaysOnTop(on: boolean): void;
  close(): void;
  /** False when the OS or another app holds the accelerator. Throws on an invalid one. */
  registerShortcut(accelerator: string): boolean;
  unregisterShortcut(accelerator: string): boolean;
  unregisterAllShortcuts(): void;
  /** Accelerators this app holds now. */
  shortcutCount(): number;
}

/** At most this many global shortcuts per app (contract). */
export const MAX_SHORTCUTS_PER_APP = 10;

const DEFAULT_COMPLETE_TIMEOUT_MS = 120_000;
/** Transport slack over the daemon's own `timeoutMs`, so its typed `timeout` error wins. */
const COMPLETE_TIMEOUT_SLACK_MS = 15_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Copy only `keys` that are present (not `undefined`) from `source`. */
function pick(source: unknown, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isRecord(source)) return out;
  for (const key of keys) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

function hasFeature(session: IntentAppSession, feature: string): boolean {
  return session.level >= 2 && session.features.includes(feature);
}

function requireFeature(session: IntentAppSession, feature: string): void {
  if (!hasFeature(session, feature)) {
    throw new BridgeCallError('forbidden', `feature ${feature} not approved`);
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BridgeCallError('invalid-params', `${name} must be a non-empty string`);
  }
  return value;
}

/** Map any failure to the error the app sees (contract table "Errors seen by the app"). */
export function toBridgeError(error: unknown): BridgeError {
  if (error instanceof BridgeCallError) {
    return error.data === undefined
      ? { code: error.code, message: error.message }
      : { code: error.code, message: error.message, data: error.data };
  }
  if (error instanceof AppDisconnectedError) {
    return { code: 'disconnected', message: error.message };
  }
  if (error instanceof AppRpcError) {
    const data = isRecord(error.data) ? error.data : undefined;
    const rest = data ? Object.fromEntries(Object.entries(data).filter(([k]) => k !== 'code')) : {};
    const withData = (code: string): BridgeError =>
      Object.keys(rest).length > 0
        ? { code, message: error.message, data: rest }
        : { code, message: error.message };
    if (error.rpcCode === -32003) return withData('forbidden');
    if (error.rpcCode === -32601) return { code: 'not-supported', message: error.message };
    const dataCode = typeof data?.code === 'string' && data.code ? data.code : null;
    if (dataCode && (error.rpcCode === -32602 || error.rpcCode === -32603)) {
      return withData(dataCode);
    }
    return { code: 'internal', message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: 'internal', message };
}

type Handler = (ctx: BridgeContext, args: readonly unknown[]) => Promise<unknown>;

const HANDLERS: Readonly<Record<string, Handler>> = {
  'app.info': async (ctx) => ({ ...ctx.info, features: [...ctx.info.features] }),

  'storage.get': async (ctx, [key]) => {
    const result = (await ctx.request('app.storage.get', { key })) as {
      found?: unknown;
      value?: unknown;
    };
    return result?.found === true ? result.value : undefined;
  },
  'storage.set': async (ctx, [key, value]) => {
    await ctx.request('app.storage.set', { key, value: value === undefined ? null : value });
    return undefined;
  },
  'storage.delete': async (ctx, [key]) => {
    const result = (await ctx.request('app.storage.delete', { key })) as { deleted?: unknown };
    return result?.deleted === true;
  },
  'storage.list': async (ctx, [opts]) =>
    ctx.request('app.storage.list', pick(opts, ['prefix', 'cursor', 'limit'])),

  'notifications.show': async (ctx, [notification]) => {
    const params = pick(notification, ['title', 'body', 'tag']);
    const result = (await ctx.request('app.notify', params)) as { notificationId?: unknown };
    // The daemon validated it; the calling host shows the OS notification.
    ctx.showNotification({
      title: String(params.title ?? ''),
      ...(typeof params.body === 'string' ? { body: params.body } : {}),
      ...(typeof params.tag === 'string' ? { tag: params.tag } : {}),
    });
    return { notificationId: result?.notificationId };
  },

  'models.list': async (ctx) => ctx.request('app.models.list', {}),
  'models.complete': async (ctx, [req]) => {
    const params = pick(req, [
      'prompt',
      'system',
      'provider',
      'model',
      'reasoningEffort',
      'timeoutMs',
    ]);
    const daemonTimeout =
      typeof params.timeoutMs === 'number' && Number.isFinite(params.timeoutMs)
        ? params.timeoutMs
        : DEFAULT_COMPLETE_TIMEOUT_MS;
    const result = (await ctx.request(
      'app.complete',
      params,
      Math.min(Math.max(daemonTimeout, 1_000), 300_000) + COMPLETE_TIMEOUT_SLACK_MS,
    )) as { available?: unknown; reason?: unknown; text?: unknown; provider?: unknown; model?: unknown };
    if (result?.available === false) {
      throw new BridgeCallError(
        'unavailable',
        typeof result.reason === 'string' ? result.reason : 'Model calls are unavailable',
      );
    }
    return { text: result?.text, provider: result?.provider, model: result?.model };
  },

  'window.setAlwaysOnTop': async (ctx, [on]) => {
    requireFeature(ctx.session, 'alwaysOnTop');
    if (typeof on !== 'boolean') throw new BridgeCallError('invalid-params', 'on must be a boolean');
    ctx.setAlwaysOnTop(on);
    return undefined;
  },
  'window.close': async (ctx) => {
    ctx.close();
    return undefined;
  },

  'shortcuts.register': async (ctx, [accelerator]) => {
    requireFeature(ctx.session, 'globalShortcuts');
    const value = requireString(accelerator, 'accelerator');
    if (ctx.shortcutCount() >= MAX_SHORTCUTS_PER_APP) {
      throw new BridgeCallError(
        'shortcut-unavailable',
        `An app can hold at most ${MAX_SHORTCUTS_PER_APP} shortcuts`,
      );
    }
    let registered: boolean;
    try {
      registered = ctx.registerShortcut(value);
    } catch (error) {
      throw new BridgeCallError(
        'invalid-params',
        error instanceof Error ? error.message : 'Invalid accelerator',
      );
    }
    if (!registered) {
      throw new BridgeCallError('shortcut-unavailable', `${value} is not available`);
    }
    return undefined;
  },
  'shortcuts.unregister': async (ctx, [accelerator]) => {
    requireFeature(ctx.session, 'globalShortcuts');
    return ctx.unregisterShortcut(requireString(accelerator, 'accelerator'));
  },
  'shortcuts.unregisterAll': async (ctx) => {
    requireFeature(ctx.session, 'globalShortcuts');
    ctx.unregisterAllShortcuts();
    return undefined;
  },
};

/** The bridge names the host maps (without `intent.`). */
export const BRIDGE_CALLS: readonly string[] = Object.freeze(Object.keys(HANDLERS));

/** Answer one `intent-app:invoke` message. Never throws. */
export async function handleBridgeCall(
  ctx: BridgeContext,
  call: unknown,
  args: unknown,
): Promise<BridgeResponse> {
  const handler =
    typeof call === 'string' && Object.prototype.hasOwnProperty.call(HANDLERS, call)
      ? HANDLERS[call]
      : undefined;
  if (!handler) {
    return {
      ok: false,
      error: { code: 'not-supported', message: `intent.${String(call)} is not supported` },
    };
  }
  try {
    const result = await handler(ctx, Array.isArray(args) ? args : []);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: toBridgeError(error) };
  }
}
