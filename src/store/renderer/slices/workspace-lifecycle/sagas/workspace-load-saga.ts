import type { Task } from 'redux-saga';
import { call, cancel, delay, fork, put, select, take, type SagaGenerator } from 'typed-redux-saga';

import { workspaceClient } from '../../workspace/utils/workspace.client';
import {
  loadWorkspacesRequested,
  removeWorkspaceEntity,
  setWorkspaceEntity,
} from '../../workspace/workspace-slice';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import { closeWorkspaceTab } from '../../tab-state/tab-state-slice';
import { markWorkspaceNavigationInitialized } from '../../workspace-navigation/workspace-navigation-slice';
import { WorkspaceId } from '$shared/types/branded-ids';
import { appClient } from '$lib/client';
import {
  workspaceHydrationRequested,
  workspaceLoadCachedReady,
  workspaceLoadCancelled,
  workspaceLoadFailed,
  workspaceLoadOptimisticReady,
  workspaceLoadRequested,
  workspaceLoadStarted,
  workspaceLoadSucceeded,
  workspaceOpenFailed,
  workspaceOpenSucceeded,
} from '../workspace-lifecycle-slice';
import {
  selectIsWorkspaceSessionLive,
  selectWorkspaceLoadState,
} from '../workspace-lifecycle-selectors';

const NOT_FOUND_RETRY_DELAY_MS = 500;

function isNotFoundError(error: string): boolean {
  const normalized = error
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim();
  return normalized.includes('not found') || normalized.includes('does not exist');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function* isLoadInvalidated(workspaceId: string): SagaGenerator<boolean> {
  const state = yield* select(selectWorkspaceLoadState.select, workspaceId);
  return state.status === 'idle';
}

function* loadWorkspace(action: ReturnType<typeof workspaceLoadRequested>): SagaGenerator<void> {
  const workspaceId = action.payload[0];
  if (workspaceId.startsWith('optimistic-')) {
    yield* put(workspaceLoadOptimisticReady(workspaceId));
    return;
  }

  const cached = yield* select(selectWorkspaceById.select, workspaceId);
  const live = yield* select(selectIsWorkspaceSessionLive.select, workspaceId);
  if (cached && live) {
    yield* put(workspaceLoadSucceeded(workspaceId));
    yield* put(markWorkspaceNavigationInitialized(workspaceId));
    return;
  }
  yield* put(workspaceLoadStarted(workspaceId));
  if (cached) yield* put(workspaceLoadCachedReady(workspaceId));

  yield* put(workspaceHydrationRequested(workspaceId));
  try {
    let result = yield* call([workspaceClient, workspaceClient.open], WorkspaceId(workspaceId));
    if (yield* isLoadInvalidated(workspaceId)) return;
    if (!result.ok && isNotFoundError(result.error)) {
      yield* put(loadWorkspacesRequested());
      yield* delay(NOT_FOUND_RETRY_DELAY_MS);
      if (yield* isLoadInvalidated(workspaceId)) return;
      result = yield* call([workspaceClient, workspaceClient.open], WorkspaceId(workspaceId));
      if (yield* isLoadInvalidated(workspaceId)) return;
    }

    if (!result.ok) {
      const notFound = isNotFoundError(result.error);
      if (notFound) {
        yield* put(closeWorkspaceTab(workspaceId));
        yield* put(removeWorkspaceEntity(workspaceId));
      } else if (cached) {
        yield* put(workspaceOpenFailed(workspaceId));
        return;
      }
      yield* put(
        workspaceLoadFailed(workspaceId, {
          kind: notFound ? 'not_found' : 'error',
          message: result.error,
        }),
      );
      yield* put(workspaceOpenFailed(workspaceId));
      return;
    }

    let workspace = result.data;
    yield* put(setWorkspaceEntity(workspace));
    if (!workspace.repositoryPath) {
      try {
        const hydratedWorkspace = yield* call(
          [appClient.workspaces, appClient.workspaces.get],
          workspaceId,
        );
        if (yield* isLoadInvalidated(workspaceId)) return;
        if (hydratedWorkspace) {
          workspace = hydratedWorkspace;
          yield* put(setWorkspaceEntity(workspace));
        }
      } catch {
        // Opening succeeded; keep the protocol workspace when optional path hydration fails.
        if (yield* isLoadInvalidated(workspaceId)) return;
      }
    }
    if (yield* isLoadInvalidated(workspaceId)) return;
    yield* put(workspaceOpenSucceeded(workspaceId));
    yield* put(workspaceLoadSucceeded(workspaceId));
    yield* put(markWorkspaceNavigationInitialized(workspaceId));
  } catch (error) {
    if (yield* isLoadInvalidated(workspaceId)) return;
    if (cached) {
      yield* put(workspaceOpenFailed(workspaceId));
      return;
    }
    yield* put(workspaceLoadFailed(workspaceId, { kind: 'error', message: errorMessage(error) }));
    yield* put(workspaceOpenFailed(workspaceId));
  }
}

export function* workspaceLoadSaga(): SagaGenerator<void> {
  let active: { workspaceId: string; task?: Task } | undefined;
  while (true) {
    const action = yield* take(workspaceLoadRequested);
    const workspaceId = action.payload[0];
    if (active?.task?.isRunning()) {
      if (active.workspaceId === workspaceId) continue;
      const staleWorkspaceId = active.workspaceId;
      yield* cancel(active.task);
      yield* put(workspaceLoadCancelled(staleWorkspaceId));
    }

    const slot: { workspaceId: string; task?: Task } = { workspaceId };
    active = slot;
    const task = yield* fork(function* activeWorkspaceLoad() {
      try {
        yield* loadWorkspace(action as ReturnType<typeof workspaceLoadRequested>);
      } finally {
        if (active === slot) active = undefined;
      }
    });
    slot.task = task;
    if (!task.isRunning() && active === slot) active = undefined;
  }
}
