import { backendRequest } from '$lib/client/live/backend-transport';
import {
  selectWorkspaceManagementDenied,
  selectWorkspacePermissionContext,
} from '../../workspace/workspace-selectors';
import {
  selectPermissionRecoveryAgents,
  selectPermissionRecoveryScope,
} from '../permission-selectors';
import { selectAgentSessionsById } from '../../agent-session/agent-session-selectors';
import { createPermissionRecoverySaga } from './permission-recovery-saga-factory';

// Compatibility binding for the existing root saga until the Svelte renderer is retired.
export const permissionRecoverySaga = createPermissionRecoverySaga({
  backendRequest,
  selectWorkspaceManagementDenied,
  selectWorkspacePermissionContext,
  selectPermissionRecoveryAgents,
  selectPermissionRecoveryScope,
  selectAgentSessionsById,
});
