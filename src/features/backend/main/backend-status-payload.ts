/**
 * The one place that shapes `backend:status` payloads (and the
 * `backend:get-status` reply).
 *
 * Every push is built by {@link buildBackendStatusPayload} for ONE backend and
 * sent only to that backend's windows, so a new field reaches every push from
 * one edit and a backend's facts (startup posture, daemon-update marker,
 * connection-limit state, status and transport) never reach another
 * backend's windows (cloudlands-fe#3883 review).
 *
 * Free of Electron imports so the shaping is unit-testable.
 */
import type { DaemonStartupState } from '$shared/daemon-startup';
import type { BackendConnectionConfig, ConnectedVia } from './backend-connection';
import type { ConnectionStatus } from './json-rpc-client';
import { formatTransportInfo, type TransportInfo } from './transport-info';

/**
 * Client surface the builder reads (satisfied by `JsonRpcClient`). Every getter
 * is required so a renamed client method fails to type-check; the builder still
 * calls the per-backend getters defensively because IPC test doubles omit them.
 */
export interface BackendStatusSource {
  getStatus(): ConnectionStatus;
  getConfig(): BackendConnectionConfig;
  getConnectedVia(): ConnectedVia | null;
  getReconnectAttempts(): number;
  getStartupState(): DaemonStartupState | null;
  isConnectionLimited(): boolean;
  getConnectionLimitRetryAfterMs(): number | null;
}

/** Event-specific markers a single push may add on top of the live client state. */
interface BackendStatusExtras {
  /** A true reconnect completed (model-boot re-runs its load). */
  reconnected?: true;
  /** The app-managed sidecar's restart policy gave up (#439). */
  sidecarGaveUp?: true;
  /** The app-managed sidecar failed to start. */
  sidecarStartupFailed?: true;
  /** Human-readable reason for `sidecarGaveUp` / `sidecarStartupFailed`. */
  reason?: string;
}

/** Marker for a backend whose user-requested daemon update dropped the connection. */
export interface DaemonUpdateMarker {
  daemonUpdateDisconnectedAt?: number;
}

/** A `backend:status` payload scoped to ONE backend's windows. */
export interface BackendStatusPayload extends BackendStatusExtras, DaemonUpdateMarker {
  status: ConnectionStatus;
  transport: TransportInfo;
  reconnectAttempts: number;
  daemonStartup: DaemonStartupState | null;
  connectionLimited: boolean;
  connectionLimitRetryAfterMs: number | null;
}

/** The `backend:get-status` reply: a scoped payload plus the latched sidecar startup failure. */
export interface BackendStatusSnapshot extends BackendStatusPayload {
  sidecarStartupFailedReason?: string;
}

export interface BuildBackendStatusOptions {
  /** The intentd.version pin reported in the transport info. */
  pinnedVersion: string | null;
  /** The daemon-update marker for THIS backend's id (empty when none). */
  updateMarker: DaemonUpdateMarker;
  /** Status to report instead of `client.getStatus()` (the event's own status). */
  status?: ConnectionStatus;
  extras?: BackendStatusExtras;
}

/** Build the full per-backend `backend:status` payload from the client's live state. */
export function buildBackendStatusPayload(
  client: BackendStatusSource,
  options: BuildBackendStatusOptions,
): BackendStatusPayload {
  return {
    status: options.status ?? client.getStatus(),
    ...options.extras,
    transport: formatTransportInfo(
      client.getConfig(),
      options.pinnedVersion,
      client.getConnectedVia(),
    ),
    reconnectAttempts: client.getReconnectAttempts(),
    daemonStartup: client.getStartupState?.() ?? null,
    connectionLimited: client.isConnectionLimited?.() ?? false,
    connectionLimitRetryAfterMs: client.getConnectionLimitRetryAfterMs?.() ?? null,
    ...options.updateMarker,
  };
}
