/**
 * Factory selecting the concrete `BackendTransport` implementation for this
 * environment. Resolution is lazy (first use, not module load) and cached for
 * the lifetime of the renderer process.
 */
import { isElectronPlatform } from "$lib/utils/platform-capabilities";
import type { BackendTransport } from "./backend-transport-types";
import {
  createBrowserWebSocketTransport,
  resolveBrowserWsUrl,
} from "./browser-websocket-transport";
import { createElectronIpcBackendTransport } from "./electron-ipc-transport";

let cachedTransport: BackendTransport | null = null;

function pickTransport(): BackendTransport {
  // Electron IPC when a REAL preload bridge is present. The dev browser mock
  // also installs a `window.electronAPI` (sentinel version `0.0.0-browser`);
  // `isElectronPlatform()` treats that as web so a configured
  // VITE_INTENTD_WS_URL is not shadowed by the mock in dev:web.
  if (isElectronPlatform()) return createElectronIpcBackendTransport();
  // Plain browser: speak JSON-RPC directly to the daemon over a WebSocket
  // when VITE_INTENTD_WS_URL is configured.
  const wsUrl = resolveBrowserWsUrl();
  if (wsUrl) return createBrowserWebSocketTransport({ url: wsUrl });
  // Otherwise fall back to the Electron-IPC transport, which re-checks the
  // bridge per call and degrades exactly like the legacy module (UNAVAILABLE
  // errors, no-op disposers) — with the mock installed this is what routes
  // IPC calls to the BrowserMock handlers.
  return createElectronIpcBackendTransport();
}

/** Resolve the transport for this environment (cached after first use). */
export function resolveBackendTransport(): BackendTransport {
  if (!cachedTransport) cachedTransport = pickTransport();
  return cachedTransport;
}
