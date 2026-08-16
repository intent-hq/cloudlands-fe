/**
 * Connections Slice Tests
 *
 * Tests for the multi-backend connect Redux reducer.
 */

import { describe, it, expect } from 'vitest';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import {
  connectionsReducer,
  initialState,
  connectionsListReceived,
  connectOperationStarted,
  connectOperationSettled,
  connectOperationFailed,
  certMismatchReceived,
  certMismatchCleared,
  authRejectedReceived,
  protocolMismatchReceived,
  protocolMismatchModalDismissed,
} from './connections-slice';
import type {
  ConnectionRecord,
  ConnectionsListResult,
  ConnectionAuthRejectedEvent,
  ConnectionCertMismatchEvent,
  ConnectionProtocolMismatchEvent,
} from './connections-types';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';

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

const CERT_MISMATCH: ConnectionCertMismatchEvent = {
  id: 'remote-1',
  host: '10.0.0.5',
  port: 8443,
  expectedFingerprint: 'AB:CD',
  actualFingerprint: 'EF:01',
};

const AUTH_REJECTED: ConnectionAuthRejectedEvent = {
  id: 'remote-1',
  host: '10.0.0.5',
  port: 8443,
  statusCode: 401,
};

const PROTOCOL_MISMATCH: ConnectionProtocolMismatchEvent = {
  id: 'remote-1',
  host: '10.0.0.5',
  port: 8443,
  localProtocolVersion: '1',
  remoteProtocolVersion: '2',
};

describe('connectionsReducer', () => {
  it('has the correct initial state', () => {
    expect(getItems(initialState.connections)).toEqual([]);
    expect(initialState.activeId).toBe(LOCAL_CONNECTION_ID);
  });

  describe('connectionsListReceived', () => {
    it('sets the connections list and active id', () => {
      const result: ConnectionsListResult = {
        connections: [LOCAL, REMOTE],
        activeId: 'remote-1',
      };
      const next = connectionsReducer(initialState, connectionsListReceived(result));
      expect(getItems(next.connections)).toEqual([LOCAL, REMOTE]);
      expect(next.activeId).toBe('remote-1');
    });

    it('leaves op-status and cert-mismatch untouched (they are separate concerns)', () => {
      const state = { ...initialState, status: 'connecting' as const, certMismatch: CERT_MISMATCH };
      const next = connectionsReducer(
        state,
        connectionsListReceived({ connections: [LOCAL], activeId: LOCAL_CONNECTION_ID }),
      );
      expect(next.status).toBe('connecting');
      expect(next.certMismatch).toEqual(CERT_MISMATCH);
    });
  });

  describe('connect operation status', () => {
    it('connectOperationStarted moves to connecting and clears the error', () => {
      const state = { ...initialState, status: 'error' as const, error: 'boom' };
      const next = connectionsReducer(state, connectOperationStarted());
      expect(next.status).toBe('connecting');
      expect(next.error).toBeNull();
    });

    it('connectOperationSettled returns to idle', () => {
      const state = { ...initialState, status: 'connecting' as const };
      const next = connectionsReducer(state, connectOperationSettled());
      expect(next.status).toBe('idle');
      expect(next.error).toBeNull();
    });

    it('connectOperationFailed records the error', () => {
      const state = { ...initialState, status: 'connecting' as const };
      const next = connectionsReducer(state, connectOperationFailed('unreachable'));
      expect(next.status).toBe('error');
      expect(next.error).toBe('unreachable');
    });
  });

  describe('cert mismatch', () => {
    it('certMismatchReceived stores the event', () => {
      const next = connectionsReducer(initialState, certMismatchReceived(CERT_MISMATCH));
      expect(next.certMismatch).toEqual(CERT_MISMATCH);
    });

    it('certMismatchCleared drops the stored event', () => {
      const state = { ...initialState, certMismatch: CERT_MISMATCH };
      const next = connectionsReducer(state, certMismatchCleared());
      expect(next.certMismatch).toBeNull();
    });
  });

  describe('auth rejected', () => {
    it('authRejectedReceived latches the event', () => {
      const next = connectionsReducer(initialState, authRejectedReceived(AUTH_REJECTED));
      expect(next.authRejected).toEqual(AUTH_REJECTED);
    });

    it('connectOperationStarted clears the latch (re-pair or switch supersedes it)', () => {
      const state = { ...initialState, authRejected: AUTH_REJECTED };
      const next = connectionsReducer(state, connectOperationStarted());
      expect(next.authRejected).toBeNull();
      expect(next.status).toBe('connecting');
    });

    it('connectionsListReceived leaves the latch untouched', () => {
      const state = { ...initialState, authRejected: AUTH_REJECTED };
      const next = connectionsReducer(
        state,
        connectionsListReceived({ connections: [LOCAL, REMOTE], activeId: 'remote-1' }),
      );
      expect(next.authRejected).toEqual(AUTH_REJECTED);
    });
  });

  describe('protocol mismatch', () => {
    it('protocolMismatchReceived stores the event and un-dismisses the modal', () => {
      const state = { ...initialState, protocolMismatchModalDismissed: true };
      const next = connectionsReducer(state, protocolMismatchReceived(PROTOCOL_MISMATCH));
      expect(next.protocolMismatch).toEqual(PROTOCOL_MISMATCH);
      expect(next.protocolMismatchModalDismissed).toBe(false);
    });

    it('switch-origin event un-dismisses the modal (explicit switch is modal-worthy)', () => {
      const event: ConnectionProtocolMismatchEvent = { ...PROTOCOL_MISMATCH, origin: 'switch' };
      const state = { ...initialState, protocolMismatchModalDismissed: true };
      const next = connectionsReducer(state, protocolMismatchReceived(event));
      expect(next.protocolMismatch).toEqual(event);
      expect(next.protocolMismatchModalDismissed).toBe(false);
    });

    it('boot-origin event latches the mismatch but keeps the modal suppressed', () => {
      const event: ConnectionProtocolMismatchEvent = { ...PROTOCOL_MISMATCH, origin: 'boot' };
      const next = connectionsReducer(initialState, protocolMismatchReceived(event));
      expect(next.protocolMismatch).toEqual(event);
      expect(next.protocolMismatchModalDismissed).toBe(true);
    });

    it('protocolMismatchModalDismissed keeps the event but hides the modal (warn-but-allow)', () => {
      const state = { ...initialState, protocolMismatch: PROTOCOL_MISMATCH };
      const next = connectionsReducer(state, protocolMismatchModalDismissed());
      expect(next.protocolMismatch).toEqual(PROTOCOL_MISMATCH);
      expect(next.protocolMismatchModalDismissed).toBe(true);
    });

    it('connectionsListReceived leaves the protocol-mismatch state untouched', () => {
      const state = { ...initialState, protocolMismatch: PROTOCOL_MISMATCH };
      const next = connectionsReducer(
        state,
        connectionsListReceived({ connections: [LOCAL, REMOTE], activeId: 'remote-1' }),
      );
      expect(next.protocolMismatch).toEqual(PROTOCOL_MISMATCH);
    });
  });
});
