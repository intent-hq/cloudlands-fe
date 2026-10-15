import { call, cancelled, fork, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import type { SelectorChannelSelector } from '@themislib/themis/saga';
import type { PermissionResponder, PermissionOutcome } from '$lib/client/permission-client-types';
import type { ClientLogger } from '$lib/utils/client-logger';
import type { PermissionState } from '../permission-types';
import {
  approvePermission,
  cancelPermission,
  denyPermission,
  removePermissionRequest,
  selectPermissionOption,
  permissionResponseStarted,
  permissionResponseFailed,
} from '../permission-slice';

/** Bind the canonical response owner; the host retains the real agents method receiver. */
export function createPermissionResponseSaga<State>({
  permissionRecoverySaga,
  appClient,
  logger,
  selectWorkspacePermissionContext,
  selectPermissionRequestsCollection,
  selectPermissionResponsesCollection,
}: {
  permissionRecoverySaga: () => SagaGenerator<void>;
  appClient: { agents: PermissionResponder };
  logger: Pick<ClientLogger, 'error'>;
  selectWorkspacePermissionContext: SelectorChannelSelector<string | null, [string], State>;
  selectPermissionResponsesCollection: SelectorChannelSelector<
    PermissionState['responses'],
    [],
    State
  >;
  selectPermissionRequestsCollection: SelectorChannelSelector<
    PermissionState['requests'],
    [],
    State
  >;
}) {
  function* respond(
    requestId: string,
    outcome: PermissionOutcome,
    expectedContext?: string,
  ): SagaGenerator<void> {
    const requests = yield* selectPermissionRequestsCollection.effect();
    const request = getItem(requests, requestId);
    if (!request?.workspaceId) return;
    const context = yield* selectWorkspacePermissionContext.effect(request.workspaceId);
    if (!context || (expectedContext !== undefined && expectedContext !== context)) return;
    const previous = getItem(yield* selectPermissionResponsesCollection.effect(), requestId);
    if (previous?.context === context && previous.status === 'submitting') return;
    yield* put(permissionResponseStarted(requestId, context));
    const response = getItem(yield* selectPermissionResponsesCollection.effect(), requestId);
    if (!response || response.context !== context || response.status !== 'submitting') return;
    const { attempt } = response;
    try {
      const result = yield* call(
        [appClient.agents, appClient.agents.respondPermission],
        requestId,
        outcome,
        request.workspaceId,
      );
      if (context !== (yield* selectWorkspacePermissionContext.effect(request.workspaceId))) return;
      if (getItem(yield* selectPermissionRequestsCollection.effect(), requestId) !== request)
        return;
      if (getItem(yield* selectPermissionResponsesCollection.effect(), requestId) !== response)
        return;
      if (result.success) yield* put(removePermissionRequest(requestId));
      else {
        yield* put(
          permissionResponseFailed(
            requestId,
            context,
            attempt,
            result.error ?? 'Permission response failed',
          ),
        );
        logger.error('Permission response failed', { requestId, outcome, error: result.error });
      }
    } catch (error) {
      if (context !== (yield* selectWorkspacePermissionContext.effect(request.workspaceId))) return;
      if (getItem(yield* selectPermissionRequestsCollection.effect(), requestId) !== request)
        return;
      if (getItem(yield* selectPermissionResponsesCollection.effect(), requestId) !== response)
        return;
      yield* put(
        permissionResponseFailed(
          requestId,
          context,
          attempt,
          error instanceof Error ? error.message : String(error),
        ),
      );
      logger.error('Permission response threw', { requestId, outcome, error });
    } finally {
      if (
        (yield* cancelled()) &&
        getItem(yield* selectPermissionResponsesCollection.effect(), requestId) === response
      ) {
        yield* put(
          permissionResponseFailed(requestId, context, attempt, 'Permission response interrupted'),
        );
      }
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
    const [requestId, optionId, expectedContext] = action.payload;
    const request = getItem(yield* selectPermissionRequestsCollection.effect(), requestId);
    if (!request?.options.some((option) => option.id === optionId)) return;
    yield* respond(requestId, { outcome: 'selected', optionId }, expectedContext);
  }

  function* permissionResponseSaga(): SagaGenerator<void> {
    yield* fork(permissionRecoverySaga);
    yield* takeEvery(approvePermission, approve);
    yield* takeEvery(denyPermission, deny);
    yield* takeEvery(cancelPermission, cancelRequest);
    yield* takeEvery(selectPermissionOption, handleOptionSelection);
  }

  return permissionResponseSaga;
}
