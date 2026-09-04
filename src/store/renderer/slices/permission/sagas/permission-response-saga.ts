import { call, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { getItem } from '@augmentcode/themis/utils/collections/collection-utils';

import { appClient, type PermissionOutcome } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import {
  approvePermission,
  cancelPermission,
  denyPermission,
  removePermissionRequest,
  selectPermissionOption,
} from '../permission-slice';
import { selectPermissionRequestsCollection } from '../permission-selectors';

const logger = createLogger('PermissionResponseSaga');

function* respond(requestId: string, outcome: PermissionOutcome): SagaGenerator<void> {
  try {
    const result = yield* call(
      [appClient.agents, appClient.agents.respondPermission],
      requestId,
      outcome,
    );
    if (result.success) yield* put(removePermissionRequest(requestId));
    else logger.error('Permission response failed', { requestId, outcome, error: result.error });
  } catch (error) {
    logger.error('Permission response threw', { requestId, outcome, error });
  }
}

function* approve(action: ReturnType<typeof approvePermission>): SagaGenerator<void> {
  const [requestId] = action.payload;
  const requests = yield* selectPermissionRequestsCollection.effect();
  const request = getItem(requests, requestId);
  if (!request) return;
  const option = request.options.find((item) => !item.destructive) ?? request.options[0];
  yield* respond(requestId, { outcome: 'selected', optionId: option?.id ?? 'allow_once' });
}

function* deny(action: ReturnType<typeof denyPermission>): SagaGenerator<void> {
  const [requestId] = action.payload;
  const requests = yield* selectPermissionRequestsCollection.effect();
  const request = getItem(requests, requestId);
  if (!request) return;
  const option = request.options.find((item) => item.destructive) ?? request.options.at(-1);
  yield* respond(requestId, { outcome: 'selected', optionId: option?.id ?? 'reject_once' });
}

function* cancelRequest(action: ReturnType<typeof cancelPermission>): SagaGenerator<void> {
  yield* respond(action.payload[0], { outcome: 'cancelled' });
}

function* handleOptionSelection(
  action: ReturnType<typeof selectPermissionOption>,
): SagaGenerator<void> {
  const [requestId, optionId] = action.payload;
  yield* respond(requestId, { outcome: 'selected', optionId });
}

export function* permissionResponseSaga(): SagaGenerator<void> {
  yield* takeEvery(approvePermission, approve);
  yield* takeEvery(denyPermission, deny);
  yield* takeEvery(cancelPermission, cancelRequest);
  yield* takeEvery(selectPermissionOption, handleOptionSelection);
}
