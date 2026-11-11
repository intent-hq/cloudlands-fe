import { IPC_CHANNELS } from '$shared/ipc-registry';
import { mockInvoke, subscribeMockIpcEvent } from '$shared/ipc-mock-router';

/**
 * Browser-side `window.electronAPI` stand-in for Playwright CT host fixtures
 * (intent-hq/intent#5276).
 *
 * The CT bundle has no preload bridge, so the Electron IPC transport rejects
 * every daemon request with `BackendError: Backend bridge unavailable` before
 * any IPC happens. A fixture that mounts a real code path which reads from the
 * daemon on mount (e.g. `ChatPanel`'s queue hydration via `agent.getQueue`)
 * then exercises its error fallback while the geometry assertions still pass.
 *
 * `installMockElectronBridge(methods)` installs a bridge whose
 * `backend:request` answers come from `methods`, keyed by JSON-RPC method
 * name, in the `{ ok, result }` envelope the transport unwraps. A method
 * without a handler answers `{ ok: false }` with a `MOCK_UNHANDLED_METHOD`
 * error naming it, so a fixture that reaches an unscripted daemon method fails
 * loudly (via the caller's error log) instead of resolving `undefined`. A
 * fixture that scripts the daemon as one `(method, params)` function passes it
 * instead; an error it throws answers `MOCK_UNHANDLED_METHOD` the same way. Every
 * other invoke channel is routed to the in-memory mock IPC router, exactly like
 * the dev browser mock does. Event listeners (`on`/`off`/`offById`/
 * `removeAllListeners`) subscribe to the same router, so a spec or fixture
 * delivers a main-process event with `emitMockIpcEvent(channel, payload)`.
 * The bridge keeps the dev-mock version sentinel so
 * `getPlatform()` still reports `web` — the fixture renders as before, only the
 * daemon seam is scripted.
 *
 * Specs reach it through the `mockBackend` `hooksConfig` of `mount()` (see
 * `playwright/index.ts`), which installs the bridge before the component
 * mounts; the harness page is reloaded per test, so nothing needs disposing.
 * A fixture that installs it for part of a page's life calls the returned
 * `restore()`, which detaches its listeners and reinstates the previous bridge.
 */

export type MockBackendMethodHandler = (params: unknown) => unknown | Promise<unknown>;
export type MockBackendRequestHandler = (
  method: string,
  params: unknown,
) => unknown | Promise<unknown>;

/** Mirrors `BROWSER_MOCK_ELECTRON_VERSION` in `$lib/utils/platform-capabilities`. */
const BROWSER_MOCK_ELECTRON_VERSION = '0.0.0-browser';

interface BackendRequestPayload {
  method: string;
  params?: unknown;
}

type MockBridgeListener = (...args: unknown[]) => void;

/**
 * The event half of the bridge: `on`/`off`/`offById`/`removeAllListeners`
 * backed by the mock IPC router. A fixture that must keep its own `invoke`
 * (e.g. one that reports a native platform) spreads these into its bridge so
 * `emitMockIpcEvent` still reaches its listeners. `detachAll()` unsubscribes
 * every listener it registered.
 */
export function createMockBridgeListeners() {
  let listenerIdCounter = 0;
  const listeners = new Map<
    string,
    { channel: string; callback: MockBridgeListener; unsubscribe: () => void }
  >();
  const remove = (match: (entry: { channel: string; callback: MockBridgeListener }) => boolean) => {
    for (const [id, entry] of listeners) {
      if (!match(entry)) continue;
      entry.unsubscribe();
      listeners.delete(id);
    }
  };
  return {
    on: (channel: string, callback: MockBridgeListener) => {
      const id = `ct-mock-bridge-${++listenerIdCounter}`;
      const unsubscribe = subscribeMockIpcEvent(channel, (payload) => callback(payload));
      listeners.set(id, { channel, callback, unsubscribe });
      return id;
    },
    off: (channel: string, callback: MockBridgeListener) =>
      remove((entry) => entry.channel === channel && entry.callback === callback),
    offById: (_channel: string, id: string) => {
      listeners.get(id)?.unsubscribe();
      listeners.delete(id);
    },
    removeAllListeners: (channel: string) => remove((entry) => entry.channel === channel),
    detachAll: () => remove(() => true),
  };
}

export function installMockElectronBridge(
  methods: Record<string, MockBackendMethodHandler> | MockBackendRequestHandler,
): () => void {
  const previous = window.electronAPI;
  const { detachAll, ...listeners } = createMockBridgeListeners();
  const api = {
    versions: { electron: BROWSER_MOCK_ELECTRON_VERSION },
    invoke: async (channel: string, payload?: unknown): Promise<unknown> => {
      // The scripted daemon acknowledges a hello: a `client.hello` handler supplies
      // its capabilities, otherwise none (no node authority, no truncated reads).
      if (channel === IPC_CHANNELS.BACKEND.NODE_CAPABILITIES) {
        const hello = typeof methods === 'function' ? undefined : methods['client.hello'];
        return { ok: true, result: hello ? await hello({}) : { server: { capabilities: {} } } };
      }
      if (channel !== IPC_CHANNELS.BACKEND.REQUEST) return mockInvoke(channel, payload);
      const { method, params } = payload as BackendRequestPayload;
      if (typeof methods === 'function') {
        try {
          return { ok: true, result: await methods(method, params) };
        } catch (error) {
          return { ok: false, error: { code: 'MOCK_UNHANDLED_METHOD', message: String(error) } };
        }
      }
      const handler = methods[method];
      if (!handler) {
        return {
          ok: false,
          error: {
            code: 'MOCK_UNHANDLED_METHOD',
            message: `CT mock electron bridge: no handler for daemon method "${method}"`,
          },
        };
      }
      return { ok: true, result: await handler(params) };
    },
    send: () => {},
    ...listeners,
    devInstance: null,
    devPort: null,
  };
  window.electronAPI = api as unknown as Window['electronAPI'];
  return () => {
    detachAll();
    window.electronAPI = previous;
  };
}
