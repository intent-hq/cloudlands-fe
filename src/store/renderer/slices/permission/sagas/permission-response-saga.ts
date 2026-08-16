import { call, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { appClient, type PermissionOutcome } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { removePermissionRequest, selectPermissionOption } from '../permission-slice';

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

function* handleOptionSelection(
  action: ReturnType<typeof selectPermissionOption>,
): SagaGenerator<void> {
  const [requestId, optionId] = action.payload;
  yield* respond(requestId, { outcome: 'selected', optionId });
}

export function* permissionResponseSaga(): SagaGenerator<void> {
  yield* takeEvery(selectPermissionOption, handleOptionSelection);
}