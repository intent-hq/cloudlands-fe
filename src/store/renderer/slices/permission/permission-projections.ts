import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { PermissionRequest, PermissionState } from './permission-types';

type PermissionProjectionState = { permission: PermissionState };

export const getPermissionRequestsCollection = (state: PermissionProjectionState) => {
  return state.permission.requests;
};

export const getPermissionRequests = (requests: PermissionState['requests']) => {
  return getItems(requests);
};

export const getRequestsForSession = (requests: PermissionRequest[], sessionId: string) => {
  return requests.filter((r) => r.sessionId === sessionId);
};

export const getPendingCount = (requests: PermissionRequest[]) => {
  return requests.length;
};
