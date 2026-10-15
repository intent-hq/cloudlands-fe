import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  addItem,
  addItems,
  createCollection,
  getItem,
  upsertItem,
  removeItem,
} from '@themislib/themis/utils/collections/collection-utils';
import type { PermissionRequest, PermissionResponse, PermissionState } from './permission-types';

// ============================================================================
// Types
// ============================================================================

// Compatibility for existing source-renderer consumers until that renderer is retired.
export type { PermissionRequest, PermissionState } from './permission-types';

// ============================================================================
// Initial State
// ============================================================================

export const initialState: PermissionState = {
  requests: createCollection<PermissionRequest, 'requestId'>('requestId'),
  scope: null,
  responses: createCollection<PermissionResponse, 'requestId'>('requestId'),
};

// ============================================================================
// Actions
// ============================================================================

/** A new permission request was received via IPC */
export const permissionRequestReceived = createAction<[request: PermissionRequest]>(
  'permission/permissionRequestReceived',
);

/** Set all pending requests (e.g., after fetching pending on init) */
export const setPendingRequests = createAction<[requests: PermissionRequest[]]>(
  'permission/setPendingRequests',
);

/** Remove a permission request from the list (after respond success) */
export const removePermissionRequest = createAction<[requestId: string]>(
  'permission/removePermissionRequest',
);

/** Approve a permission request (triggers saga) */
export const approvePermission = createAction<[requestId: string]>('permission/approvePermission');

/** Deny a permission request (triggers saga) */
export const denyPermission = createAction<[requestId: string]>('permission/denyPermission');

/** Cancel a permission request (triggers saga) */
export const cancelPermission = createAction<[requestId: string]>('permission/cancelPermission');

/** Select a specific option for a permission request (triggers saga) */
export const selectPermissionOption = createAction<
  [requestId: string, optionId: string, expectedContext?: string]
>('permission/selectPermissionOption');

export const permissionScopeChanged =
  createAction<[scope: string | null]>('permission/scopeChanged');
export const permissionResponseStarted = createAction<[requestId: string, context: string]>(
  'permission/responseStarted',
);
export const permissionResponseFailed = createAction<
  [requestId: string, context: string, attempt: number, error: string]
>('permission/responseFailed');

// ============================================================================
// Reducer
// ============================================================================

export const permissionReducer = createReducer<PermissionState>(initialState);
permissionReducer.with(permissionScopeChanged, (state, { payload: [scope] }) =>
  state.scope === scope
    ? state
    : state.scope === null && scope !== null
      ? // The event owner can admit buffered events at the new subscription ack
        // before capability hydration completes. Binding that first scope must not
        // erase those live prompts. Retirement already cleared the previous scope.
        { ...state, scope }
      : { ...initialState, scope },
);
permissionReducer.with(permissionResponseStarted, (state, { payload: [requestId, context] }) => {
  if (!getItem(state.requests, requestId)) return state;
  const previous = getItem(state.responses, requestId);
  if (previous?.context === context && previous.status === 'submitting') return state;
  return {
    ...state,
    responses: upsertItem(state.responses, {
      requestId,
      context,
      attempt: (previous?.attempt ?? 0) + 1,
      status: 'submitting',
      error: undefined,
    }),
  };
});
permissionReducer.with(
  permissionResponseFailed,
  (state, { payload: [requestId, context, attempt, error] }) => {
    const current = getItem(state.responses, requestId);
    if (
      !current ||
      current.context !== context ||
      current.attempt !== attempt ||
      current.status !== 'submitting'
    )
      return state;
    return {
      ...state,
      responses: upsertItem(state.responses, { ...current, status: 'failed', error }),
    };
  },
);
permissionReducer.with(permissionRequestReceived, (state, { payload: [request] }) => {
  const requests = addItem(state.requests, request);
  if (requests === state.requests) {
    return state;
  }

  return {
    ...state,
    requests,
  };
});
permissionReducer.with(setPendingRequests, (state, { payload: [requests] }) => {
  const nextRequests = addItems(state.requests, requests);
  if (nextRequests === state.requests) {
    return state;
  }

  return {
    ...state,
    requests: nextRequests,
  };
});
permissionReducer.with(removePermissionRequest, (state, { payload: [requestId] }) => {
  const requests = removeItem(state.requests, requestId);
  const responses = removeItem(state.responses, requestId);
  if (requests === state.requests && responses === state.responses) {
    return state;
  }

  return {
    ...state,
    requests,
    responses,
  };
});
