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
  openOperationStarted,
  openOperationSettled,
  openOperationFailed,
  certMismatchReceived,
  certMismatchCleared,
  certWarningsReceived,
  authRejectedReceived,
  keychainSyncStateCleared,
  keychainSyncStateReceived,
  keychainSyncStatusReceived,
  loadKeychainSyncStateRequested,
  loadSelfPublishedStateRequested,
  publishSelfRequested,
  saveConnectionRequested,
  setKeychainSyncEnabledRequested,
  unpublishSelfRequested,
  protocolMismatchReceived,
  protocolMismatchModalDismissed,
} from './connections-slice';
import type {
  ConnectionRecord,
  ConnectionsListResult,
  ConnectionAuthRejectedEvent,
  ConnectionCertMismatchEvent,
  ConnectionHostCertWarning,
  ConnectionProtocolMismatchEvent,
  KeychainSyncStateResult,
} from './connections-types';
import { createCollection, getItems } from '@augmentcode/themis/utils/collections/collection-utils';

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
  accent: 'blue',
  host: '10.0.0.5',
  port: 8443,
  fingerprint: 'AB:CD',
  isLocal: false,
  status: 'not-open',
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

const HOST_WARNING: ConnectionHostCertWarning = {
  host: '10.0.0.6',
  expectedFingerprint: 'AB:CD',
  actualFingerprint: 'EF:01',
};

// State stores per-id host-keyed collections; tests build them from arrays.
function warningsCollection(...warnings: ConnectionHostCertWarning[]) {
  return createCollection<ConnectionHostCertWarning, 'host'>('host', warnings);
}

const LIST_RESULT: ConnectionsListResult = {
  connections: [LOCAL, REMOTE],
  activeId: 'remote-1',
  windowBackendId: 'remote-1',
};

