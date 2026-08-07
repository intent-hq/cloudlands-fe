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
 * `target` is the sanitized WS URL when remote (`tcp:host:port` for the TCP
 * stub), and the socket path for UDS (sidecar and external — a local socket
 * path carries no secrets). URLs are sanitized to strip userinfo and query
 * parameters (secrets/tokens).
 */
import { getConnectionMode, getDaemonVersionInfo } from './connection-mode';

/** Renderer-facing transport mode union. */
export type TransportMode = 'sidecar-uds' | 'external-uds' | 'external-ws';

/** Renderer-safe transport payload. */
export interface TransportInfo {
  mode: TransportMode;
  target?: string;
  /** Version reported by an adopted external daemon (version handshake). */
  daemonVersion?: string;
  /** True when the adopted daemon's version differs from the intentd.version pin (warn-only). */
  versionMismatch?: boolean;
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
  transport: 'uds' | 'tcp' | 'ws' | 'wss';
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
      const versionInfo = getDaemonVersionInfo();
      return {
        mode: 'external-uds',
        target: config.socketPath,
        ...(versionInfo
          ? {
              daemonVersion: versionInfo.daemonVersion ?? undefined,
              versionMismatch: versionInfo.versionMismatch,
            }
          : {}),
      };
    }
    return { mode: 'sidecar-uds', target: config.socketPath };
  }
  if (config.transport === 'ws') {
    const sanitized = config.wsUrl ? sanitizeUrl(config.wsUrl) : undefined;
    return { mode: 'external-ws', target: sanitized };
  }
  if (config.transport === 'wss') {
    // Remote pinned WSS: host:port only — the token and cert fingerprint never
    // reach the renderer-facing payload.
    return { mode: 'external-ws', target: `wss:${config.host}:${config.port}` };
  }
  // TCP transport is a remote stub; treat it like external WebSocket for UI purposes.
  return { mode: 'external-ws', target: `tcp:${config.host}:${config.port}` };
}
