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
} from './connections-slice';
import type {
  ConnectionRecord,
  ConnectionsListResult,
  ConnectionCertMismatchEvent,
} from './connections-types';

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

describe('connectionsReducer', () => {
  it('has the correct initial state', () => {
    expect(initialState).toEqual({
      connections: [],
      activeId: LOCAL_CONNECTION_ID,
      status: 'idle',
      error: null,
      certMismatch: null,
    });
  });

  describe('connectionsListReceived', () => {
    it('sets the connections list and active id', () => {
      const result: ConnectionsListResult = {
        connections: [LOCAL, REMOTE],
        activeId: 'remote-1',
      };
      const next = connectionsReducer(initialState, connectionsListReceived(result));
      expect(next.connections).toEqual([LOCAL, REMOTE]);
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
});
