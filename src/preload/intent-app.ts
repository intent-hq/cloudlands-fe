import { contextBridge, ipcRenderer } from 'electron';

// Preload of an Intent app window (Labs; `docs/protocol/methods/apps.md` → "The
// app bridge"). It exposes `window.intent` and nothing else: no Node.js, no
// Intent IPC. A sandboxed preload cannot require app modules, so the channel
// names are literal; a test checks them against IPC_CHANNELS.INTENT_APP.
// Main accepts these messages only from the app window's own webContents and
// frame `intent-app://<appId>/`.
const INVOKE = 'intent-app:invoke';
const EVENT = 'intent-app:event';

type Listener = (data: unknown) => void;

interface InvokeResponse {
  ok: boolean;
  result?: unknown;
  error?: { code?: unknown; message?: unknown; data?: unknown };
}

/** The plain `{ code, message, data? }` object survives contextBridge (an Error's fields do not). */
function rejection(error: InvokeResponse['error']): {
  name: string;
  code: string;
  message: string;
  data?: unknown;
} {
  const code = typeof error?.code === 'string' && error.code ? error.code : 'internal';
  const message = typeof error?.message === 'string' ? error.message : code;
  return error?.data === undefined
    ? { name: 'IntentError', code, message }
    : { name: 'IntentError', code, message, data: error.data };
}

async function invoke(call: string, args: unknown[]): Promise<unknown> {
  let response: InvokeResponse;
  try {
    response = (await ipcRenderer.invoke(INVOKE, { call, args })) as InvokeResponse;
  } catch (error) {
    throw rejection({
      code: 'disconnected',
      message: error instanceof Error ? error.message : 'The app host did not answer',
    });
  }
  if (response?.ok) return response.result;
  throw rejection(response?.error);
}

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

const call =
  (name: string) =>
  (...args: unknown[]) =>
    invoke(name, args);

const bridge = {
  bridgeVersion: 1 as const,
  app: { info: call('app.info') },
  storage: {
    get: call('storage.get'),
    set: call('storage.set'),
    delete: call('storage.delete'),
    list: call('storage.list'),
  },
  notifications: { show: call('notifications.show') },
  models: { list: call('models.list'), complete: call('models.complete') },
  window: { setAlwaysOnTop: call('window.setAlwaysOnTop'), close: call('window.close') },
  shortcuts: {
    register: call('shortcuts.register'),
    unregister: call('shortcuts.unregister'),
    unregisterAll: call('shortcuts.unregisterAll'),
  },
  on(type: string, listener: Listener): () => void {
    if (type !== 'shortcut' && type !== 'session-ended') {
      throw new TypeError(`intent.on: unknown event type ${String(type)}`);
    }
    if (typeof listener !== 'function') throw new TypeError('intent.on: listener must be a function');
    let set = listeners.get(type);
    if (!set) {
      set = new Set();
      listeners.set(type, set);
    }
    set.add(listener);
    return () => {
      listeners.get(type)?.delete(listener);
    };
  },
};

contextBridge.exposeInMainWorld('intent', bridge);