describe('connectionsReducer', () => {
  it('has the correct initial state', () => {
    expect(getItems(initialState.connections)).toEqual([]);
    expect(initialState.activeId).toBe(LOCAL_CONNECTION_ID);
    expect(initialState.windowBackendId).toBe(LOCAL_CONNECTION_ID);
  });

  describe('connectionsListReceived', () => {
    it('sets the connections list and active id', () => {
      const result: ConnectionsListResult = {
        connections: [LOCAL, REMOTE],
        activeId: 'remote-1',
        windowBackendId: LOCAL_CONNECTION_ID,
      };
      const next = connectionsReducer(initialState, connectionsListReceived(result));
      expect(getItems(next.connections)).toEqual([LOCAL, REMOTE]);
      expect(next.activeId).toBe('remote-1');
      expect(next.windowBackendId).toBe(LOCAL_CONNECTION_ID);
    });

    it('latches hasReceivedList once the first list lands', () => {
      expect(initialState.hasReceivedList).toBe(false);
      const next = connectionsReducer(
        initialState,
        connectionsListReceived({
          connections: [LOCAL],
          activeId: LOCAL_CONNECTION_ID,
          windowBackendId: LOCAL_CONNECTION_ID,
        }),
      );
      expect(next.hasReceivedList).toBe(true);
    });

    it('replaces transient status when a pooled-client refresh arrives', () => {
      const opened = { ...REMOTE, status: 'connected' as const };
      const next = connectionsReducer(
        initialState,
        connectionsListReceived({
          connections: [LOCAL, opened],
          activeId: LOCAL_CONNECTION_ID,
          windowBackendId: LOCAL_CONNECTION_ID,
        }),
      );
      expect(
        getItems(next.connections).find((connection) => connection.id === REMOTE.id)?.status,
      ).toBe('connected');
    });

    it('stores the pinned intentd version and per-connection daemonVersion from the payload', () => {
      expect(initialState.pinnedVersion).toBeNull();
      const remoteWithVersion: ConnectionRecord = { ...REMOTE, daemonVersion: '0.8.10' };
      const next = connectionsReducer(
        initialState,
        connectionsListReceived({
          connections: [LOCAL, remoteWithVersion],
          activeId: LOCAL_CONNECTION_ID,
          windowBackendId: LOCAL_CONNECTION_ID,
          pinnedVersion: '0.8.10',
        }),
      );
      expect(next.pinnedVersion).toBe('0.8.10');
      expect(getItems(next.connections)[1].daemonVersion).toBe('0.8.10');
    });

    it('keeps a known pinnedVersion when the payload omits the field (older main process)', () => {
      const state = { ...initialState, pinnedVersion: '0.8.10' };
      const next = connectionsReducer(
        state,
        connectionsListReceived({
          connections: [LOCAL],
          activeId: LOCAL_CONNECTION_ID,
          windowBackendId: LOCAL_CONNECTION_ID,
        }),
      );
      expect(next.pinnedVersion).toBe('0.8.10');
    });

    it('leaves op-status and cert-mismatch untouched (they are separate concerns)', () => {
      const state = { ...initialState, status: 'connecting' as const, certMismatch: CERT_MISMATCH };
      const next = connectionsReducer(
        state,
        connectionsListReceived({
          connections: [LOCAL],
          activeId: LOCAL_CONNECTION_ID,
          windowBackendId: LOCAL_CONNECTION_ID,
        }),
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

  describe('per-id open operations', () => {
    it('starts with no opens in flight', () => {
      expect(initialState.openingIds).toEqual([]);
    });

    it('openOperationStarted records the id, moves to connecting and clears latches', () => {
      const state = {
        ...initialState,
        status: 'error' as const,
        error: 'boom',
        authRejected: AUTH_REJECTED,
      };
      const next = connectionsReducer(state, openOperationStarted('remote-1'));
      expect(next.openingIds).toEqual(['remote-1']);
      expect(next.status).toBe('connecting');
      expect(next.error).toBeNull();
      expect(next.authRejected).toBeNull();
    });

    it('openOperationStarted tracks one entry per operation, including a repeat of the same id', () => {
      let state = connectionsReducer(initialState, openOperationStarted('remote-1'));
      state = connectionsReducer(state, openOperationStarted('remote-2'));
      state = connectionsReducer(state, openOperationStarted('remote-1'));
      expect(state.openingIds).toEqual(['remote-1', 'remote-2', 'remote-1']);
    });

    it('settling one of two same-id opens keeps the id in flight and status connecting', () => {
      let state = connectionsReducer(initialState, openOperationStarted('remote-1'));
      state = connectionsReducer(state, openOperationStarted('remote-1'));
      const afterFirst = connectionsReducer(state, openOperationSettled('remote-1'));
      expect(afterFirst.openingIds).toEqual(['remote-1']);
      expect(afterFirst.status).toBe('connecting');
      const afterSecond = connectionsReducer(afterFirst, openOperationSettled('remote-1'));
      expect(afterSecond.openingIds).toEqual([]);
      expect(afterSecond.status).toBe('idle');
    });

    it('failing one of two same-id opens keeps the other in flight', () => {
      let state = connectionsReducer(initialState, openOperationStarted('remote-1'));
      state = connectionsReducer(state, openOperationStarted('remote-1'));
      const next = connectionsReducer(state, openOperationFailed('remote-1', 'unreachable'));
      expect(next.openingIds).toEqual(['remote-1']);
      expect(next.status).toBe('error');
      expect(next.error).toBe('unreachable');
    });

    it('settling an id that is not in flight is a no-op on the list', () => {
      const state = connectionsReducer(initialState, openOperationStarted('remote-1'));
      const next = connectionsReducer(state, openOperationSettled('remote-2'));
      expect(next.openingIds).toEqual(['remote-1']);
      expect(next.status).toBe('connecting');
    });

    it('openOperationSettled keeps status connecting while another open is in flight', () => {
      let state = connectionsReducer(initialState, openOperationStarted('remote-1'));
      state = connectionsReducer(state, openOperationStarted('remote-2'));
      const next = connectionsReducer(state, openOperationSettled('remote-1'));
      expect(next.openingIds).toEqual(['remote-2']);
      expect(next.status).toBe('connecting');
    });

    it('openOperationSettled returns to idle once the last open settles', () => {
      let state = connectionsReducer(initialState, openOperationStarted('remote-1'));
      state = connectionsReducer(state, openOperationStarted('remote-2'));
      state = connectionsReducer(state, openOperationSettled('remote-1'));
      const next = connectionsReducer(state, openOperationSettled('remote-2'));
      expect(next.openingIds).toEqual([]);
      expect(next.status).toBe('idle');
      expect(next.error).toBeNull();
    });

    it('openOperationFailed drops the id and records the error', () => {
      let state = connectionsReducer(initialState, openOperationStarted('remote-1'));
      state = connectionsReducer(state, openOperationStarted('remote-2'));
      const next = connectionsReducer(state, openOperationFailed('remote-1', 'unreachable'));
      expect(next.openingIds).toEqual(['remote-2']);
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

    it('certMismatchReceived seeds the per-host warnings from its mismatches list', () => {
      const next = connectionsReducer(
        initialState,
        certMismatchReceived({ ...CERT_MISMATCH, mismatches: [HOST_WARNING] }),
      );
      expect(getItems(next.certWarnings['remote-1'])).toEqual([HOST_WARNING]);
    });

    it('certMismatchReceived without mismatches leaves existing warnings untouched', () => {
      const state = {
        ...initialState,
        certWarnings: { 'remote-1': warningsCollection(HOST_WARNING) },
      };
      const next = connectionsReducer(state, certMismatchReceived(CERT_MISMATCH));
      expect(getItems(next.certWarnings['remote-1'])).toEqual([HOST_WARNING]);
    });
  });

  describe('cert warnings (non-fatal, per-host)', () => {
    it('certWarningsReceived stores the warnings under the connection id', () => {
      const next = connectionsReducer(
        initialState,
        certWarningsReceived({ id: 'remote-1', warnings: [HOST_WARNING] }),
      );
      expect(getItems(next.certWarnings['remote-1'])).toEqual([HOST_WARNING]);
    });

    it('certWarningsReceived replaces the previous set for the same id', () => {
      const updated: ConnectionHostCertWarning = { ...HOST_WARNING, actualFingerprint: '12:34' };
      const state = {
        ...initialState,
        certWarnings: { 'remote-1': warningsCollection(HOST_WARNING) },
      };
      const next = connectionsReducer(
        state,
        certWarningsReceived({ id: 'remote-1', warnings: [updated] }),
      );
      expect(getItems(next.certWarnings['remote-1'])).toEqual([updated]);
    });

    it('an empty warnings push clears the entry (fresh client for the id)', () => {
      const state = {
        ...initialState,
        certWarnings: {
          'remote-1': warningsCollection(HOST_WARNING),
          'remote-2': warningsCollection(HOST_WARNING),
        },
      };
      const next = connectionsReducer(
        state,
        certWarningsReceived({ id: 'remote-1', warnings: [] }),
      );
      expect(next.certWarnings['remote-1']).toBeUndefined();
      expect(getItems(next.certWarnings['remote-2'])).toEqual([HOST_WARNING]);
    });

    it('an empty push for an unknown id is a no-op', () => {
      const next = connectionsReducer(
        initialState,
        certWarningsReceived({ id: 'remote-9', warnings: [] }),
      );
      expect(next).toBe(initialState);
    });

    it('connectionsListReceived replays the window backend warnings', () => {
      const next = connectionsReducer(
        initialState,
        connectionsListReceived({
          ...LIST_RESULT,
          certWarnings: { id: 'remote-1', warnings: [HOST_WARNING] },
        }),
      );
      expect(getItems(next.certWarnings['remote-1'])).toEqual([HOST_WARNING]);
    });

    it('connectionsListReceived with an empty replay clears the entry', () => {
      const state = {
        ...initialState,
        certWarnings: { 'remote-1': warningsCollection(HOST_WARNING) },
      };
      const next = connectionsReducer(
        state,
        connectionsListReceived({
          ...LIST_RESULT,
          certWarnings: { id: 'remote-1', warnings: [] },
        }),
      );
      expect(next.certWarnings['remote-1']).toBeUndefined();
    });

    it('connectionsListReceived with certWarnings: null clears the window backend entry', () => {
      // Regression (#1983 review): a `null` replay carries no id — it must
      // still drop the stale entry latched for this window's backend.
      const state = {
        ...initialState,
        certWarnings: {
          'remote-1': warningsCollection(HOST_WARNING),
          'remote-2': warningsCollection(HOST_WARNING),
        },
      };
      const next = connectionsReducer(
        state,
        connectionsListReceived({ ...LIST_RESULT, certWarnings: null }),
      );
      expect(next.certWarnings['remote-1']).toBeUndefined();
      expect(getItems(next.certWarnings['remote-2'])).toEqual([HOST_WARNING]);
    });

    it('connectionsListReceived with certWarnings: null and no latched entry is a no-op', () => {
      const state = {
        ...initialState,
        certWarnings: { 'remote-2': warningsCollection(HOST_WARNING) },
      };
      const next = connectionsReducer(
        state,
        connectionsListReceived({ ...LIST_RESULT, certWarnings: null }),
      );
      expect(getItems(next.certWarnings['remote-2'])).toEqual([HOST_WARNING]);
    });

    it('connectionsListReceived without the field leaves warnings untouched (older main)', () => {
      const state = {
        ...initialState,
        certWarnings: { 'remote-1': warningsCollection(HOST_WARNING) },
      };
      const next = connectionsReducer(state, connectionsListReceived(LIST_RESULT));
      expect(getItems(next.certWarnings['remote-1'])).toEqual([HOST_WARNING]);
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

    it('connectionsListReceived leaves the latch untouched when the field is absent', () => {
      const state = { ...initialState, authRejected: AUTH_REJECTED };
      const next = connectionsReducer(
        state,
        connectionsListReceived({
          connections: [LOCAL, REMOTE],
          activeId: 'remote-1',
          windowBackendId: 'remote-1',
        }),
      );
      expect(next.authRejected).toEqual(AUTH_REJECTED);
    });

    it('connectionsListReceived with authRejected: null clears the latch (re-pair path)', () => {
      const state = { ...initialState, authRejected: AUTH_REJECTED };
      const next = connectionsReducer(
        state,
        connectionsListReceived({
          connections: [LOCAL, REMOTE],
          activeId: 'remote-1',
          windowBackendId: 'remote-1',
          authRejected: null,
        }),
      );
      expect(next.authRejected).toBeNull();
    });

    it('connectionsListReceived with a latched rejection replays it', () => {
      const next = connectionsReducer(
        initialState,
        connectionsListReceived({
          connections: [LOCAL, REMOTE],
          activeId: 'remote-1',
          windowBackendId: 'remote-1',
          authRejected: AUTH_REJECTED,
        }),
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

    it('connectionsListReceived leaves the protocol-mismatch state untouched when absent', () => {
      const state = { ...initialState, protocolMismatch: PROTOCOL_MISMATCH };
      const next = connectionsReducer(
        state,
        connectionsListReceived({
          connections: [LOCAL, REMOTE],
          activeId: 'remote-1',
          windowBackendId: 'remote-1',
        }),
      );
      expect(next.protocolMismatch).toEqual(PROTOCOL_MISMATCH);
    });

    it('connectionsListReceived with protocolMismatch: null clears the advisory', () => {
      const state = {
        ...initialState,
        protocolMismatch: PROTOCOL_MISMATCH,
        protocolMismatchModalDismissed: true,
      };
      const next = connectionsReducer(
        state,
        connectionsListReceived({
          connections: [LOCAL, REMOTE],
          activeId: 'remote-1',
          windowBackendId: 'remote-1',
          protocolMismatch: null,
        }),
      );
      expect(next.protocolMismatch).toBeNull();
      expect(next.protocolMismatchModalDismissed).toBe(false);
    });

    it('connectionsListReceived replaying a fresh mismatch applies push modal semantics', () => {
      const next = connectionsReducer(
        initialState,
        connectionsListReceived({
          connections: [LOCAL, REMOTE],
          activeId: 'remote-1',
          windowBackendId: 'remote-1',
          protocolMismatch: { ...PROTOCOL_MISMATCH, origin: 'boot' },
        }),
      );
      expect(next.protocolMismatch).toEqual({ ...PROTOCOL_MISMATCH, origin: 'boot' });
      expect(next.protocolMismatchModalDismissed).toBe(true);
    });

    it('connectionsListReceived re-replaying the stored mismatch keeps the dismissal', () => {
      const state = {
        ...initialState,
        protocolMismatch: PROTOCOL_MISMATCH,
        protocolMismatchModalDismissed: true,
      };
      const next = connectionsReducer(
        state,
        connectionsListReceived({
          connections: [LOCAL, REMOTE],
          activeId: 'remote-1',
          windowBackendId: 'remote-1',
          protocolMismatch: PROTOCOL_MISMATCH,
        }),
      );
      expect(next.protocolMismatch).toEqual(PROTOCOL_MISMATCH);
      expect(next.protocolMismatchModalDismissed).toBe(true);
    });
  });

  describe('keychain sync (T4)', () => {
    const SYNC_STATE: KeychainSyncStateResult = {
      supported: true,
      enabled: true,
      status: { state: 'active' },
    };

    it('keychainSyncStateReceived stores the full state', () => {
      const next = connectionsReducer(initialState, keychainSyncStateReceived(SYNC_STATE));
      expect(next.keychainSync).toEqual(SYNC_STATE);
    });

    it('keychainSyncStateCleared removes only the loaded sync state', () => {
      const failed = connectionsReducer(initialState, connectOperationFailed('connection failed'));
      const loaded = connectionsReducer(failed, keychainSyncStateReceived(SYNC_STATE));
      const next = connectionsReducer(loaded, keychainSyncStateCleared());

      expect(next).toEqual(failed);
      expect(next.connections).toBe(loaded.connections);
      expect(loaded.keychainSync).toEqual(SYNC_STATE);
    });

    it('keychainSyncStateCleared preserves identity when already unloaded', () => {
      expect(connectionsReducer(initialState, keychainSyncStateCleared())).toBe(initialState);
    });

    it('keychainSyncStatusReceived refreshes only the status of a loaded state', () => {
      const state = { ...initialState, keychainSync: SYNC_STATE };
      const status = {
        state: 'unavailable',
        reason: 'unavailable',
        message: 'keychain locked',
      } as const;
      const next = connectionsReducer(state, keychainSyncStatusReceived(status));
      expect(next.keychainSync).toEqual({ supported: true, enabled: true, status });
    });

    it('keychainSyncStatusReceived before the first load is dropped', () => {
      const next = connectionsReducer(
        initialState,
        keychainSyncStatusReceived({ state: 'active' }),
      );
      expect(next.keychainSync).toBeNull();
    });

    it('tracks the load request lifecycle', () => {
      const request = loadKeychainSyncStateRequested();
      void request.promise.catch(() => {});
      const loading = connectionsReducer(initialState, request);
      expect(loading.keychainSyncLoadStatus).toBe('loading');
      expect(connectionsReducer(loading, request.success(SYNC_STATE)).keychainSyncLoadStatus).toBe(
        'success',
      );
      expect(
        connectionsReducer(loading, request.failure(new Error('failed'))).keychainSyncLoadStatus,
      ).toBe('error');
    });

    it('correlates write results and ignores stale completions', () => {
      const first = setKeychainSyncEnabledRequested(true, 'sync-1');
      const second = setKeychainSyncEnabledRequested(false, 'sync-2');
      void first.promise.catch(() => {});
      void second.promise.catch(() => {});
      const firstLoading = connectionsReducer(initialState, first);
      const secondLoading = connectionsReducer(firstLoading, second);
      expect(secondLoading.keychainSyncWriteOperation).toMatchObject({
        requestId: 'sync-2',
        status: 'loading',
        version: 2,
      });
      expect(connectionsReducer(secondLoading, first.success(SYNC_STATE))).toBe(secondLoading);
      expect(connectionsReducer(secondLoading, first.failure(new Error('stale')))).toBe(
        secondLoading,
      );
      const settled = connectionsReducer(
        secondLoading,
        second.success({ ...SYNC_STATE, enabled: false }),
      );
      expect(settled.keychainSyncWriteOperation).toMatchObject({
        requestId: 'sync-2',
        status: 'success',
        result: { enabled: false },
      });
      expect(settled.keychainSync?.enabled).toBe(false);
    });
  });

  describe('per-id save operations', () => {
    const params = {
      update: { id: 'remote-1', label: 'Studio Mac', accent: null },
    } as const;

    it('keeps the current request loading when an older save settles', () => {
      const first = saveConnectionRequested(params, 'save-1');
      const second = saveConnectionRequested(params, 'save-2');
      void first.promise.catch(() => {});
      void second.promise.catch(() => {});
      const firstLoading = connectionsReducer(initialState, first);
      const secondLoading = connectionsReducer(firstLoading, second);
      const result = {
        stage: 'update' as const,
        result: { status: 'updated' as const, connection: REMOTE },
      };

      expect(connectionsReducer(secondLoading, first.success(result))).toBe(secondLoading);
      expect(connectionsReducer(secondLoading, first.failure(new Error('stale')))).toBe(
        secondLoading,
      );
      expect(
        connectionsReducer(secondLoading, second.success(result)).saveOperations['remote-1'],
      ).toMatchObject({ requestId: 'save-2', status: 'success', result });
    });
  });

  describe('self-publish operations', () => {
    const SELF_STATE = { published: false, suppressed: true, selfConnectionId: null };

    it('tracks loading, success, and failure for the state read', () => {
      const request = loadSelfPublishedStateRequested();
      void request.promise.catch(() => {});
      const loading = connectionsReducer(initialState, request);
      expect(loading.selfPublishedStateStatus).toBe('loading');
      const success = connectionsReducer(loading, request.success(SELF_STATE));
      expect(success.selfPublishedState).toEqual(SELF_STATE);
      expect(success.selfPublishedStateStatus).toBe('success');
      expect(
        connectionsReducer(loading, request.failure(new Error('failed'))).selfPublishedStateStatus,
      ).toBe('error');
    });

    it('tracks publish acknowledgement and error state', () => {
      const request = publishSelfRequested();
      void request.promise.catch(() => {});
      const loading = connectionsReducer(
        { ...initialState, selfPublishedState: SELF_STATE },
        request,
      );
      expect(loading).toMatchObject({ selfPublishStatus: 'loading', selfPublishVersion: 1 });
      const success = connectionsReducer(loading, request.success({ connection: LOCAL }));
      expect(success.selfPublishedState).toMatchObject({ published: true, suppressed: false });
      expect(success.selfPublishStatus).toBe('success');
      const failure = connectionsReducer(loading, request.failure(new Error('failed')));
      expect(failure).toMatchObject({ selfPublishStatus: 'error', selfPublishError: 'failed' });
    });

    it('tracks unpublish acknowledgement and whether a record was removed', () => {
      const request = unpublishSelfRequested();
      void request.promise.catch(() => {});
      const published = { published: true, suppressed: false, selfConnectionId: LOCAL.id };
      const loading = connectionsReducer(
        { ...initialState, selfPublishedState: published },
        request,
      );
      expect(loading).toMatchObject({ selfUnpublishStatus: 'loading', selfUnpublishVersion: 1 });
      const success = connectionsReducer(loading, request.success({ removed: true }));
      expect(success.selfPublishedState?.published).toBe(false);
      expect(success).toMatchObject({ selfUnpublishStatus: 'success', selfUnpublishRemoved: true });
      const failure = connectionsReducer(loading, request.failure(new Error('failed')));
      expect(failure).toMatchObject({ selfUnpublishStatus: 'error', selfUnpublishError: 'failed' });
    });
  });
});
