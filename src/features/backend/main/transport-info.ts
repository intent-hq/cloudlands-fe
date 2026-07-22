/**
 * Renderer-safe transport info for backend:status and backend:get-status.
 *
 * Extracted from `backend.ipc.ts` so the shaping logic is testable without the
 * Electron module graph. The mode discriminates:
 *   - `sidecar-uds`  → local UDS to the daemon we spawned (or before the
 *     connection mode is resolved).
 *   - `external-uds` → local UDS to a daemon we did not spawn (adopted an
 *     already-running daemon, or `INTENTD_SOCKET` override).
 *   - `external-ws`  → remote WebSocket (or the TCP stub).
 * `target` is the sanitized WS URL when remote, the socket path for
 * external UDS, undefined for sidecar. URLs are sanitized to strip userinfo
 * and query parameters (secrets/tokens).
 */
import { getConnectionMode } from './connection-mode';

/** Renderer-facing transport mode union. */
export type TransportMode = 'sidecar-uds' | 'external-uds' | 'external-ws';

/** Renderer-safe transport payload. */
export interface TransportInfo {
  mode: TransportMode;
  target?: string;
}

/**
 * Sanitize a URL by removing userinfo (user:pass@) and query parameters.
 * Returns scheme://host:port/path, or undefined if parsing fails.
 * Never exposes secrets, tokens, or credentials.
 */
function sanitizeUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    // Strip userinfo (username:password@)
    url.username = '';
    url.password = '';
    // Strip query parameters and hash
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

/** Shape transport config into a renderer-safe payload. */
export function formatTransportInfo(config: {
  transport: 'uds' | 'tcp' | 'ws';
  socketPath?: string;
  wsUrl?: string;
  host?: string;
  port?: number;
}): TransportInfo {
  if (config.transport === 'uds') {
    // The connection mode is resolved during startIntentdSidecar (which runs
    // before the backend handlers register). Only an explicit `external`
    // resolution reports external-uds; `unknown` keeps the legacy default.
    if (getConnectionMode() === 'external') {
      return { mode: 'external-uds', target: config.socketPath };
    }
    return { mode: 'sidecar-uds' };
  }
  if (config.transport === 'ws') {
    const sanitized = config.wsUrl ? sanitizeUrl(config.wsUrl) : undefined;
    return { mode: 'external-ws', target: sanitized };
  }
  // TCP transport is a remote stub; treat it like external WebSocket for UI purposes.
  return { mode: 'external-ws', target: `tcp:${config.host}:${config.port}` };
}
