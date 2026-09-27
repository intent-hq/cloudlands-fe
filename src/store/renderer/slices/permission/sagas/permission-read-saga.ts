import { takeLatestFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';
import { call, put, type SagaGenerator } from 'typed-redux-saga';
import { backendRequest } from '$lib/client/live/backend-transport';
import { selectWorkspaceControlContext } from '../../principal/principal-selectors';
import { selectPermissionState } from '../permission-selectors';
import {
  pendingPermissionsReceived,
  permissionContextChanged,
  type PermissionRequest,
} from '../permission-slice';

/** Recover pending prompts on admission/reconnect without resurrecting a live resolution. */
export function* hydratePermissions({
  payload: context,
}: SelectorChannelPayload<string | null>): SagaGenerator<void> {
  yield* put(permissionContextChanged(context));
  if (!context) return;
  while ((yield* selectWorkspaceControlContext.effect()) === context) {
    const { revision } = yield* selectPermissionState.effect();
    try {
      const result = yield* call(
        backendRequest<{ requests: PermissionRequest[] }>,
        'agent.pendingPermissions',
        {},
      );
      if ((yield* selectWorkspaceControlContext.effect()) !== context) return;
      if ((yield* selectPermissionState.effect()).revision !== revision) continue;
      yield* put(pendingPermissionsReceived(context, revision, result.requests));
    } catch {
      // Live delivery remains available. A later admission/reconnect retries recovery.
    }
    return;
  }
}

export function* permissionReadSaga(): SagaGenerator<void> {
  yield* takeLatestFromSelector(selectWorkspaceControlContext, hydratePermissions);
}
