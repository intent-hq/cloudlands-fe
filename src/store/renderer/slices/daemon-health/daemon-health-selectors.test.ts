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
import { isLocalTransport, selectIsDaemonLocal } from './daemon-health-selectors';
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
