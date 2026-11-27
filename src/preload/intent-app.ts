import { contextBridge, ipcRenderer } from 'electron';

// Preload of an Intent app window (Labs; `docs/protocol/methods/apps.md` → "The
// app bridge"). It defines `window.intent` and nothing else: no Node.js, no
// Intent IPC. A sandboxed preload cannot require app modules, so the channel
// names are literal; a test checks them against IPC_CHANNELS.INTENT_APP.
// Main accepts these messages only from the app window's own webContents and
// frame `intent-app://<appId>/`.
const INVOKE = 'intent-app:invoke';
const EVENT = 'intent-app:event';

type Listener = (data: unknown) => void;

interface BridgeErrorShape {
  code: string;
  message: string;
  data?: unknown;
}

type InvokeEnvelope = { ok: true; result: unknown } | { ok: false; error: BridgeErrorShape };

/** What the isolated world hands to the page's main world (see `installIntentBridge`). */
export interface RawIntentBridge {
  invoke(call: string, args: unknown[]): Promise<InvokeEnvelope>;
  on(type: string, listener: Listener): { error: BridgeErrorShape } | { unsubscribe: () => void };
}

/**
 * The approved grant, from the arguments main sets on this window
 * (`--intent-app-level`, `--intent-app-features`). A changed grant ends the
 * window, so it is fixed for the window's life.
 */
function readGrant(argv: readonly string[]): { level: number; features: string[] } {
  const value = (name: string) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? '';
  const level = Number(value('intent-app-level')) || 1;
  const features = value('intent-app-features').split(',').filter(Boolean);
  return { level, features };
}

const grant = readGrant(process.argv);
const listeners = new Map<string, Set<Listener>>();

ipcRenderer.on(EVENT, (_event, message: { type?: unknown; data?: unknown }) => {
  const type = typeof message?.type === 'string' ? message.type : null;
  if (!type) return;
  for (const listener of [...(listeners.get(type) ?? [])]) {
    try {
      listener(message.data);
    } catch (error) {
      console.error(`intent.on("${type}") listener failed`, error);
    }
  }
});

function normalizeError(error: unknown): BridgeErrorShape {
  const shape = (error ?? {}) as { code?: unknown; message?: unknown; data?: unknown };
  const code = typeof shape.code === 'string' && shape.code ? shape.code : 'internal';
  const message = typeof shape.message === 'string' ? shape.message : code;
  return shape.data === undefined ? { code, message } : { code, message, data: shape.data };
}

const raw: RawIntentBridge = {
  async invoke(call, args) {
    try {
      const response = (await ipcRenderer.invoke(INVOKE, { call, args })) as InvokeEnvelope;
      if (response?.ok) return { ok: true, result: response.result };
      return { ok: false, error: normalizeError(response?.error) };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'disconnected',
          message: error instanceof Error ? error.message : 'The app host did not answer',
        },
      };
    }
  },
  on(type, listener) {
    // Synchronous refusals (contract: `on()` is synchronous).
    if (type !== 'shortcut' && type !== 'session-ended') {
      return {
        error: { code: 'not-supported', message: `intent.on: unknown event type ${String(type)}` },
      };
    }
    if (type === 'shortcut' && !(grant.level >= 2 && grant.features.includes('globalShortcuts'))) {
      return { error: { code: 'forbidden', message: 'feature globalShortcuts not approved' } };
    }
    if (typeof listener !== 'function') {
      return {
        error: { code: 'invalid-params', message: 'intent.on: listener must be a function' },
      };
    }
    let set = listeners.get(type);
    if (!set) {
      set = new Set();
      listeners.set(type, set);
    }
    set.add(listener);
    return {
      unsubscribe: () => {
        listeners.get(type)?.delete(listener);
      },
    };
  },
};

/**
 * Runs in the page's main world (serialized by executeInMainWorld), so it must
 * not reference anything outside its own body. Refusals are built here as plain
 * `{ code, message, data? }` objects (contract: the raw bridge rejects and throws
 * plain objects; the SDK makes `IntentError` from them). An object thrown or
 * rejected across contextBridge would turn into an Error with only a message.
 */
export function installIntentBridge(bridge: RawIntentBridge): void {
  const intentError = (shape: { code: string; message: string; data?: unknown }) =>
    shape.data === undefined
      ? { code: shape.code, message: shape.message }
      : { code: shape.code, message: shape.message, data: shape.data };
  const call =
    (name: string) =>
    async (...args: unknown[]) => {
      const response = await bridge.invoke(name, args);
      if (response && response.ok) return response.result;
      throw intentError(
        response && !response.ok ? response.error : { code: 'internal', message: 'internal' },
      );
    };
  const intent = Object.freeze({
    bridgeVersion: 1 as const,
    app: Object.freeze({ info: call('app.info') }),
    storage: Object.freeze({
      get: call('storage.get'),
      set: call('storage.set'),
      delete: call('storage.delete'),
      list: call('storage.list'),
    }),
    notifications: Object.freeze({ show: call('notifications.show') }),
    models: Object.freeze({ list: call('models.list'), complete: call('models.complete') }),
    window: Object.freeze({
      setAlwaysOnTop: call('window.setAlwaysOnTop'),
      close: call('window.close'),
    }),
    shortcuts: Object.freeze({
      register: call('shortcuts.register'),
      unregister: call('shortcuts.unregister'),
      unregisterAll: call('shortcuts.unregisterAll'),
    }),
    on(type: string, listener: (data: unknown) => void): () => void {
      const result = bridge.on(type, listener);
      if ('error' in result) throw intentError(result.error);
      return result.unsubscribe;
    },
  });
  Object.defineProperty(globalThis, 'intent', {
    value: intent,
    enumerable: true,
    configurable: false,
    writable: false,
  });
}

contextBridge.executeInMainWorld({ func: installIntentBridge, args: [raw] });
