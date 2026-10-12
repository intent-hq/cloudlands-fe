import { backendRequest } from '@/features/backend/backend-transport';
import { createBackendPermissionClient } from '$lib/client/live/backend-permission-client';
import type { PermissionResponder } from '$lib/client/permission-client-types';

/** Genuine permission client; the consuming host owns admission and saga lifetime. */
export const permissionClient: PermissionResponder = createBackendPermissionClient(backendRequest);
