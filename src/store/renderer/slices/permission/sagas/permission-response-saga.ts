import { permissionRecoverySaga } from './permission-recovery-saga';
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { selectWorkspacePermissionContext } from '../../workspace/workspace-selectors';
import {
  selectPermissionRequestsCollection,
  selectPermissionResponsesCollection,
} from '../permission-selectors';
import { createPermissionResponseSaga } from './permission-response-saga-factory';

const logger = createLogger('PermissionResponseSaga');

// Compatibility binding for the existing root saga until the Svelte renderer is retired.
export const permissionResponseSaga = createPermissionResponseSaga({
  permissionRecoverySaga,
  appClient,
  logger,
  selectWorkspacePermissionContext,
  selectPermissionRequestsCollection,
  selectPermissionResponsesCollection,
});
