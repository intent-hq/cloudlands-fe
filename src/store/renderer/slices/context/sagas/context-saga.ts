import { call, fork, take, type SagaGenerator } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { addContextItem, removeContextItem, updateContextItem } from '../context-slice';
import { selectContextItems } from '../context-selectors';

const logger = createLogger('ContextSaga');

type ContextMutationAction =
  | ReturnType<typeof addContextItem>
  | ReturnType<typeof removeContextItem>
  | ReturnType<typeof updateContextItem>;

function* syncWorkspace(
  workspaceId: string,
  queued: Set<string>,
  running: Set<string>,
): SagaGenerator<void> {
  try {
    do {
      queued.delete(workspaceId);
      const items = yield* selectContextItems.effect(workspaceId);
      try {
        yield* call([appClient.workspaces, appClient.workspaces.updateContext], workspaceId, items);
      } catch (error) {
        logger.error('workspace.updateContext failed', { workspaceId, error });
      }
    } while (queued.has(workspaceId));
  } finally {
    running.delete(workspaceId);
  }
}

export function* contextSaga(): SagaGenerator<void> {
  const queued = new Set<string>();
  const running = new Set<string>();

  while (true) {
    const action: ContextMutationAction = yield* take([
      addContextItem,
      removeContextItem,
      updateContextItem,
    ]);
    const workspaceId = action.payload[0];
    if (!workspaceId) continue;
    queued.add(workspaceId);
    if (running.has(workspaceId)) continue;
    running.add(workspaceId);
    yield* fork(syncWorkspace, workspaceId, queued, running);
  }
}
