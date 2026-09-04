import type { Task } from 'redux-saga';
import {
  call,
  cancel,
  delay,
  fork,
  put,
  race,
  select,
  take,
  type SagaGenerator,
} from 'typed-redux-saga';

import { workspaceClient } from '../../workspace/utils/workspace.client';
import {
  loadWorkspacesRequested,
  removeWorkspaceEntity,
  setWorkspaceEntity,
} from '../../workspace/workspace-slice';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import { closeWorkspaceTab } from '../../tab-state/tab-state-slice';
import { markWorkspaceNavigationInitialized } from '../../workspace-navigation/workspace-navigation-slice';
import type { Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { appClient } from '$lib/client';
import {
  backendReconnected,
  workspaceDeleted,
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
  workspaceUnmounted,
} from '../workspace-lifecycle-slice';
import {
  selectIsWorkspaceSessionLive,
  selectWorkspaceLoadState,
} from '../workspace-lifecycle-selectors';

const NOT_FOUND_RETRY_DELAY_MS = 500;

// Anchored to the workspace subject (monorepo#3787): a generic backend error
// that merely contains "not found" (e.g. "git binary not found") must not be
// classified as workspace-not-found — that classification feeds the
// destructive path (closeWorkspaceTab + removeWorkspaceEntity). Covers the
// daemon's actual missing-workspace phrasings: the workspace.* router mapping
// and FE IPC fold ("Workspace not found"), id-suffixed variants
// ("Workspace not found: {id}"), and the generic domain-error display
// ("not found: workspace {id}"). The `[^:]*` barrier keeps a prefixed cause
// like "failed to open workspace: <tool> not found" out of the match.
function isNotFoundError(error: string): boolean {
  const normalized = error
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim();
  return (
    /\bworkspace\b[^:]*\b(?:not found|does not exist)\b/.test(normalized) ||
    /\bnot found: workspace\b/.test(normalized)
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function* isLoadInvalidated(workspaceId: string): SagaGenerator<boolean> {
  const state = yield* select(selectWorkspaceLoadState.select, workspaceId);
  return state.status === 'idle';
}

type ObservedAction = { type: string; payload?: unknown };

function isWorkspaceDetailInvalidation(action: ObservedAction, workspaceId: string): boolean {
  if (action.type === backendReconnected.type) return true;
  if (
    action.type !== removeWorkspaceEntity.type &&
    action.type !== workspaceDeleted.type &&
    action.type !== workspaceUnmounted.type
  ) {
    return false;
  }
  return Array.isArray(action.payload) && action.payload[0] === workspaceId;
}

function workspacePathsMatch(left: Workspace, right: Workspace): boolean {
  return (
    left.path === right.path &&
    left.repositoryPath === right.repositoryPath &&
    left.worktreePath === right.worktreePath
  );
}

function* hydrateOptionalWorkspaceDetail(
  workspaceId: string,
  openedWorkspace: Workspace,
): SagaGenerator<void> {
  try {
    const { hydratedWorkspace, invalidated } = yield* race({
      hydratedWorkspace: call([appClient.workspaces, appClient.workspaces.get], workspaceId),
      invalidated: take((action: ObservedAction) =>
        isWorkspaceDetailInvalidation(action, workspaceId),
      ),
    });
    if (invalidated || !hydratedWorkspace) return;

    const current = yield* select(selectWorkspaceById.select, workspaceId);
    if (!current || !workspacePathsMatch(current, openedWorkspace)) return;

    yield* put(
      setWorkspaceEntity({
        ...current,
        path: hydratedWorkspace.path,
        repositoryPath: hydratedWorkspace.repositoryPath,
        worktreePath: hydratedWorkspace.worktreePath,
      }),
    );
  } catch {
    // Opening succeeded; path-dependent consumers retain their own missing/error states.
  }
}

type ActiveWorkspaceLoad = { workspaceId: string; task?: Task; succeeded: boolean };

function* loadWorkspace(
  action: ReturnType<typeof workspaceLoadRequested>,
  slot: ActiveWorkspaceLoad,
): SagaGenerator<void> {
  const workspaceId = action.payload[0];
  if (workspaceId.startsWith('optimistic-')) {
    yield* put(workspaceLoadOptimisticReady(workspaceId));
    return;
  }

  const cached = yield* select(selectWorkspaceById.select, workspaceId);
  const live = yield* select(selectIsWorkspaceSessionLive.select, workspaceId);
  if (cached && live) {
    yield* put(workspaceLoadSucceeded(workspaceId));
    slot.succeeded = true;
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

    const workspace = result.data;
    yield* put(setWorkspaceEntity(workspace));
    if (yield* isLoadInvalidated(workspaceId)) return;
    yield* put(workspaceOpenSucceeded(workspaceId));
    yield* put(workspaceLoadSucceeded(workspaceId));
    slot.succeeded = true;
    yield* put(markWorkspaceNavigationInitialized(workspaceId));
    if (!workspace.repositoryPath) {
      yield* call(hydrateOptionalWorkspaceDetail, workspaceId, workspace);
    }
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
  let active: ActiveWorkspaceLoad | undefined;
  while (true) {
    const action = yield* take(workspaceLoadRequested);
    const workspaceId = action.payload[0];
    const activeTask = active?.task;
    if (active && activeTask?.isRunning()) {
      if (active.workspaceId === workspaceId) continue;
      const stale = active;
      yield* cancel(activeTask);
      if (!stale.succeeded) yield* put(workspaceLoadCancelled(stale.workspaceId));
    }

    const slot: ActiveWorkspaceLoad = { workspaceId, succeeded: false };
    active = slot;
    const task = yield* fork(function* activeWorkspaceLoad() {
      try {
        yield* loadWorkspace(action as ReturnType<typeof workspaceLoadRequested>, slot);
      } finally {
        if (active === slot) active = undefined;
      }
    });
    slot.task = task;
    if (!task.isRunning() && active === slot) active = undefined;
  }
}
