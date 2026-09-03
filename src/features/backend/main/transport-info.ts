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
import {
  getConnectionMode,
  getDaemonVersionInfo,
  getLocalUpdateSupported,
  getLocalExactVersionUpdateSupported,
  getOrphanedSidecarInfo,
} from './connection-mode';

/** Renderer-facing transport mode union. */
type TransportMode = 'sidecar-uds' | 'external-uds' | 'external-ws';

/** Renderer-safe transport payload. */
export interface TransportInfo {
  mode: TransportMode;
  target?: string;
  /** Version reported by an adopted external daemon (version handshake). */
  daemonVersion?: string;
  /** Source commit reported by an adopted external daemon, when available. */
  daemonBuildCommit?: string;
  /** True when the adopted daemon's version differs from the intentd.version pin (warn-only). */
  versionMismatch?: boolean;
  /**
   * Whether the adopted external daemon reports self-update support
   * (`updateSupported` from `system.status`), captured after each local
   * hello. Absent when unknown (capture pending, daemon too old to report
   * the field) and in every non-external-uds mode.
   */
  updateSupported?: boolean;
  exactVersionUpdateSupported?: boolean;
  /** The bundled intentd.version pin, reported in every transport mode. */
  pinnedVersion?: string;
  /**
   * True when the adopted daemon was classified as an ORPHANED SIDECAR — a
   * leftover from a crashed/force-quit prior app session whose executable
   * lives inside this app's own bundle (#2444). The renderer offers a
   * kill-and-restart recovery for it.
   */
  isOrphanedSidecar?: boolean;
  /**
   * How a remote pinned `wss` connection reached the daemon: `'tunnel'` when
   * the tailcat tunnel candidate won the connection race, `'direct'` when a
   * host dial won. Absent when unknown (single-host dial, not connected) and
   * in every non-wss mode. Refreshed on every (re)connect.
   */
  connectedVia?: 'direct' | 'tunnel';
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

/**
 * Shape transport config into a renderer-safe payload. `pinnedVersion` is the
 * intentd.version pin (injected by the caller so this module stays free of fs
 * access); when provided it is reported in every transport mode.
 * `connectedVia` is the live connection's race outcome (see
 * `JsonRpcClient.getConnectedVia`); it is only reported for `wss`.
 */
export function formatTransportInfo(
  config: {
    transport: 'uds' | 'tcp' | 'ws' | 'wss';
    socketPath?: string;
    wsUrl?: string;
    host?: string;
    port?: number;
  },
  pinnedVersion?: string | null,
  connectedVia?: 'direct' | 'tunnel' | null,
): TransportInfo {
  const pin = pinnedVersion ? { pinnedVersion } : {};
  if (config.transport === 'uds') {
    // The connection mode is resolved during startIntentdSidecar (which runs
    // before the backend handlers register). Only an explicit `external`
    // resolution reports external-uds; `unknown` keeps the legacy default.
    if (getConnectionMode() === 'external') {
      const versionInfo = getDaemonVersionInfo();
      const updateSupported = getLocalUpdateSupported();
      const exactVersionUpdateSupported = getLocalExactVersionUpdateSupported();
      return {
        mode: 'external-uds',
        target: config.socketPath,
        ...(versionInfo
          ? {
              daemonVersion: versionInfo.daemonVersion ?? undefined,
              ...(versionInfo.daemonBuildCommit
                ? { daemonBuildCommit: versionInfo.daemonBuildCommit }
                : {}),
              versionMismatch: versionInfo.versionMismatch,
            }
          : {}),
        ...(updateSupported !== null ? { updateSupported } : {}),
        ...(exactVersionUpdateSupported !== null ? { exactVersionUpdateSupported } : {}),
        ...(getOrphanedSidecarInfo() ? { isOrphanedSidecar: true } : {}),
        ...pin,
      };
    }
    return { mode: 'sidecar-uds', target: config.socketPath, ...pin };
  }
  if (config.transport === 'ws') {
    const sanitized = config.wsUrl ? sanitizeUrl(config.wsUrl) : undefined;
    return { mode: 'external-ws', target: sanitized, ...pin };
  }
  if (config.transport === 'wss') {
    // Remote pinned WSS: host:port only — the token and cert fingerprint never
    // reach the renderer-facing payload.
    return {
      mode: 'external-ws',
      target: `wss:${config.host}:${config.port}`,
      ...(connectedVia ? { connectedVia } : {}),
      ...pin,
    };
  }
  // TCP transport is a remote stub; treat it like external WebSocket for UI purposes.
  return { mode: 'external-ws', target: `tcp:${config.host}:${config.port}`, ...pin };
}
