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
} from './daemon-health-slice';
import type { SystemStatusWirePayload } from './daemon-health-types';

describe('daemonHealthReducer', () => {
  it('has the correct initial state', () => {
    expect(initialState).toEqual({
      health: 'down',
      stats: null,
      lastUpdated: null,
      polling: false,
    });
  });

  describe('connectionStatusChanged', () => {
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
