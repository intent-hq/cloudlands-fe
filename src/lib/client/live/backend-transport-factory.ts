/**
 * Factory selecting the concrete `BackendTransport` implementation for this
 * environment. Resolution is lazy (first use, not module load) and cached for
 * the lifetime of the renderer process.
 */
import type { BackendTransport } from "./backend-transport-types";
import {
  createBrowserWebSocketTransport,
  resolveBrowserWsUrl,
} from "./browser-websocket-transport";
import { createElectronIpcBackendTransport, electronAPI } from "./electron-ipc-transport";

let cachedTransport: BackendTransport | null = null;

function pickTransport(): BackendTransport {
  // Electron IPC when the preload bridge is present.
  if (electronAPI()) return createElectronIpcBackendTransport();
  // Plain browser: speak JSON-RPC directly to the daemon over a WebSocket
  // when VITE_INTENTD_WS_URL is configured.
  const wsUrl = resolveBrowserWsUrl();
  if (wsUrl) return createBrowserWebSocketTransport({ url: wsUrl });
  // Otherwise fall back to the Electron-IPC transport, which re-checks the
  // bridge per call and degrades exactly like the legacy module (UNAVAILABLE
  // errors, no-op disposers).
  return createElectronIpcBackendTransport();
}

/** Resolve the transport for this environment (cached after first use). */
export function resolveBackendTransport(): BackendTransport {
  if (!cachedTransport) cachedTransport = pickTransport();
  return cachedTransport;
}
