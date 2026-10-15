import { describe, it, expect } from 'vitest';
import { createCollection, getItems } from '@themislib/themis/utils/collections/collection-utils';
import {
  permissionReducer,
  permissionRequestReceived,
  setPendingRequests,
  removePermissionRequest,
  initialState,
  permissionScopeChanged,
  permissionResponseStarted,
  permissionResponseFailed,
  type PermissionState,
  type PermissionRequest,
} from './permission-slice';

const makeRequest = (overrides: Partial<PermissionRequest> = {}): PermissionRequest => ({
  requestId: 'req-1',
  sessionId: 'session-1',
  title: 'Allow file access',
  options: [
    { id: 'allow_once', label: 'Allow', destructive: false },
    { id: 'reject_once', label: 'Deny', destructive: true },
  ],
  timestamp: 1000,
  ...overrides,
});

describe('permissionReducer', () => {
  it('should return initial state', () => {
    const state = permissionReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual(initialState);
  });

  describe('permissionRequestReceived', () => {
    it('should add a new permission request', () => {
      const request = makeRequest();
      const state = permissionReducer(initialState, permissionRequestReceived(request));
      expect(getItems(state.requests)).toHaveLength(1);
      expect(getItems(state.requests)[0]).toEqual(request);
    });

    it('should append to existing requests', () => {
      const prev: PermissionState = {
        ...initialState,
        requests: createCollection<PermissionRequest, 'requestId'>('requestId', [
          makeRequest({ requestId: 'req-1' }),
        ]),
      };
      const state = permissionReducer(
        prev,
        permissionRequestReceived(makeRequest({ requestId: 'req-2' })),
      );
      expect(getItems(state.requests)).toHaveLength(2);
    });
  });

  describe('setPendingRequests', () => {
    it('should add pending requests avoiding duplicates', () => {
      const existing = makeRequest({ requestId: 'req-1' });
      const prev: PermissionState = {
        ...initialState,
        requests: createCollection<PermissionRequest, 'requestId'>('requestId', [existing]),
      };
      const incoming = [
        makeRequest({ requestId: 'req-1' }), // duplicate
        makeRequest({ requestId: 'req-2' }), // new
      ];
      const state = permissionReducer(prev, setPendingRequests(incoming));
      expect(getItems(state.requests)).toHaveLength(2);
      expect(getItems(state.requests).map((r) => r.requestId)).toEqual(['req-1', 'req-2']);
    });

    it('should return same state if no new requests', () => {
      const existing = makeRequest({ requestId: 'req-1' });
      const prev: PermissionState = {
        ...initialState,
        requests: createCollection<PermissionRequest, 'requestId'>('requestId', [existing]),
      };
      const state = permissionReducer(prev, setPendingRequests([existing]));
      expect(state).toBe(prev);
    });

    it('should add all requests when state is empty', () => {
      const requests = [makeRequest({ requestId: 'req-1' }), makeRequest({ requestId: 'req-2' })];
      const state = permissionReducer(initialState, setPendingRequests(requests));
      expect(getItems(state.requests)).toHaveLength(2);
    });
  });

  describe('removePermissionRequest', () => {
    it('should remove a request by ID', () => {
      const prev: PermissionState = {
        ...initialState,
        requests: createCollection<PermissionRequest, 'requestId'>('requestId', [
          makeRequest({ requestId: 'req-1' }),
          makeRequest({ requestId: 'req-2' }),
        ]),
      };
      const state = permissionReducer(prev, removePermissionRequest('req-1'));
      expect(getItems(state.requests)).toHaveLength(1);
      expect(getItems(state.requests)[0].requestId).toBe('req-2');
    });

    it('should return same state if request not found', () => {
      const state = permissionReducer(initialState, removePermissionRequest('nonexistent'));
      expect(state).toBe(initialState);
    });
  });
});

describe('permission operation ownership', () => {
  it('coalesces a pending decision, accepts only its current failure and removes both records on resolution', () => {
    const scoped = permissionReducer(initialState, permissionScopeChanged('scope'));
    const pending = permissionReducer(scoped, permissionRequestReceived(makeRequest()));
    expect(permissionReducer(pending, permissionResponseStarted('missing', 'owner'))).toBe(pending);
    const started = permissionReducer(pending, permissionResponseStarted('req-1', 'owner'));
    expect(permissionReducer(started, permissionResponseStarted('req-1', 'owner'))).toBe(started);
    expect(
      permissionReducer(started, permissionResponseFailed('req-1', 'old-owner', 1, 'old')),
    ).toBe(started);
    expect(permissionReducer(started, permissionResponseFailed('req-1', 'owner', 0, 'old'))).toBe(
      started,
    );
    const failed = permissionReducer(
      started,
      permissionResponseFailed('req-1', 'owner', 1, 'offline'),
    );
    const retry = permissionReducer(failed, permissionResponseStarted('req-1', 'owner'));
    expect(getItems(retry.responses)).toEqual([
      { requestId: 'req-1', context: 'owner', attempt: 2, status: 'submitting', error: undefined },
    ]);
    expect(permissionReducer(retry, permissionResponseFailed('req-1', 'owner', 1, 'old'))).toBe(
      retry,
    );
    const removed = permissionReducer(retry, removePermissionRequest('req-1'));
    expect(getItems(removed.responses)).toEqual([]);
    expect(getItems(removed.requests)).toEqual([]);
    expect(permissionReducer(removed, removePermissionRequest('req-1'))).toBe(removed);
  });
  it('retains equivalent scope references and retires prompts/operations at an authority boundary', () => {
    let state = permissionReducer(initialState, permissionScopeChanged('first'));
    state = permissionReducer(state, permissionRequestReceived(makeRequest()));
    state = permissionReducer(state, permissionResponseStarted('req-1', 'owner'));
    expect(permissionReducer(state, permissionScopeChanged('first'))).toBe(state);
    const next = permissionReducer(state, permissionScopeChanged('second'));
    expect(next).toEqual({ ...initialState, scope: 'second' });
    expect(permissionReducer(next, permissionResponseFailed('req-1', 'owner', 1, 'old'))).toBe(
      next,
    );
  });
});
