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
  selectDaemonVersionComparison,
  selectDaemonStatusCheckFailure,
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

  it('reads the last status-check failure context (#4439)', () => {
    expect(selectDaemonStatusCheckFailure.select(stateWith({}))).toBeNull();
    const failure = {
      kind: 'timeout' as const,
      failedAt: '2026-09-05T10:00:00.000Z',
      consecutiveFailures: 2,
    };
    expect(
      selectDaemonStatusCheckFailure.select(stateWith({ statusCheckFailure: failure })),
    ).toEqual(failure);
  });
});

describe('selectDaemonVersionComparison', () => {
  function versionState(daemonVersion?: string, pinnedVersion?: string): StoreState {
    return {
      daemonHealth: {
        ...initialState,
        stats:
          daemonVersion === undefined
            ? { clients: 0, agents: 0, listenMode: 'uds', os: 'linux', arch: 'x64' }
            : {
                clients: 0,
                agents: 0,
                listenMode: 'uds',
                os: 'linux',
                arch: 'x64',
                version: daemonVersion,
              },
        transport:
          pinnedVersion === undefined
            ? { mode: 'sidecar-uds' as const }
            : { mode: 'sidecar-uds' as const, pinnedVersion },
      },
    } as unknown as StoreState;
  }

  it('reports equal when the daemon version matches the pin', () => {
    expect(selectDaemonVersionComparison.select(versionState('0.9.3', '0.9.3'))).toEqual({
      comparison: 'equal',
      daemonVersion: '0.9.3',
      pinnedVersion: '0.9.3',
    });
  });

  it('reports older when the daemon is behind the pin', () => {
    expect(selectDaemonVersionComparison.select(versionState('0.9.2', '0.9.3'))).toEqual({
      comparison: 'older',
      daemonVersion: '0.9.2',
      pinnedVersion: '0.9.3',
    });
  });

  it('reports newer when the daemon is ahead of the pin', () => {
    expect(selectDaemonVersionComparison.select(versionState('1.0.0', '0.9.3'))).toEqual({
      comparison: 'newer',
      daemonVersion: '1.0.0',
      pinnedVersion: '0.9.3',
    });
  });

  it('returns null when stats.version is missing (older daemon)', () => {
    expect(selectDaemonVersionComparison.select(versionState(undefined, '0.9.3'))).toBeNull();
  });

  it('returns null when the transport carries no pinnedVersion', () => {
    expect(selectDaemonVersionComparison.select(versionState('0.9.3', undefined))).toBeNull();
  });

  it('returns null before any system.status poll or transport info', () => {
    const empty = { daemonHealth: { ...initialState } } as unknown as StoreState;
    expect(selectDaemonVersionComparison.select(empty)).toBeNull();
  });

  it('reports unknown (no mismatch) for an unparsable version', () => {
    expect(selectDaemonVersionComparison.select(versionState('dev-build', '0.9.3'))).toEqual({
      comparison: 'unknown',
      daemonVersion: 'dev-build',
      pinnedVersion: '0.9.3',
    });
  });
});
