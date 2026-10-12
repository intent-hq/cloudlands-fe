import { createPermissionResponseSaga as createCanonicalPermissionResponseSaga } from '../../../../../../src/store/renderer/slices/permission/sagas/permission-response-saga-factory';
import type { PermissionResponder } from '$lib/client/permission-client-types';
import { createLogger } from '$lib/utils/client-logger';
import { permissionRecoverySaga } from './permission-recovery-saga';
import { selectWorkspacePermissionContext } from '@/store/workspace/workspace-selectors';
import { selectPermissionRequestsCollection } from '../permission-selectors';

/**
 * The later permission host must supply a genuine app-client-compatible agents
 * object with respondPermission. No React transport or startup is supplied here.
 */
export function createPermissionResponseSaga(appClient: { agents: PermissionResponder }) {
  return createCanonicalPermissionResponseSaga({
    permissionRecoverySaga,
    appClient,
    logger: createLogger('PermissionResponseSaga'),
    selectWorkspacePermissionContext,
    selectPermissionRequestsCollection,
  });
}
