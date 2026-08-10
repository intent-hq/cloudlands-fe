import { call, takeLatest, type SagaGenerator } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { addContextItem, removeContextItem, updateContextItem } from '../context-slice';
import { selectContextItems } from '../context-selectors';

const logger = createLogger('ContextSaga');

type ContextMutationAction =
  | ReturnType<typeof addContextItem>
  | ReturnType<typeof removeContextItem>
  | ReturnType<typeof updateContextItem>;

function* syncWorkspace(action: ContextMutationAction): SagaGenerator<void> {
  const workspaceId = action.payload[0];
  if (!workspaceId) return;
  const items = yield* selectContextItems.effect(workspaceId);
  try {
    yield* call([appClient.workspaces, appClient.workspaces.updateContext], workspaceId, items);
  } catch (error) {
    logger.error('workspace.updateContext failed', { workspaceId, error });
  }
}

export function* contextSaga(): SagaGenerator<void> {
  yield* takeLatest([addContextItem, removeContextItem, updateContextItem], syncWorkspace);
}
