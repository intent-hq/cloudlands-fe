/**
 * Connections Selectors Tests
 */

import { describe, it, expect } from 'vitest';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import type { StoreState } from '../../types';
import type {
  ConnectionsState,
  ConnectionRecord,
  ConnectionProtocolMismatchEvent,
} from './connections-types';
import { initialState } from './connections-slice';
import {
  selectConnections,
  selectActiveConnectionId,
  selectActiveConnection,
  selectConnectionStatus,
  selectIsConnecting,
  selectConnectionError,
  selectConnectionCertMismatch,
  selectActiveProtocolMismatch,
  selectProtocolMismatchModal,
} from './connections-selectors';

const LOCAL: ConnectionRecord = {
  id: LOCAL_CONNECTION_ID,
  label: 'This machine (local)',
  host: null,
  port: null,
  fingerprint: null,
  isLocal: true,
};

const REMOTE: ConnectionRecord = {
  id: 'remote-1',
  label: 'Studio Mac',
  host: '10.0.0.5',
  port: 8443,
  fingerprint: 'AB:CD',
  isLocal: false,
};

function stateWith(overrides: Partial<ConnectionsState>): StoreState {
  return { connections: { ...initialState, ...overrides } } as unknown as StoreState;
}

describe('connections selectors', () => {
  it('reads the list, active id, status, error and cert-mismatch', () => {
    const state = stateWith({
      connections: [LOCAL, REMOTE],
      activeId: 'remote-1',
      status: 'error',
      error: 'boom',
      certMismatch: null,
    });
    expect(selectConnections.select(state)).toEqual([LOCAL, REMOTE]);
    expect(selectActiveConnectionId.select(state)).toBe('remote-1');
    expect(selectConnectionStatus.select(state)).toBe('error');
    expect(selectConnectionError.select(state)).toBe('boom');
    expect(selectConnectionCertMismatch.select(state)).toBeNull();
  });

  describe('selectActiveConnection', () => {
    it('resolves the active record by id', () => {
      const state = stateWith({ connections: [LOCAL, REMOTE], activeId: 'remote-1' });
      expect(selectActiveConnection.select(state)).toEqual(REMOTE);
    });

    it('returns null when the active id is not in the list (e.g. before load)', () => {
      const state = stateWith({ connections: [], activeId: LOCAL_CONNECTION_ID });
      expect(selectActiveConnection.select(state)).toBeNull();
    });
  });

  describe('selectIsConnecting', () => {
    it('is true only while an operation is in flight', () => {
      expect(selectIsConnecting.select(stateWith({ status: 'connecting' }))).toBe(true);
      expect(selectIsConnecting.select(stateWith({ status: 'idle' }))).toBe(false);
      expect(selectIsConnecting.select(stateWith({ status: 'error' }))).toBe(false);
    });
  });

  describe('protocol-mismatch selectors', () => {
    const PROTOCOL_MISMATCH: ConnectionProtocolMismatchEvent = {
      id: 'remote-1',
      host: '10.0.0.5',
      port: 8443,
      localProtocolVersion: '1',
      remoteProtocolVersion: '2',
    };

    it('surfaces the mismatch only while the affected backend is active', () => {
      const active = stateWith({ protocolMismatch: PROTOCOL_MISMATCH, activeId: 'remote-1' });
      expect(selectActiveProtocolMismatch.select(active)).toEqual(PROTOCOL_MISMATCH);

      // Switched back to local: same stored mismatch, but no longer active → hidden.
      const inactive = stateWith({
        protocolMismatch: PROTOCOL_MISMATCH,
        activeId: LOCAL_CONNECTION_ID,
      });
      expect(selectActiveProtocolMismatch.select(inactive)).toBeNull();
    });

    it('shows the modal only when active and not yet dismissed', () => {
      const shown = stateWith({
        protocolMismatch: PROTOCOL_MISMATCH,
        activeId: 'remote-1',
        protocolMismatchModalDismissed: false,
      });
      expect(selectProtocolMismatchModal.select(shown)).toEqual(PROTOCOL_MISMATCH);

      // Dismissed ("continue anyway"): modal hidden, but the menu warning stays.
      const dismissed = stateWith({
        protocolMismatch: PROTOCOL_MISMATCH,
        activeId: 'remote-1',
        protocolMismatchModalDismissed: true,
      });
      expect(selectProtocolMismatchModal.select(dismissed)).toBeNull();
      expect(selectActiveProtocolMismatch.select(dismissed)).toEqual(PROTOCOL_MISMATCH);
    });
  });
});
