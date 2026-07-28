/**
 * Daemon Health Slice Tests
 *
 * Tests for the daemon-health Redux reducer.
 */

import { describe, it, expect } from 'vitest';
import {
  daemonHealthReducer,
  initialState,
  connectionStatusChanged,
  heartbeatFailed,
  pollSystemStatus,
  systemStatusSuccess,
  systemStatusFailure,
  spawnSidecarRequested,
  spawnSidecarFailed,
  fetchSidecarRunLogRequested,
  fetchSidecarRunLogSucceeded,
  fetchSidecarRunLogFailed,
  pollUnslothStatus,
  unslothStatusSuccess,
  unslothStatusFailure,
  stopUnslothRequested,
  stopUnslothSucceeded,
  stopUnslothFailed,
} from './daemon-health-slice';
import type {
  BackendTransportInfo,
  SidecarRunLog,
  SystemStatusWirePayload,
  UnslothStatusWirePayload,
} from './daemon-health-types';

describe('daemonHealthReducer', () => {
  it('has the correct initial state', () => {
    expect(initialState).toEqual({
      health: 'down',
      stats: null,
      lastUpdated: null,
      polling: false,
      transport: null,
      hostLocality: null,
      sidecarGaveUp: false,
      sidecarGaveUpReason: null,
      sidecarStartupFailed: false,
      sidecarStartupFailedReason: null,
      hasEverConnected: false,
      sidecarSpawnPending: false,
      sidecarSpawnError: null,
      sidecarRunLog: null,
      sidecarRunLogPending: false,
      sidecarRunLogError: null,
      unslothStatus: null,
      unslothPolling: false,
      unslothStopping: false,
      unslothStopError: null,
    });
  });

  describe('connectionStatusChanged', () => {
    const sidecarTransport: BackendTransportInfo = {
      mode: 'sidecar-uds',
      target: '/tmp/intentd.sock',
    };
    const externalTransport: BackendTransportInfo = {
      mode: 'external-uds',
      target: '/tmp/intentd.sock',
      daemonVersion: '0.2.0',
    };

    it('transitions to healthy when connected', () => {
      const state = { ...initialState, health: 'down' as const };
      const next = daemonHealthReducer(state, connectionStatusChanged('connected'));
      expect(next.health).toBe('healthy');
    });

    it('transitions to down when disconnected', () => {
      const state = { ...initialState, health: 'healthy' as const };
      const next = daemonHealthReducer(state, connectionStatusChanged('disconnected'));
      expect(next.health).toBe('down');
    });

    it('transitions to down when connecting', () => {
      const state = { ...initialState, health: 'healthy' as const };
      const next = daemonHealthReducer(state, connectionStatusChanged('connecting'));
      expect(next.health).toBe('down');
    });

    it('stores transport at the top level when connected', () => {
      const next = daemonHealthReducer(
        initialState,
        connectionStatusChanged('connected', externalTransport),
      );
      expect(next.transport).toEqual(externalTransport);
    });

    it('preserves last-known transport across a disconnect without transport info', () => {
      const state = { ...initialState, health: 'healthy' as const, transport: sidecarTransport };
      const next = daemonHealthReducer(state, connectionStatusChanged('disconnected'));
      expect(next.transport).toEqual(sidecarTransport);
    });

    it('updates transport on a disconnect that carries transport info', () => {
      const state = { ...initialState, transport: sidecarTransport };
      const next = daemonHealthReducer(
        state,
        connectionStatusChanged('disconnected', externalTransport),
      );
      expect(next.transport).toEqual(externalTransport);
    });

    it('latches sidecarGaveUp + reason on a give-up disconnect', () => {
      const state = { ...initialState, health: 'healthy' as const, transport: sidecarTransport };
      const next = daemonHealthReducer(
        state,
        connectionStatusChanged('disconnected', undefined, {
          sidecarGaveUp: true,
          reason: 'restart limit reached',
        }),
      );
      expect(next.sidecarGaveUp).toBe(true);
      expect(next.sidecarGaveUpReason).toBe('restart limit reached');
    });

    it('keeps sidecarGaveUp latched on subsequent disconnects without extras', () => {
      const state = {
        ...initialState,
        sidecarGaveUp: true,
        sidecarGaveUpReason: 'restart limit reached',
      };
      const next = daemonHealthReducer(state, connectionStatusChanged('disconnected'));
      expect(next.sidecarGaveUp).toBe(true);
      expect(next.sidecarGaveUpReason).toBe('restart limit reached');
    });

    it('clears sidecarGaveUp state on the next successful connect', () => {
      const state = {
        ...initialState,
        sidecarGaveUp: true,
        sidecarGaveUpReason: 'restart limit reached',
      };
      const next = daemonHealthReducer(state, connectionStatusChanged('connected'));
      expect(next.sidecarGaveUp).toBe(false);
      expect(next.sidecarGaveUpReason).toBeNull();
    });

    it('clears pending spawn state on connect (spawn succeeded → reconnected)', () => {
      const state = {
        ...initialState,
        sidecarSpawnPending: true,
        sidecarSpawnError: 'earlier failure',
      };
      const next = daemonHealthReducer(state, connectionStatusChanged('connected'));
      expect(next.sidecarSpawnPending).toBe(false);
      expect(next.sidecarSpawnError).toBeNull();
    });

    it('clears pending spawn when the spawned sidecar crash-loops to give-up', () => {
      const state = { ...initialState, sidecarSpawnPending: true };
      const next = daemonHealthReducer(
        state,
        connectionStatusChanged('disconnected', undefined, {
          sidecarGaveUp: true,
          reason: 'restart limit reached',
        }),
      );
      expect(next.sidecarSpawnPending).toBe(false);
      expect(next.sidecarGaveUp).toBe(true);
    });

    it('preserves pending spawn on an ordinary disconnect without a give-up', () => {
      const state = { ...initialState, sidecarSpawnPending: true };
      const next = daemonHealthReducer(state, connectionStatusChanged('disconnected'));
      expect(next.sidecarSpawnPending).toBe(true);
    });

    it('latches sidecarStartupFailed + reason on a startup-failure disconnect', () => {
      const state = { ...initialState, transport: sidecarTransport };
      const next = daemonHealthReducer(
        state,
        connectionStatusChanged('disconnected', undefined, {
          sidecarStartupFailed: true,
          reason: 'intentd binary not found',
        }),
      );
      expect(next.sidecarStartupFailed).toBe(true);
      expect(next.sidecarStartupFailedReason).toBe('intentd binary not found');
    });

    it('keeps sidecarStartupFailed latched on subsequent disconnects without extras', () => {
      const state = {
        ...initialState,
        sidecarStartupFailed: true,
        sidecarStartupFailedReason: 'intentd binary not found',
      };
      const next = daemonHealthReducer(state, connectionStatusChanged('disconnected'));
      expect(next.sidecarStartupFailed).toBe(true);
      expect(next.sidecarStartupFailedReason).toBe('intentd binary not found');
    });

    it('clears sidecarStartupFailed state on the next successful connect', () => {
      const state = {
        ...initialState,
        sidecarStartupFailed: true,
        sidecarStartupFailedReason: 'intentd binary not found',
      };
      const next = daemonHealthReducer(state, connectionStatusChanged('connected'));
      expect(next.sidecarStartupFailed).toBe(false);
      expect(next.sidecarStartupFailedReason).toBeNull();
    });

    it('clears pending spawn when the spawn could not happen at all (startup failure)', () => {
      const state = { ...initialState, sidecarSpawnPending: true };
      const next = daemonHealthReducer(
        state,
        connectionStatusChanged('disconnected', undefined, {
          sidecarStartupFailed: true,
          reason: 'intentd binary not found',
        }),
      );
      expect(next.sidecarSpawnPending).toBe(false);
      expect(next.sidecarStartupFailed).toBe(true);
    });

    it('latches hasEverConnected on the first successful connect', () => {
      expect(initialState.hasEverConnected).toBe(false);
      const next = daemonHealthReducer(initialState, connectionStatusChanged('connected'));
      expect(next.hasEverConnected).toBe(true);
    });

    it('keeps hasEverConnected latched for the session across later disconnects', () => {
      const connected = daemonHealthReducer(initialState, connectionStatusChanged('connected'));
      const next = daemonHealthReducer(connected, connectionStatusChanged('disconnected'));
      expect(next.hasEverConnected).toBe(true);
    });

    it('does not set hasEverConnected on disconnect or connecting statuses', () => {
      const afterDisconnect = daemonHealthReducer(
        initialState,
        connectionStatusChanged('disconnected'),
      );
      expect(afterDisconnect.hasEverConnected).toBe(false);
      const afterConnecting = daemonHealthReducer(
        initialState,
        connectionStatusChanged('connecting'),
      );
      expect(afterConnecting.hasEverConnected).toBe(false);
    });
  });

  describe('spawnSidecarRequested / spawnSidecarFailed', () => {
    it('marks the spawn pending and clears a previous error on request', () => {
      const state = { ...initialState, sidecarSpawnError: 'intentd binary not found' };
      const next = daemonHealthReducer(state, spawnSidecarRequested());
      expect(next.sidecarSpawnPending).toBe(true);
      expect(next.sidecarSpawnError).toBeNull();
    });

    it('clears pending and stores the error on failure', () => {
      const state = { ...initialState, sidecarSpawnPending: true };
      const next = daemonHealthReducer(state, spawnSidecarFailed('intentd binary not found'));
      expect(next.sidecarSpawnPending).toBe(false);
      expect(next.sidecarSpawnError).toBe('intentd binary not found');
    });
  });

  describe('fetchSidecarRunLog actions', () => {
    const runLog: SidecarRunLog = {
      available: true,
      startedAt: '2026-07-26T00:00:00.000Z',
      endedAt: '2026-07-26T00:00:05.000Z',
      exitCode: 1,
      signal: null,
      spawnError: null,
      lines: ['intentd starting', 'error: bind failed'],
    };

    it('marks the fetch pending and clears a previous error on request', () => {
      const state = { ...initialState, sidecarRunLogError: 'earlier failure' };
      const next = daemonHealthReducer(state, fetchSidecarRunLogRequested());
      expect(next.sidecarRunLogPending).toBe(true);
      expect(next.sidecarRunLogError).toBeNull();
    });

    it('stores the payload and clears pending on success', () => {
      const state = { ...initialState, sidecarRunLogPending: true };
      const next = daemonHealthReducer(state, fetchSidecarRunLogSucceeded(runLog));
      expect(next.sidecarRunLogPending).toBe(false);
      expect(next.sidecarRunLog).toEqual(runLog);
    });

    it('clears pending and stores the error on failure', () => {
      const state = { ...initialState, sidecarRunLogPending: true };
      const next = daemonHealthReducer(state, fetchSidecarRunLogFailed('bridge unavailable'));
      expect(next.sidecarRunLogPending).toBe(false);
      expect(next.sidecarRunLogError).toBe('bridge unavailable');
    });

    it('drops the fetched run log on the next successful connect', () => {
      const state = {
        ...initialState,
        sidecarRunLog: runLog,
        sidecarRunLogPending: true,
        sidecarRunLogError: 'earlier failure',
      };
      const next = daemonHealthReducer(state, connectionStatusChanged('connected'));
      expect(next.sidecarRunLog).toBeNull();
      expect(next.sidecarRunLogPending).toBe(false);
      expect(next.sidecarRunLogError).toBeNull();
    });

    it('ignores a late success when no fetch is pending (connect reset cancels it)', () => {
      // Connect cleared the log and pending flag; the in-flight fetch then
      // resolves late — it must not re-populate the stale log.
      const state = { ...initialState, sidecarRunLogPending: false };
      const next = daemonHealthReducer(state, fetchSidecarRunLogSucceeded(runLog));
      expect(next).toBe(state);
      expect(next.sidecarRunLog).toBeNull();
    });

    it('ignores a late failure when no fetch is pending', () => {
      const state = { ...initialState, sidecarRunLogPending: false };
      const next = daemonHealthReducer(state, fetchSidecarRunLogFailed('bridge unavailable'));
      expect(next).toBe(state);
      expect(next.sidecarRunLogError).toBeNull();
    });
  });

  describe('heartbeatFailed', () => {
    it('transitions to degraded', () => {
      const state = { ...initialState, health: 'healthy' as const };
      const next = daemonHealthReducer(state, heartbeatFailed());
      expect(next.health).toBe('degraded');
    });
  });

  describe('pollSystemStatus', () => {
    it('sets polling to true', () => {
      const state = { ...initialState, polling: false };
      const next = daemonHealthReducer(state, pollSystemStatus());
      expect(next.polling).toBe(true);
    });
  });

  describe('systemStatusSuccess', () => {
    it('populates stats from a full payload', () => {
      const payload: SystemStatusWirePayload = {
        running: true,
        listenMode: 'uds',
        transports: ['uds'],
        port: null,
        clients: 3,
        agents: 2,
        maxAgents: 8,
        version: '0.1.0',
        uptimeSeconds: 120,
        cpuPercent: 12.34,
        memoryBytes: 104857600,
        fingerprint: 'abc123',
        protocolVersion: '2.0',
        host: {
          os: 'macos',
          arch: 'aarch64',
          hasDisplay: true,
          locality: 'local',
        },
      };
      const state = { ...initialState, polling: true };
      const next = daemonHealthReducer(state, systemStatusSuccess(payload));

      expect(next.polling).toBe(false);
      expect(next.stats).toEqual({
        clients: 3,
        agents: 2,
        maxAgents: 8,
        listenMode: 'uds',
        port: null,
        version: '0.1.0',
        protocolVersion: '2.0',
        uptimeSeconds: 120,
        cpuPercent: 12.34,
        memoryBytes: 104857600,
        os: 'macos',
        arch: 'aarch64',
        transport: undefined,
      });
      expect(next.lastUpdated).toBeTruthy();
      expect(typeof next.lastUpdated).toBe('string');
      expect(next.hostLocality).toBe('local');
    });

    it('treats new fields as optional (graceful degradation)', () => {
      const payload: SystemStatusWirePayload = {
        running: true,
        listenMode: 'tcp',
        transports: ['tcp'],
        port: 9000,
        clients: 1,
        agents: 0,
        // maxAgents, version, uptimeSeconds, cpuPercent, memoryBytes missing (older daemon)
        fingerprint: null,
        protocolVersion: '2.0',
        host: {
          os: 'linux',
          arch: 'x86_64',
          hasDisplay: false,
          locality: 'remote',
        },
      };
      const state = { ...initialState, polling: true };
      const next = daemonHealthReducer(state, systemStatusSuccess(payload));

      expect(next.polling).toBe(false);
      expect(next.stats).toEqual({
        clients: 1,
        agents: 0,
        maxAgents: undefined,
        listenMode: 'tcp',
        port: 9000,
        version: undefined,
        protocolVersion: '2.0',
        uptimeSeconds: undefined,
        cpuPercent: undefined,
        memoryBytes: undefined,
        os: 'linux',
        arch: 'x86_64',
        transport: undefined,
      });
      expect(next.hostLocality).toBe('remote');
    });

    it('preserves the last-known hostLocality when the payload omits it (older daemon)', () => {
      const payload = {
        running: true,
        listenMode: 'uds',
        transports: ['uds'],
        clients: 1,
        agents: 0,
        protocolVersion: '2.0',
        host: { os: 'macos', arch: 'aarch64', hasDisplay: true },
      } as unknown as SystemStatusWirePayload;
      const state = { ...initialState, hostLocality: 'local' as const };
      const next = daemonHealthReducer(state, systemStatusSuccess(payload));

      expect(next.hostLocality).toBe('local');
    });
  });

  describe('systemStatusFailure', () => {
    it('clears polling flag', () => {
      const state = { ...initialState, polling: true };
      const next = daemonHealthReducer(state, systemStatusFailure());
      expect(next.polling).toBe(false);
    });

    it('leaves health unchanged', () => {
      const state = { ...initialState, health: 'healthy' as const, polling: true };
      const next = daemonHealthReducer(state, systemStatusFailure());
      expect(next.health).toBe('healthy');
    });
  });

  describe('unsloth status', () => {
    const runningStatus: UnslothStatusWirePayload = {
      running: true,
      repoId: 'unsloth/Qwen3-4B-GGUF',
      port: 52415,
      pid: 12345,
      uptimeSecs: 42,
      phase: 'ready',
      cpuPercent: 250.5,
      memoryBytes: 4294967296,
      attachedAgentCount: 2,
    };

    it('pollUnslothStatus sets the unslothPolling flag', () => {
      const next = daemonHealthReducer(initialState, pollUnslothStatus());
      expect(next.unslothPolling).toBe(true);
    });

    it('unslothStatusSuccess stores the running wire payload as-is', () => {
      const state = { ...initialState, unslothPolling: true };
      const next = daemonHealthReducer(state, unslothStatusSuccess(runningStatus));
      expect(next.unslothPolling).toBe(false);
      expect(next.unslothStatus).toEqual(runningStatus);
    });

    it('unslothStatusSuccess stores the { running: false } degrade shape', () => {
      const state = {
        ...initialState,
        unslothPolling: true,
        unslothStatus: runningStatus,
      };
      const notRunning: UnslothStatusWirePayload = { running: false, attachedAgentCount: 0 };
      const next = daemonHealthReducer(state, unslothStatusSuccess(notRunning));
      expect(next.unslothStatus).toEqual(notRunning);
    });

    it('unslothStatusSuccess stores the bare { running: false } payload (agent manager not attached)', () => {
      const state = { ...initialState, unslothPolling: true };
      const bare: UnslothStatusWirePayload = { running: false };
      const next = daemonHealthReducer(state, unslothStatusSuccess(bare));
      expect(next.unslothStatus).toEqual(bare);
    });

    it('unslothStatusFailure clears the stored status (no stale server rows)', () => {
      const state = {
        ...initialState,
        unslothPolling: true,
        unslothStatus: runningStatus,
      };
      const next = daemonHealthReducer(state, unslothStatusFailure());
      expect(next.unslothPolling).toBe(false);
      expect(next.unslothStatus).toBeNull();
    });
  });

  describe('unsloth stop', () => {
    it('stopUnslothRequested sets stopping and clears a prior error', () => {
      const state = { ...initialState, unslothStopError: 'previous failure' };
      const next = daemonHealthReducer(state, stopUnslothRequested());
      expect(next.unslothStopping).toBe(true);
      expect(next.unslothStopError).toBeNull();
    });

    it('stopUnslothSucceeded clears the stopping flag', () => {
      const state = { ...initialState, unslothStopping: true };
      const next = daemonHealthReducer(state, stopUnslothSucceeded(true));
      expect(next.unslothStopping).toBe(false);
      expect(next.unslothStopError).toBeNull();
    });

    it('stopUnslothSucceeded with stopped: false (no-op) also clears the flag', () => {
      const state = { ...initialState, unslothStopping: true };
      const next = daemonHealthReducer(state, stopUnslothSucceeded(false));
      expect(next.unslothStopping).toBe(false);
    });

    it('stopUnslothFailed clears the flag and stores the error', () => {
      const state = { ...initialState, unslothStopping: true };
      const next = daemonHealthReducer(state, stopUnslothFailed('transport error'));
      expect(next.unslothStopping).toBe(false);
      expect(next.unslothStopError).toBe('transport error');
    });
  });
});
