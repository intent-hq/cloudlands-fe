import { createPermissionRecoverySaga } from '../../../../../../src/store/renderer/slices/permission/sagas/permission-recovery-saga-factory';
import { backendRequest } from '@/features/backend/backend-transport';
import {
  selectWorkspaceManagementDenied,
  selectWorkspacePermissionContext,
} from '@/store/workspace/workspace-selectors';
import { selectAgentSessionsById } from '@/store/agent-session/agent-session-selectors';
import {
  selectPermissionRecoveryAgents,
  selectPermissionRecoveryScope,
} from '../permission-selectors';

/** Inert binding; the eventual permission host owns startup and cancellation. */
export const permissionRecoverySaga = createPermissionRecoverySaga({
  backendRequest,
  selectWorkspaceManagementDenied,
  selectWorkspacePermissionContext,
  selectPermissionRecoveryAgents,
  selectPermissionRecoveryScope,
  selectAgentSessionsById,
});
