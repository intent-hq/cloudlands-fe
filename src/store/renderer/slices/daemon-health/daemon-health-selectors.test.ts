/**
 * Daemon Health Selectors Tests
 *
 * Pins the locality gate for host-shell affordances: the transport-mode
 * matrix of `isLocalTransport` (including the null→local default) and
 * `selectIsDaemonLocal`'s preference for the daemon-reported `host.locality`
 * over the FE transport heuristic (PROTOCOL §5.12/§5.14).
 */

import { describe, it, expect } from 'vitest';
import type { StoreState } from '../../types';
import type { BackendTransportInfo } from './daemon-health-types';
import {
  isLocalTransport,
  selectIsDaemonLocal,
  selectSidecarStartupFailed,
  selectSidecarStartupFailedReason,
  selectHasEverConnected,
  selectSidecarRunLog,
  selectSidecarRunLogPending,
  selectSidecarRunLogError,
} from './daemon-health-selectors';
import { initialState } from './daemon-health-slice';

function mockState(
  transport: BackendTransportInfo | null,
  hostLocality: 'local' | 'remote' | null = null,
): StoreState {
  return {
    daemonHealth: { ...initialState, transport, hostLocality },
  } as unknown as StoreState;
}

describe('isLocalTransport', () => {
  it('treats the Electron-spawned sidecar UDS as local', () => {
    expect(isLocalTransport({ mode: 'sidecar-uds' })).toBe(true);
  });

  it('treats an adopted external UDS daemon as local', () => {
    expect(isLocalTransport({ mode: 'external-uds' })).toBe(true);
  });

  it('treats a WebSocket daemon as remote', () => {
    expect(isLocalTransport({ mode: 'external-ws' })).toBe(false);
  });

  it('defaults to local before any transport info arrives', () => {
    // Safe: the remote-WS build reports external-ws on its very first
    // backend:status event, so the optimistic default never leaks a
    // remote-host reveal.
    expect(isLocalTransport(null)).toBe(true);
  });
});

describe('selectIsDaemonLocal', () => {
  it('falls back to the transport heuristic before the first system.status poll', () => {
    expect(selectIsDaemonLocal.select(mockState({ mode: 'sidecar-uds' }, null))).toBe(true);
    expect(selectIsDaemonLocal.select(mockState({ mode: 'external-ws' }, null))).toBe(false);
    expect(selectIsDaemonLocal.select(mockState(null, null))).toBe(true);
  });

  it('prefers daemon-reported locality over the transport heuristic (forced remote over UDS)', () => {
    expect(selectIsDaemonLocal.select(mockState({ mode: 'sidecar-uds' }, 'remote'))).toBe(false);
  });

  it('prefers daemon-reported locality over the transport heuristic (forced local over WS)', () => {
    expect(selectIsDaemonLocal.select(mockState({ mode: 'external-ws' }, 'local'))).toBe(true);
  });
});

describe('sidecar startup-failure + hasEverConnected selectors', () => {
  function stateWith(overrides: Partial<typeof initialState>): StoreState {
    return { daemonHealth: { ...initialState, ...overrides } } as unknown as StoreState;
  }

  it('reads the sidecarStartupFailed latch and its reason', () => {
    expect(selectSidecarStartupFailed.select(stateWith({}))).toBe(false);
    expect(selectSidecarStartupFailedReason.select(stateWith({}))).toBeNull();
    const failed = stateWith({
      sidecarStartupFailed: true,
      sidecarStartupFailedReason: 'intentd binary not found',
    });
    expect(selectSidecarStartupFailed.select(failed)).toBe(true);
    expect(selectSidecarStartupFailedReason.select(failed)).toBe('intentd binary not found');
  });

  it('reads the session hasEverConnected latch', () => {
    expect(selectHasEverConnected.select(stateWith({}))).toBe(false);
    expect(selectHasEverConnected.select(stateWith({ hasEverConnected: true }))).toBe(true);
  });

  it('reads the sidecar run-log fetch state', () => {
    expect(selectSidecarRunLog.select(stateWith({}))).toBeNull();
    expect(selectSidecarRunLogPending.select(stateWith({}))).toBe(false);
    expect(selectSidecarRunLogError.select(stateWith({}))).toBeNull();
    const runLog = {
      available: false,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      signal: null,
      spawnError: null,
      lines: [],
    };
    const fetched = stateWith({
      sidecarRunLog: runLog,
      sidecarRunLogPending: true,
      sidecarRunLogError: 'bridge unavailable',
    });
    expect(selectSidecarRunLog.select(fetched)).toEqual(runLog);
    expect(selectSidecarRunLogPending.select(fetched)).toBe(true);
    expect(selectSidecarRunLogError.select(fetched)).toBe('bridge unavailable');
  });
});
