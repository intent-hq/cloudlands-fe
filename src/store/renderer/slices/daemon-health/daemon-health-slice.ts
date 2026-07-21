/**
 * Daemon Health Slice
 *
 * Actions and reducer for tracking daemon connection + health state.
 * Combines backend:status connection events with periodic system.status polls
 * into a tri-state health value (healthy/degraded/down) plus stats payload.
 */

import { createAction } from '$lib/store-shim/utils/store/create-action';
import { createReducer } from '$lib/store-shim/utils/store/create-reducer';
import type {
  DaemonHealthState,
  DaemonHealthStats,
  SystemStatusWirePayload,
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
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Backend connection status changed (from backend:status IPC events).
 * Payload is ConnectionStatus from json-rpc-client.ts: 'connecting' | 'connected' | 'disconnected'.
 * Optional transport info is additively included when available.
 */
export const connectionStatusChanged = createAction<[status: string, transport?: BackendTransportInfo]>(
  'daemonHealth/connectionStatusChanged',
);

/**
 * Heartbeat health check failed while connected (heartbeat timeout/error).
 * This transitions health to 'degraded' while status stays 'connected'.
 */
export const heartbeatFailed = createAction(
  'daemonHealth/heartbeatFailed',
);

/**
 * Poll system.status for stats (middleware trigger).
 */
export const pollSystemStatus = createAction(
  'daemonHealth/pollSystemStatus',
);

/**
 * system.status poll succeeded.
 */
export const systemStatusSuccess = createAction<[payload: SystemStatusWirePayload]>(
  'daemonHealth/systemStatusSuccess',
);

/**
 * system.status poll failed.
 */
export const systemStatusFailure = createAction(
  'daemonHealth/systemStatusFailure',
);

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const daemonHealthReducer = createReducer<DaemonHealthState>(initialState)
  .with(connectionStatusChanged, (state, { payload: [status, transport] }) => {
    if (status === 'connected') {
      // Connection established — health moves to 'healthy'.
      // Update transport info if present (additive).
      return {
        ...state,
        health: 'healthy',
        stats: transport && state.stats ? { ...state.stats, transport } : state.stats,
      };
    } else if (status === 'disconnected' || status === 'connecting') {
      // Connection down or reconnecting — health moves to 'down'.
      return { ...state, health: 'down' };
    }
    return state;
  })
  .with(heartbeatFailed, (state) => {
    // Heartbeat failed while connected — health moves to 'degraded'.
    return { ...state, health: 'degraded' };
  })
  .with(pollSystemStatus, (state) => {
    return { ...state, polling: true };
  })
  .with(systemStatusSuccess, (state, { payload: [wirePayload] }) => {
    // Extract stats payload, treating new fields as optional.
    const stats: DaemonHealthStats = {
      clients: wirePayload.clients,
      agents: wirePayload.agents,
      maxAgents: wirePayload.maxAgents,
      listenMode: wirePayload.listenMode,
      port: wirePayload.port ?? null,
      version: wirePayload.version,
      protocolVersion: wirePayload.protocolVersion,
      uptimeSeconds: wirePayload.uptimeSeconds,
      cpuPercent: wirePayload.cpuPercent,
      memoryBytes: wirePayload.memoryBytes,
      os: wirePayload.host.os,
      arch: wirePayload.host.arch,
      transport: state.stats?.transport,
    };
    return {
      ...state,
      polling: false,
      stats,
      lastUpdated: new Date().toISOString(),
    };
  })
  .with(systemStatusFailure, (state) => {
    // Health may already be 'down' from connection loss; leave it as-is.
    return { ...state, polling: false };
  });
