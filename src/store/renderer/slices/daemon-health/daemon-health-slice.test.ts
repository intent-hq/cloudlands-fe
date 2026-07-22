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
} from './daemon-health-slice';
import type { BackendTransportInfo, SystemStatusWirePayload } from './daemon-health-types';

describe('daemonHealthReducer', () => {
  it('has the correct initial state', () => {
    expect(initialState).toEqual({
      health: 'down',
      stats: null,
      lastUpdated: null,
      polling: false,
      transport: null,
      sidecarGaveUp: false,
      sidecarGaveUpReason: null,
      sidecarSpawnPending: false,
      sidecarSpawnError: null,
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
});
