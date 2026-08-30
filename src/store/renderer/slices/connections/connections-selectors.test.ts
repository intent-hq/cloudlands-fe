/**
 * Connections Selectors Tests
 */

import { describe, it, expect } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import {
  LOCAL_CONNECTION_ID,
  SELECTABLE_CONNECTION_ACCENTS,
  isConnectionAccent,
} from '$shared/types/connections';
import {
  connectionAccentOptions,
  connectionShellTint,
  resolveConnectionAccent,
} from '$lib/utils/connection-accents';
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
  selectRemoteConnections,
  selectConnectionOpenStatus,
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
  accent: 'violet',
  host: '10.0.0.5',
  port: 8443,
  fingerprint: 'AB:CD',
  isLocal: false,
  status: 'connected',
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
  it('reads the list, window backend id, status, error and cert-mismatch', () => {
    const state = stateWith({
      connections: [LOCAL, REMOTE],
      activeId: 'remote-1',
      windowBackendId: LOCAL_CONNECTION_ID,
      status: 'error',
      error: 'boom',
      certMismatch: null,
    });
    expect(selectConnections.select(state)).toEqual([LOCAL, REMOTE]);
    expect(selectCurrentConnectionId.select(state)).toBe(LOCAL_CONNECTION_ID);
    expect(selectConnectionStatus.select(state)).toBe('error');
    expect(selectConnectionError.select(state)).toBe('boom');
    expect(selectConnectionCertMismatch.select(state)).toBeNull();
  });

  it('selects remote machines and their transient open state', () => {
    const state = stateWith({ connections: [LOCAL, REMOTE] });
    expect(selectRemoteConnections.select(state)).toEqual([REMOTE]);
    expect(selectConnectionOpenStatus.select(state, REMOTE.id)).toBe('connected');
    expect(selectConnectionOpenStatus.select(state, 'missing')).toBe('not-open');
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

    it('changes the shell tint with the backend bound to the current window', () => {
      const remoteState = stateWith({
        connections: [LOCAL, REMOTE],
        activeId: LOCAL_CONNECTION_ID,
        windowBackendId: REMOTE.id,
      });
      const remote = selectCurrentConnection.select(remoteState);
      expect(connectionShellTint(remote?.accent, remote?.isLocal ?? true)).toContain(
        'var(--color-violet-500)',
      );

      const localState = stateWith({
        connections: [LOCAL, REMOTE],
        activeId: REMOTE.id,
        windowBackendId: LOCAL_CONNECTION_ID,
      });
      const local = selectCurrentConnection.select(localState);
      expect(connectionShellTint(local?.accent, local?.isLocal ?? true)).toBeUndefined();
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

    it('surfaces the rejection only in windows bound to the affected backend', () => {
      // This window is bound to the rejected remote (even though the primary
      // stayed local): surface the rejection here.
      const boundToRejected = stateWith({
        authRejected: AUTH_REJECTED,
        activeId: LOCAL_CONNECTION_ID,
        windowBackendId: 'remote-1',
      });
      expect(selectActiveAuthRejected.select(boundToRejected)).toEqual(AUTH_REJECTED);

      // This window is bound to local; another backend's rejection is not its problem.
      const boundToLocal = stateWith({
        authRejected: AUTH_REJECTED,
        activeId: 'remote-1',
        windowBackendId: LOCAL_CONNECTION_ID,
      });
      expect(selectActiveAuthRejected.select(boundToLocal)).toBeNull();
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

    it('surfaces the mismatch only in windows bound to the affected backend', () => {
      // This window is bound to the mismatched remote (even though the primary
      // stayed local): surface the mismatch here.
      const boundToMismatched = stateWith({
        protocolMismatch: PROTOCOL_MISMATCH,
        activeId: LOCAL_CONNECTION_ID,
        windowBackendId: 'remote-1',
      });
      expect(selectActiveProtocolMismatch.select(boundToMismatched)).toEqual(PROTOCOL_MISMATCH);

      // This window is bound to local; another backend's mismatch is not its problem.
      const boundToLocal = stateWith({
        protocolMismatch: PROTOCOL_MISMATCH,
        activeId: 'remote-1',
        windowBackendId: LOCAL_CONNECTION_ID,
      });
      expect(selectActiveProtocolMismatch.select(boundToLocal)).toBeNull();
      expect(selectProtocolMismatchModal.select(boundToLocal)).toBeNull();
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
        { ...initialState, activeId: 'remote-1', windowBackendId: 'remote-1' },
        protocolMismatchReceived(event),
      );
      const state = stateWith(connections);
      expect(selectActiveProtocolMismatch.select(state)).toEqual(event);
      expect(selectProtocolMismatchModal.select(state)).toBeNull();
    });

    it('switch-origin mismatch shows the modal until dismissed (unchanged behavior)', () => {
      const event: ConnectionProtocolMismatchEvent = { ...PROTOCOL_MISMATCH, origin: 'switch' };
      const connections = connectionsReducer(
        { ...initialState, activeId: 'remote-1', windowBackendId: 'remote-1' },
        protocolMismatchReceived(event),
      );
      const state = stateWith(connections);
      expect(selectActiveProtocolMismatch.select(state)).toEqual(event);
      expect(selectProtocolMismatchModal.select(state)).toEqual(event);
    });
  });
});

describe('connection accent presentation', () => {
  it('excludes legacy and warm status colors from new choices while accepting saved values', () => {
    expect(SELECTABLE_CONNECTION_ACCENTS).toEqual(['blue', 'violet', 'emerald', 'teal']);
    for (const legacyAccent of ['indigo', 'rose', 'orange'] as const) {
      expect(isConnectionAccent(legacyAccent)).toBe(true);
      expect(connectionAccentOptions()).not.toContain(legacyAccent);
      expect(connectionAccentOptions(legacyAccent)).toContain(legacyAccent);
    }
  });

  it('distinguishes legacy missing accents from an explicit blank', () => {
    expect(resolveConnectionAccent(undefined)).toBe('blue');
    expect(resolveConnectionAccent(null)).toBeNull();
  });

  it('derives a low-opacity semantic tint only for named remote accents', () => {
    expect(connectionShellTint('teal', false)).toBe(
      'linear-gradient(color-mix(in srgb, var(--color-teal-500) 7%, transparent) 0 0)',
    );
    expect(connectionShellTint(null, false)).toBeUndefined();
    expect(connectionShellTint('teal', true)).toBeUndefined();
    expect(connectionShellTint(undefined, false)).toContain('var(--color-blue-500)');
    expect(connectionShellTint('rose', false)).toContain('var(--color-rose-500)');
    expect(connectionShellTint('orange', false)).toContain('var(--color-orange-500)');
  });
});
