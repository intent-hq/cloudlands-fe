import { call, type SagaGenerator } from 'typed-redux-saga';

import { getLifecycleMetadataMutation } from '$features/events/lifecycle-metadata-recovery';
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { takeLatestByWorkspace } from '../../../utils/context-saga-effects';
import { addContextItem, removeContextItem, updateContextItem } from '../context-slice';
import { selectContextItems } from '../context-selectors';

const logger = createLogger('ContextSaga');

type ContextMutationAction =
  | ReturnType<typeof addContextItem>
  | ReturnType<typeof removeContextItem>
  | ReturnType<typeof updateContextItem>;

function* syncWorkspace(action: ContextMutationAction): SagaGenerator<void> {
  const workspaceId = action.payload[0];
  const mutation = getLifecycleMetadataMutation(action);
  try {
    if (!workspaceId) return;
    const items = yield* selectContextItems.effect(workspaceId);
    if (mutation) {
      yield* call(() => mutation.run(() => appClient.workspaces.updateContext(workspaceId, items)));
    } else {
      yield* call([appClient.workspaces, appClient.workspaces.updateContext], workspaceId, items);
    }
  } catch (error) {
    logger.error('workspace.updateContext failed', { workspaceId, error });
  } finally {
    mutation?.finish();
  }
}

export function* contextSaga(): SagaGenerator<void> {
  yield* takeLatestByWorkspace(
    [addContextItem, removeContextItem, updateContextItem],
    syncWorkspace,
  );
}
