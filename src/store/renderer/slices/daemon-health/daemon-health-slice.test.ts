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
  openLocalAndSpawnRequested,
  openLocalAndSpawnSucceeded,
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

    it('clears locality reported by a different transport when switching to local UDS', () => {
      const state = {
        ...initialState,
        transport: { mode: 'external-ws', target: 'wss://remote.example' } as const,
        hostLocality: 'remote' as const,
      };

      const next = daemonHealthReducer(
        state,
        connectionStatusChanged('connected', sidecarTransport),
      );

      expect(next.transport).toEqual(sidecarTransport);
      expect(next.hostLocality).toBeNull();
    });

    it('clears stale stats when connecting to a different daemon (transport switch)', () => {
      // Stats (incl. version) polled from the previous daemon must not
      // survive a switch — the selector would compare the OLD daemon's
      // version against the NEW transport's pin until the next poll.
      const state = {
        ...initialState,
        health: 'down' as const,
        transport: {
          mode: 'external-ws',
          target: 'wss://remote.example',
          pinnedVersion: '2.0.0',
        } as const,
        stats: {
          clients: 1,
          agents: 0,
          listenMode: 'ws',
          os: 'linux',
          arch: 'x64',
          version: '1.0.0',
        },
        lastUpdated: '2026-08-14T00:00:00.000Z',
      };

      const next = daemonHealthReducer(
        state,
        connectionStatusChanged('connected', { ...sidecarTransport, pinnedVersion: '2.0.0' }),
      );

      expect(next.stats).toBeNull();
      expect(next.lastUpdated).toBeNull();
    });

    it('preserves stats when reconnecting to the same daemon (no transport change)', () => {
      const stats = {
        clients: 1,
        agents: 0,
        listenMode: 'uds',
        os: 'macos',
        arch: 'aarch64',
        version: '1.0.0',
      };
      const state = {
        ...initialState,
        health: 'down' as const,
        transport: sidecarTransport,
        stats,
        lastUpdated: '2026-08-14T00:00:00.000Z',
      };

      const next = daemonHealthReducer(
        state,
        connectionStatusChanged('connected', { ...sidecarTransport }),
      );

      expect(next.stats).toEqual({ ...stats, transport: sidecarTransport });
      expect(next.lastUpdated).toBe('2026-08-14T00:00:00.000Z');
    });

    it('preserves forced locality when reconnecting to the same transport', () => {
      const state = {
        ...initialState,
        transport: sidecarTransport,
        hostLocality: 'remote' as const,
      };

      const next = daemonHealthReducer(
        state,
        connectionStatusChanged('connected', { ...sidecarTransport }),
      );

      expect(next.hostLocality).toBe('remote');
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

    it('stores reconnectAttempts from disconnect/connecting extras (#1750)', () => {
      const down = daemonHealthReducer(
        initialState,
        connectionStatusChanged('disconnected', undefined, { reconnectAttempts: 3 }),
      );
      expect(down.reconnectAttempts).toBe(3);

      const connecting = daemonHealthReducer(
        down,
        connectionStatusChanged('connecting', undefined, { reconnectAttempts: 4 }),
      );
      expect(connecting.reconnectAttempts).toBe(4);
    });

    it('preserves reconnectAttempts on a disconnect without the extra', () => {
      const state = { ...initialState, reconnectAttempts: 5 };
      const next = daemonHealthReducer(state, connectionStatusChanged('disconnected'));
      expect(next.reconnectAttempts).toBe(5);
    });

    it('resets reconnectAttempts on a successful connect', () => {
      const state = { ...initialState, reconnectAttempts: 14 };
      const next = daemonHealthReducer(state, connectionStatusChanged('connected'));
      expect(next.reconnectAttempts).toBe(0);
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

    describe('daemonUpdateDisconnectedAt', () => {
      const t0 = new Date('2026-09-04T10:00:00.000Z').getTime();

      it('stores the drop time main stamped on an update-caused disconnect', () => {
        const state = { ...initialState, health: 'healthy' as const };
        const next = daemonHealthReducer(
          state,
          connectionStatusChanged('disconnected', undefined, { daemonUpdateDisconnectedAt: t0 }),
        );
        expect(next.daemonUpdateDisconnectedAt).toBe(t0);
        expect(next.health).toBe('down');
      });

      it('stores the time on a flagged connecting status too', () => {
        const next = daemonHealthReducer(
          initialState,
          connectionStatusChanged('connecting', undefined, { daemonUpdateDisconnectedAt: t0 }),
        );
        expect(next.daemonUpdateDisconnectedAt).toBe(t0);
      });

      it('mirrors the value main repeats across later pushes for the same restart', () => {
        const first = daemonHealthReducer(
          initialState,
          connectionStatusChanged('disconnected', undefined, { daemonUpdateDisconnectedAt: t0 }),
        );
        const second = daemonHealthReducer(
          first,
          connectionStatusChanged('connecting', undefined, {
            daemonUpdateDisconnectedAt: t0,
            reconnectAttempts: 2,
          }),
        );
        const third = daemonHealthReducer(
          second,
          connectionStatusChanged('disconnected', undefined, { daemonUpdateDisconnectedAt: t0 }),
        );
        expect(second.daemonUpdateDisconnectedAt).toBe(t0);
        expect(third.daemonUpdateDisconnectedAt).toBe(t0);
      });

      it('clears the time on a successful connect', () => {
        const state = { ...initialState, daemonUpdateDisconnectedAt: t0 };
        const next = daemonHealthReducer(state, connectionStatusChanged('connected'));
        expect(next.daemonUpdateDisconnectedAt).toBeNull();
      });

      it('leaves the time untouched on a disconnect without the marker', () => {
        const unflagged = daemonHealthReducer(
          initialState,
          connectionStatusChanged('disconnected'),
        );
        expect(unflagged.daemonUpdateDisconnectedAt).toBeNull();

        const state = { ...initialState, daemonUpdateDisconnectedAt: t0 };
        const next = daemonHealthReducer(
          state,
          connectionStatusChanged('disconnected', undefined, { reconnectAttempts: 1 }),
        );
        expect(next.daemonUpdateDisconnectedAt).toBe(t0);
      });

      it('stores a fresh time for a new update after a reconnect cleared the previous one', () => {
        const first = daemonHealthReducer(
          initialState,
          connectionStatusChanged('disconnected', undefined, { daemonUpdateDisconnectedAt: t0 }),
        );
        const reconnected = daemonHealthReducer(first, connectionStatusChanged('connected'));
        expect(reconnected.daemonUpdateDisconnectedAt).toBeNull();

        const again = daemonHealthReducer(
          reconnected,
          connectionStatusChanged('disconnected', undefined, {
            daemonUpdateDisconnectedAt: t0 + 60_000,
          }),
        );
        expect(again.daemonUpdateDisconnectedAt).toBe(t0 + 60_000);
      });
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

  describe('openLocalAndSpawnRequested / openLocalAndSpawnSucceeded', () => {
    it('marks the spawn pending and clears a previous error on request', () => {
      const state = { ...initialState, sidecarSpawnError: 'intentd binary not found' };
      const next = daemonHealthReducer(state, openLocalAndSpawnRequested());
      expect(next.sidecarSpawnPending).toBe(true);
      expect(next.sidecarSpawnError).toBeNull();
    });

    it('clears pending on success — this window keeps its dead backend, so no connected status ever resets it', () => {
      const state = { ...initialState, sidecarSpawnPending: true };
      const next = daemonHealthReducer(state, openLocalAndSpawnSucceeded());
      expect(next.sidecarSpawnPending).toBe(false);
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
        buildCommit: '0123456789abcdef',
        uptimeSeconds: 120,
        cpuPercent: 12.34,
        memoryBytes: 104857600,
        workspacesDiskAvailableBytes: 453316378624,
        workspacesDiskTotalBytes: 1099511627776,
        fingerprint: 'abc123',
        hostname: 'studio.local',
        protocolVersion: '2.0',
        host: {
          os: 'macos',
          arch: 'aarch64',
          hasDisplay: true,
          locality: 'local',
        },
      };
      const state = { ...initialState, polling: true };
      const receivedAt = '2026-07-30T20:00:00.000Z';
      const next = daemonHealthReducer(state, systemStatusSuccess(payload, receivedAt));

      expect(next.polling).toBe(false);
      expect(next.stats).toEqual({
        clients: 3,
        agents: 2,
        maxAgents: 8,
        listenMode: 'uds',
        port: null,
        version: '0.1.0',
        buildCommit: '0123456789abcdef',
        protocolVersion: '2.0',
        uptimeSeconds: 120,
        cpuPercent: 12.34,
        memoryBytes: 104857600,
        workspacesDiskAvailableBytes: 453316378624,
        workspacesDiskTotalBytes: 1099511627776,
        hostname: 'studio.local',
        os: 'macos',
        arch: 'aarch64',
        transport: undefined,
      });
      expect(next.lastUpdated).toBe(receivedAt);
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
        // maxAgents, version, uptimeSeconds, cpuPercent, memoryBytes,
        // workspacesDisk* missing (older daemon)
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
      const next = daemonHealthReducer(
        state,
        systemStatusSuccess(payload, '2026-07-30T20:00:01.000Z'),
      );

      expect(next.polling).toBe(false);
      expect(next.stats).toEqual({
        clients: 1,
        agents: 0,
        maxAgents: undefined,
        listenMode: 'tcp',
        port: 9000,
        version: undefined,
        buildCommit: undefined,
        protocolVersion: '2.0',
        uptimeSeconds: undefined,
        cpuPercent: undefined,
        memoryBytes: undefined,
        workspacesDiskAvailableBytes: undefined,
        workspacesDiskTotalBytes: undefined,
        hostname: undefined,
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
      const next = daemonHealthReducer(
        state,
        systemStatusSuccess(payload, '2026-07-30T20:00:02.000Z'),
      );

      expect(next.hostLocality).toBe('local');
    });

    it('falls back to the top-level transport when stats are built for the first time (#1963)', () => {
      const bootTransport: BackendTransportInfo = {
        mode: 'sidecar-uds',
        target: '/tmp/intentd.sock',
      };
      // Boot ordering: the connect event lands while stats are still null, so
      // the transport only exists at the top level of the slice.
      const connected = daemonHealthReducer(
        initialState,
        connectionStatusChanged('connected', bootTransport),
      );
      expect(connected.stats).toBeNull();
      expect(connected.transport).toEqual(bootTransport);

      const payload: SystemStatusWirePayload = {
        running: true,
        listenMode: 'uds',
        transports: ['uds'],
        port: null,
        clients: 1,
        agents: 0,
        maxAgents: 8,
        version: '0.1.0',
        uptimeSeconds: 5,
        cpuPercent: 1.0,
        memoryBytes: 1024,
        fingerprint: 'abc123',
        protocolVersion: '2.0',
        host: {
          os: 'macos',
          arch: 'aarch64',
          hasDisplay: true,
          locality: 'local',
        },
      };
      const next = daemonHealthReducer(
        connected,
        systemStatusSuccess(payload, '2026-08-11T00:00:00.000Z'),
      );

      expect(next.stats?.transport).toEqual(bootTransport);
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
