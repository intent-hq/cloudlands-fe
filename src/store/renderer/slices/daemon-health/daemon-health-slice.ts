/**
 * Daemon Health Slice
 *
 * Actions and reducer for tracking daemon connection + health state.
 * Combines backend:status connection events with periodic system.status polls
 * into a tri-state health value (healthy/degraded/down) plus stats payload.
 */

import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type {
  DaemonHealthState,
  DaemonHealthStats,
  DaemonStatusCheckFailure,
  SidecarRunLog,
  SystemStatusWirePayload,
  UnslothStatusWirePayload,
  BackendTransportInfo,
} from './daemon-health-types';

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialState: DaemonHealthState = {
  health: 'down',
  stats: null,
  lastUpdated: null,
  polling: false,
  transport: null,
  reconnectAttempts: 0,
  hostLocality: null,
  sidecarGaveUp: false,
  sidecarGaveUpReason: null,
  sidecarStartupFailed: false,
  sidecarStartupFailedReason: null,
  hasEverConnected: false,
  sidecarSpawnPending: false,
  sidecarSpawnError: null,
  daemonUpdateDisconnectedAt: null,
  sidecarRunLog: null,
  sidecarRunLogPending: false,
  sidecarRunLogError: null,
  statusCheckFailure: null,
  connectionGeneration: 0,
  unslothStatus: null,
  unslothPolling: false,
  unslothStopping: false,
  unslothStopError: null,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Extra fields carried on backend:status disconnect broadcasts (#439):
 * sidecar supervisor gave up restarting, or the spawn could not happen at all
 * (binary not found, spawn error), plus a human-readable reason.
 */
export interface ConnectionStatusExtras {
  sidecarGaveUp?: boolean;
  sidecarStartupFailed?: boolean;
  reason?: string;
  /** Reconnect attempts since the last successful connect (#1750). */
  reconnectAttempts?: number;
  /**
   * Epoch ms of the first drop main observed for this window's backend while
   * a user-requested `system.requestUpdate` is outstanding — the disconnect
   * is the daemon restarting. Main owns the value so every window of the
   * backend shares one countdown deadline.
   */
  daemonUpdateDisconnectedAt?: number;
}

/**
 * Backend connection status changed (from backend:status IPC events).
 * Payload is ConnectionStatus from json-rpc-client.ts: 'connecting' | 'connected' | 'disconnected'.
 * Optional transport info and disconnect extras are additively included when available.
 */
export const connectionStatusChanged = createAction<
  [status: string, transport?: BackendTransportInfo, extras?: ConnectionStatusExtras]
>('daemonHealth/connectionStatusChanged');

/**
 * Heartbeat health check failed while connected (heartbeat timeout/error).
 * This transitions health to 'degraded' while status stays 'connected'.
 */
export const heartbeatFailed = createAction('daemonHealth/heartbeatFailed');

/**
 * Poll system.status for stats (middleware trigger).
 */
export const pollSystemStatus = createAction('daemonHealth/pollSystemStatus');

/**
 * system.status poll succeeded. `connectionGeneration` is the value the
 * poll captured when its request started; the reducer discards the result
 * when a connection lifecycle change happened meanwhile.
 */
export const systemStatusSuccess = createAction<
  [payload: SystemStatusWirePayload, receivedAt: string, connectionGeneration: number]
>('daemonHealth/systemStatusSuccess');

/**
 * system.status poll failed. Carries only the safe failure category and the
 * time the check settled (#4439) — the saga classifies the error at the
 * effect boundary and never forwards the raw error — plus the connection
 * generation the poll started under. While connected this degrades health;
 * a poll from a previous connection, or one that fails after a disconnect,
 * changes nothing.
 */
export const systemStatusFailure = createAction<
  [failure: Omit<DaemonStatusCheckFailure, 'consecutiveFailures'>, connectionGeneration: number]
>('daemonHealth/systemStatusFailure');

/**
 * User asked for the app-managed sidecar fallback from the daemon-loss UI
 * (#439). The daemon-health middleware invokes backend:spawn-sidecar.
 */
export const spawnSidecarRequested = createAction('daemonHealth/spawnSidecarRequested');

/**
 * User asked to open the local backend from a remote window's stopped overlay.
 * Main spawns the sidecar (if needed) and opens/focuses the local backend's
 * windows; this window keeps its own backend and its overlay.
 */
export const openLocalAndSpawnRequested = createAction('daemonHealth/openLocalAndSpawnRequested');

/**
 * backend:open-local-and-spawn resolved ok. The initiating window stays bound
 * to its own (dead) backend, so no 'connected' backend:status event ever
 * reaches it to clear the pending flag — this action is that reset.
 */
export const openLocalAndSpawnSucceeded = createAction('daemonHealth/openLocalAndSpawnSucceeded');

/**
 * backend:spawn-sidecar failed (binary not found, spawn error). A successful
 * spawn has no dedicated action — the pending flag clears when the reconnect
 * lands as a 'connected' backend:status event.
 */
export const spawnSidecarFailed = createAction<[error: string]>('daemonHealth/spawnSidecarFailed');

/**
 * User asked for the last-run sidecar log from the daemon-loss dialog. The
 * daemon-health middleware invokes backend:get-sidecar-run-log (main-process
 * in-memory capture — no daemon wire request involved).
 */
export const fetchSidecarRunLogRequested = createAction('daemonHealth/fetchSidecarRunLogRequested');

/**
 * backend:get-sidecar-run-log resolved with the contract-shaped payload.
 */
export const fetchSidecarRunLogSucceeded = createAction<[log: SidecarRunLog]>(
  'daemonHealth/fetchSidecarRunLogSucceeded',
);

/**
 * backend:get-sidecar-run-log rejected (bridge unavailable, invoke error).
 */
export const fetchSidecarRunLogFailed = createAction<[error: string]>(
  'daemonHealth/fetchSidecarRunLogFailed',
);

/**
 * Poll unsloth.status (middleware trigger). Dispatched by the status
 * dropdown only while it is open — there is no background interval.
 */
export const pollUnslothStatus = createAction('daemonHealth/pollUnslothStatus');

/**
 * unsloth.status poll succeeded with the wire payload.
 */
export const unslothStatusSuccess = createAction<[payload: UnslothStatusWirePayload]>(
  'daemonHealth/unslothStatusSuccess',
);

/**
 * unsloth.status poll failed (older daemon without the method, transport
 * error). The stored status clears so the UI never shows stale server rows.
 */
export const unslothStatusFailure = createAction('daemonHealth/unslothStatusFailure');

/**
 * User confirmed stopping the managed unsloth server. The middleware invokes
 * unsloth.stop and re-polls unsloth.status when it resolves.
 */
export const stopUnslothRequested = createAction('daemonHealth/stopUnslothRequested');

/**
 * unsloth.stop resolved (`{ stopped: boolean }` — false is a no-op, not an
 * error). The follow-up unsloth.status re-poll refreshes the stored status.
 */
export const stopUnslothSucceeded = createAction<[stopped: boolean]>(
  'daemonHealth/stopUnslothSucceeded',
);

/**
 * unsloth.stop failed.
 */
export const stopUnslothFailed = createAction<[error: string]>('daemonHealth/stopUnslothFailed');

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const daemonHealthReducer = createReducer<DaemonHealthState>(initialState);
daemonHealthReducer.with(
  connectionStatusChanged,
  (state, { payload: [status, transport, extras] }) => {
    const transportChanged =
      transport !== undefined &&
      (transport.mode !== state.transport?.mode || transport.target !== state.transport?.target);
    const hostLocality = transportChanged ? null : state.hostLocality;
    // A repeated 'connected' for the same daemon (same mode/target) only
    // refreshes transport metadata — it is not a new connection. Every other
    // transition starts a new generation: any poll still in flight belongs to
    // the previous connection and its result is discarded, so it is no longer
    // "polling" for this one.
    const sameConnection = status === 'connected' && state.health !== 'down' && !transportChanged;
    const connectionGeneration = sameConnection
      ? state.connectionGeneration
      : state.connectionGeneration + 1;
    const polling = sameConnection ? state.polling : false;

    if (status === 'connected') {
      // Connection established — health moves to 'healthy'. A same-connection
      // metadata refresh says nothing new about the daemon's health: a
      // degraded connection stays degraded, with its failure context, until a
      // valid check or a genuine reconnect.
      // Update transport info if present (additive) and clear any give-up /
      // pending-spawn state.
      return {
        ...state,
        connectionGeneration,
        polling,
        health: sameConnection ? state.health : 'healthy',
        // Stats belong to the daemon that reported them. Drop them on a
        // genuine daemon switch (mode/target changed) so selectors never
        // compare the OLD daemon's version against the NEW transport's pin
        // before the next system.status poll; same-daemon reconnects keep
        // their stats.
        stats: transportChanged
          ? null
          : transport && state.stats
            ? { ...state.stats, transport }
            : state.stats,
        lastUpdated: transportChanged ? null : state.lastUpdated,
        transport: transport ?? state.transport,
        reconnectAttempts: 0,
        // A reported locality belongs to the daemon/transport that produced it.
        // Drop it when switching connections so selectors immediately fall back
        // to the new transport until that daemon's next system.status response.
        hostLocality,
        sidecarGaveUp: false,
        sidecarGaveUpReason: null,
        sidecarStartupFailed: false,
        sidecarStartupFailedReason: null,
        hasEverConnected: true,
        sidecarSpawnPending: false,
        sidecarSpawnError: null,
        daemonUpdateDisconnectedAt: null,
        // The dialog dismisses on reconnect — drop the fetched run log with
        // it; it is stale by the next show.
        sidecarRunLog: null,
        sidecarRunLogPending: false,
        sidecarRunLogError: null,
        // Failure context belongs to the previous connection — never leak it
        // into this one.
        statusCheckFailure: sameConnection ? state.statusCheckFailure : null,
      };
    } else if (status === 'disconnected' || status === 'connecting') {
      // Connection down or reconnecting — health moves to 'down'.
      // Transport is preserved so the daemon-loss UI knows the connection mode.
      // Once sidecarGaveUp latches it stays set until the next successful connect.
      return {
        ...state,
        connectionGeneration,
        polling: false,
        health: 'down',
        transport: transport ?? state.transport,
        hostLocality,
        reconnectAttempts: extras?.reconnectAttempts ?? state.reconnectAttempts,
        sidecarGaveUp: extras?.sidecarGaveUp ? true : state.sidecarGaveUp,
        sidecarGaveUpReason: extras?.sidecarGaveUp
          ? (extras.reason ?? null)
          : state.sidecarGaveUpReason,
        sidecarStartupFailed: extras?.sidecarStartupFailed ? true : state.sidecarStartupFailed,
        sidecarStartupFailedReason: extras?.sidecarStartupFailed
          ? (extras.reason ?? null)
          : state.sidecarStartupFailedReason,
        // An on-demand spawn that crash-loops to give-up (or fails to spawn
        // at all) never reaches 'connected' — clear the pending flag so the
        // fallback button re-enables for a retry instead of sticking on
        // "Starting sidecar…".
        sidecarSpawnPending:
          extras?.sidecarGaveUp || extras?.sidecarStartupFailed ? false : state.sidecarSpawnPending,
        // Main stamps the FIRST update-caused drop and repeats it on every
        // push for the same restart; store what was received so the
        // updating-overlay countdown is anchored to main's time, not ours.
        daemonUpdateDisconnectedAt:
          extras?.daemonUpdateDisconnectedAt ?? state.daemonUpdateDisconnectedAt,
      };
    }
    return state;
  },
);
daemonHealthReducer.with(heartbeatFailed, (state) => {
  // Heartbeat failed while connected — health moves to 'degraded'.
  return { ...state, health: 'degraded' };
});
daemonHealthReducer.with(pollSystemStatus, (state) => {
  return { ...state, polling: true };
});
daemonHealthReducer.with(
  systemStatusSuccess,
  (state, { payload: [wirePayload, receivedAt, connectionGeneration] }) => {
    // A poll that started under a previous connection lifecycle is stale
    // regardless of what it reports — never let it touch this connection.
    if (connectionGeneration !== state.connectionGeneration) return state;
    // Extract stats payload, treating new fields as optional.
    const stats: DaemonHealthStats = {
      clients: wirePayload.clients,
      agents: wirePayload.agents,
      maxAgents: wirePayload.maxAgents,
      listenMode: wirePayload.listenMode,
      port: wirePayload.port ?? null,
      version: wirePayload.version,
      buildCommit: wirePayload.buildCommit,
      protocolVersion: wirePayload.protocolVersion,
      uptimeSeconds: wirePayload.uptimeSeconds,
      cpuPercent: wirePayload.cpuPercent,
      memoryBytes: wirePayload.memoryBytes,
      workspacesDiskAvailableBytes: wirePayload.workspacesDiskAvailableBytes,
      workspacesDiskTotalBytes: wirePayload.workspacesDiskTotalBytes,
      hostname: wirePayload.hostname,
      os: wirePayload.host.os,
      arch: wirePayload.host.arch,
      transport: state.stats?.transport ?? state.transport ?? undefined,
    };
    return {
      ...state,
      polling: false,
      // A valid check recovers a degraded connection; only a status push
      // ('connected') brings a down connection back.
      health: state.health === 'degraded' ? 'healthy' : state.health,
      statusCheckFailure: null,
      stats,
      // Daemon-reported locality (§5.14) — authoritative for host-shell
      // gating; falls back to the transport heuristic before the first poll.
      hostLocality: wirePayload.host.locality ?? state.hostLocality,
      lastUpdated: receivedAt,
    };
  },
);
daemonHealthReducer.with(
  systemStatusFailure,
  (state, { payload: [failure, connectionGeneration] }) => {
    // A failure from a previous connection lifecycle says nothing about this
    // one — discard it before it can degrade a healthy reconnect.
    if (connectionGeneration !== state.connectionGeneration) return state;
    // Health may already be 'down' from connection loss; leave it as-is and
    // record nothing — the disconnect is the explanation.
    if (state.health === 'down') return { ...state, polling: false };
    return {
      ...state,
      polling: false,
      health: 'degraded',
      statusCheckFailure: {
        kind: failure.kind,
        failedAt: failure.failedAt,
        consecutiveFailures: (state.statusCheckFailure?.consecutiveFailures ?? 0) + 1,
      },
    };
  },
);
daemonHealthReducer.with(spawnSidecarRequested, (state) => {
  return { ...state, sidecarSpawnPending: true, sidecarSpawnError: null };
});
daemonHealthReducer.with(openLocalAndSpawnRequested, (state) => {
  return { ...state, sidecarSpawnPending: true, sidecarSpawnError: null };
});
daemonHealthReducer.with(openLocalAndSpawnSucceeded, (state) => {
  return { ...state, sidecarSpawnPending: false };
});
daemonHealthReducer.with(spawnSidecarFailed, (state, { payload: [error] }) => {
  return { ...state, sidecarSpawnPending: false, sidecarSpawnError: error };
});
daemonHealthReducer.with(fetchSidecarRunLogRequested, (state) => {
  return { ...state, sidecarRunLogPending: true, sidecarRunLogError: null };
});
daemonHealthReducer.with(fetchSidecarRunLogSucceeded, (state, { payload: [log] }) => {
  // A connect reset (pending → false) acts as a cancellation: a fetch that
  // resolves late must not re-populate the log the connect branch cleared,
  // or the next failure posture would auto-display a stale log.
  if (!state.sidecarRunLogPending) return state;
  return { ...state, sidecarRunLogPending: false, sidecarRunLog: log };
});
daemonHealthReducer.with(fetchSidecarRunLogFailed, (state, { payload: [error] }) => {
  if (!state.sidecarRunLogPending) return state;
  return { ...state, sidecarRunLogPending: false, sidecarRunLogError: error };
});
daemonHealthReducer.with(pollUnslothStatus, (state) => {
  return { ...state, unslothPolling: true };
});
daemonHealthReducer.with(unslothStatusSuccess, (state, { payload: [status] }) => {
  return { ...state, unslothPolling: false, unslothStatus: status };
});
daemonHealthReducer.with(unslothStatusFailure, (state) => {
  // Clear rather than keep a stale snapshot: a failed poll (older daemon,
  // connection loss) means we no longer know the server state.
  return { ...state, unslothPolling: false, unslothStatus: null };
});
daemonHealthReducer.with(stopUnslothRequested, (state) => {
  return { ...state, unslothStopping: true, unslothStopError: null };
});
daemonHealthReducer.with(stopUnslothSucceeded, (state) => {
  // The middleware's follow-up unsloth.status re-poll refreshes the status.
  return { ...state, unslothStopping: false };
});
daemonHealthReducer.with(stopUnslothFailed, (state, { payload: [error] }) => {
  return { ...state, unslothStopping: false, unslothStopError: error };
});
