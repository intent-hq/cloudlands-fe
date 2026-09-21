import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  addItem,
  addItems,
  createCollection,
  removeItem,
  type Collection,
} from '@augmentcode/themis/utils/collections/collection-utils';

// ============================================================================
// Types
// ============================================================================

export interface PermissionRequest {
  requestId: string;
  sessionId: string;
  title: string;
  description?: string | null;
  options: Array<{
    id: string;
    label: string;
    description?: string;
    destructive?: boolean;
  }>;
  agentName?: string;
  riskLevel?: 'low' | 'medium' | 'high';
  timestamp: number;
}

export type PermissionState = {
  /** All pending permission requests */
  requests: Collection<PermissionRequest, 'requestId'>;
};

// ============================================================================
// Initial State
// ============================================================================

export const initialState: PermissionState = {
  requests: createCollection<PermissionRequest, 'requestId'>('requestId'),
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
export const selectPermissionOption = createAction<[requestId: string, optionId: string]>(
  'permission/selectPermissionOption',
);

// ============================================================================
// Reducer
// ============================================================================

export const permissionReducer = createReducer<PermissionState>(initialState);
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
  if (requests === state.requests) {
    return state;
  }

  return {
    ...state,
    requests,
  };
});
