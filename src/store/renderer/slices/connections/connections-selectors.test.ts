/**
 * Connections Selectors Tests
 */

import { describe, it, expect } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import type { StoreState } from '../../types';
import type {
  ConnectionsState,
  ConnectionRecord,
  ConnectionAuthRejectedEvent,
  ConnectionProtocolMismatchEvent,
} from './connections-types';
import { initialState, connectionsReducer, protocolMismatchReceived } from './connections-slice';
import {
  selectConnections,
  selectActiveConnectionId,
  selectActiveConnection,
  selectCurrentConnectionId,
  selectCurrentConnection,
  selectConnectionStatus,
  selectIsConnecting,
  selectConnectionError,
  selectConnectionCertMismatch,
  selectActiveAuthRejected,
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
  const connections = Array.isArray(overrides.connections)
    ? createCollection<ConnectionRecord, 'id'>('id', overrides.connections)
    : overrides.connections;
  return {
    connections: { ...initialState, ...overrides, ...(connections ? { connections } : {}) },
  } as unknown as StoreState;
}

describe('connections selectors', () => {
  it('reads the list, active id, status, error and cert-mismatch', () => {
    const state = stateWith({
      connections: [LOCAL, REMOTE],
      activeId: 'remote-1',
      windowBackendId: LOCAL_CONNECTION_ID,
      status: 'error',
      error: 'boom',
      certMismatch: null,
    });
    expect(selectConnections.select(state)).toEqual([LOCAL, REMOTE]);
    expect(selectActiveConnectionId.select(state)).toBe('remote-1');
    expect(selectCurrentConnectionId.select(state)).toBe(LOCAL_CONNECTION_ID);
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

  describe('current-window connection selectors', () => {
    it('resolve the window backend while persisted activeId remains local', () => {
      const state = stateWith({
        connections: [LOCAL, REMOTE],
        activeId: LOCAL_CONNECTION_ID,
        windowBackendId: REMOTE.id,
      });
      expect(selectCurrentConnectionId.select(state)).toBe(REMOTE.id);
      expect(selectCurrentConnection.select(state)).toEqual(REMOTE);
    });
  });

  describe('selectIsConnecting', () => {
    it('is true only while an operation is in flight', () => {
      expect(selectIsConnecting.select(stateWith({ status: 'connecting' }))).toBe(true);
      expect(selectIsConnecting.select(stateWith({ status: 'idle' }))).toBe(false);
      expect(selectIsConnecting.select(stateWith({ status: 'error' }))).toBe(false);
    });
  });

  describe('selectActiveAuthRejected', () => {
    const AUTH_REJECTED: ConnectionAuthRejectedEvent = {
      id: 'remote-1',
      host: '10.0.0.5',
      port: 8443,
      statusCode: 401,
    };

    it('surfaces the rejection only while the affected backend is active', () => {
      const active = stateWith({
        authRejected: AUTH_REJECTED,
        activeId: LOCAL_CONNECTION_ID,
        windowBackendId: 'remote-1',
      });
      expect(selectActiveAuthRejected.select(active)).toEqual(AUTH_REJECTED);

      // Switched back to local: same latched rejection, but no longer active → hidden.
      const inactive = stateWith({
        authRejected: AUTH_REJECTED,
        activeId: 'remote-1',
        windowBackendId: LOCAL_CONNECTION_ID,
      });
      expect(selectActiveAuthRejected.select(inactive)).toBeNull();
    });

    it('returns null when nothing is latched', () => {
      expect(selectActiveAuthRejected.select(stateWith({ activeId: 'remote-1' }))).toBeNull();
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
      const active = stateWith({
        protocolMismatch: PROTOCOL_MISMATCH,
        activeId: LOCAL_CONNECTION_ID,
        windowBackendId: 'remote-1',
      });
      expect(selectActiveProtocolMismatch.select(active)).toEqual(PROTOCOL_MISMATCH);

      // Switched back to local: same stored mismatch, but no longer active → hidden.
      const inactive = stateWith({
        protocolMismatch: PROTOCOL_MISMATCH,
        activeId: 'remote-1',
        windowBackendId: LOCAL_CONNECTION_ID,
      });
      expect(selectActiveProtocolMismatch.select(inactive)).toBeNull();
    });

    it('shows the modal only when active and not yet dismissed', () => {
      const shown = stateWith({
        protocolMismatch: PROTOCOL_MISMATCH,
        activeId: 'remote-1',
        windowBackendId: 'remote-1',
        protocolMismatchModalDismissed: false,
      });
      expect(selectProtocolMismatchModal.select(shown)).toEqual(PROTOCOL_MISMATCH);

      // Dismissed ("continue anyway"): modal hidden, but the menu warning stays.
      const dismissed = stateWith({
        protocolMismatch: PROTOCOL_MISMATCH,
        activeId: 'remote-1',
        windowBackendId: 'remote-1',
        protocolMismatchModalDismissed: true,
      });
      expect(selectProtocolMismatchModal.select(dismissed)).toBeNull();
      expect(selectActiveProtocolMismatch.select(dismissed)).toEqual(PROTOCOL_MISMATCH);
    });

    it('boot-origin mismatch keeps the menu warning but never shows the modal', () => {
      const event: ConnectionProtocolMismatchEvent = { ...PROTOCOL_MISMATCH, origin: 'boot' };
      const connections = connectionsReducer(
        { ...initialState, activeId: LOCAL_CONNECTION_ID, windowBackendId: 'remote-1' },
        protocolMismatchReceived(event),
      );
      const state = stateWith(connections);
      expect(selectActiveProtocolMismatch.select(state)).toEqual(event);
      expect(selectProtocolMismatchModal.select(state)).toBeNull();
    });

    it('switch-origin mismatch shows the modal until dismissed (unchanged behavior)', () => {
      const event: ConnectionProtocolMismatchEvent = { ...PROTOCOL_MISMATCH, origin: 'switch' };
      const connections = connectionsReducer(
        { ...initialState, activeId: LOCAL_CONNECTION_ID, windowBackendId: 'remote-1' },
        protocolMismatchReceived(event),
      );
      const state = stateWith(connections);
      expect(selectActiveProtocolMismatch.select(state)).toEqual(event);
      expect(selectProtocolMismatchModal.select(state)).toEqual(event);
    });
  });
});
