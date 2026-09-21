import { IPC_CHANNELS } from '$shared/ipc-registry';
import { mockInvoke } from '$shared/ipc-mock-router';

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
 * loudly (via the caller's error log) instead of resolving `undefined`. Every
 * other invoke channel is routed to the in-memory mock IPC router, exactly like
 * the dev browser mock does. The bridge keeps the dev-mock version sentinel so
 * `getPlatform()` still reports `web` — the fixture renders as before, only the
 * daemon seam is scripted.
 *
 * Specs reach it through the `mockBackend` `hooksConfig` of `mount()` (see
 * `playwright/index.ts`), which installs the bridge before the component
 * mounts; the harness page is reloaded per test, so nothing needs disposing.
 */

export type MockBackendMethodHandler = (params: unknown) => unknown | Promise<unknown>;

/** Mirrors `BROWSER_MOCK_ELECTRON_VERSION` in `$lib/utils/platform-capabilities`. */
const BROWSER_MOCK_ELECTRON_VERSION = '0.0.0-browser';

interface BackendRequestPayload {
  method: string;
  params?: unknown;
}

export function installMockElectronBridge(methods: Record<string, MockBackendMethodHandler>): void {
  let listenerIdCounter = 0;
  const api = {
    versions: { electron: BROWSER_MOCK_ELECTRON_VERSION },
    invoke: async (channel: string, payload?: unknown): Promise<unknown> => {
      if (channel !== IPC_CHANNELS.BACKEND.REQUEST) return mockInvoke(channel, payload);
      const { method, params } = payload as BackendRequestPayload;
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
    on: () => `ct-mock-bridge-${++listenerIdCounter}`,
    off: () => {},
    offById: () => {},
    removeAllListeners: () => {},
    devInstance: null,
    devPort: null,
  };
  window.electronAPI = api as unknown as Window['electronAPI'];
}
