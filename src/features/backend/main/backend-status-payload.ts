/**
 * The one place that shapes `backend:status` payloads (and the
 * `backend:get-status` reply).
 *
 * Every per-backend push is built by {@link buildBackendStatusPayload}, so a
 * new field reaches every window of that backend from one edit. The rare
 * unscoped push (delivered to EVERY window, whatever backend it is bound to)
 * has its own, deliberately narrower {@link UnscopedBackendStatusPayload}:
 * per-backend facts — the daemon's startup posture, the daemon-update marker,
 * the guest connection-limit state — are typed `never` there, so leaking one
 * backend's facts into another backend's windows fails to type-check
 * (cloudlands-fe#3883 review).
 *
 * Free of Electron imports so the shaping is unit-testable.
 */
import type { DaemonStartupState } from '$shared/daemon-startup';
import type { BackendConnectionConfig, ConnectedVia } from './backend-connection';
import type { ConnectionStatus } from './json-rpc-client';
import { formatTransportInfo, type TransportInfo } from './transport-info';

/** Client surface the builders read. Optional getters tolerate partial test doubles. */
export interface BackendStatusSource {
  getStatus(): ConnectionStatus;
  getConfig(): BackendConnectionConfig;
  getConnectedVia(): ConnectedVia | null;
  getReconnectAttempts(): number;
  getStartupState?(): DaemonStartupState | null;
  isConnectionLimited?(): boolean;
  getConnectionLimitRetryAfterMs?(): number | null;
}

/** Event-specific markers a single push may add on top of the live client state. */
export interface BackendStatusExtras {
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

/**
 * A `backend:status` payload delivered to EVERY window. Only facts that are
 * safe for any backend's window; per-backend fields are `never` so adding one
 * is a compile error.
 */
export interface UnscopedBackendStatusPayload {
  status: ConnectionStatus;
  transport: TransportInfo;
  reconnectAttempts: number;
  daemonStartup?: never;
  daemonUpdateDisconnectedAt?: never;
  connectionLimited?: never;
  connectionLimitRetryAfterMs?: never;
  reconnected?: never;
  sidecarGaveUp?: never;
  sidecarStartupFailed?: never;
  reason?: never;
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

function buildTransport(client: BackendStatusSource, pinnedVersion: string | null): TransportInfo {
  return formatTransportInfo(client.getConfig(), pinnedVersion, client.getConnectedVia());
}

/** Build the full per-backend `backend:status` payload from the client's live state. */
export function buildBackendStatusPayload(
  client: BackendStatusSource,
  options: BuildBackendStatusOptions,
): BackendStatusPayload {
  return {
    status: options.status ?? client.getStatus(),
    ...options.extras,
    transport: buildTransport(client, options.pinnedVersion),
    reconnectAttempts: client.getReconnectAttempts(),
    daemonStartup: client.getStartupState?.() ?? null,
    connectionLimited: client.isConnectionLimited?.() ?? false,
    connectionLimitRetryAfterMs: client.getConnectionLimitRetryAfterMs?.() ?? null,
    ...options.updateMarker,
  };
}

/** Build the narrow payload safe for an unscoped (all-window) push. */
export function buildUnscopedBackendStatusPayload(
  client: BackendStatusSource,
  pinnedVersion: string | null,
): UnscopedBackendStatusPayload {
  return {
    status: client.getStatus(),
    transport: buildTransport(client, pinnedVersion),
    reconnectAttempts: client.getReconnectAttempts(),
  };
}
