import { call, cancelled, fork, put, take, type SagaGenerator } from 'typed-redux-saga';
import { takeSingleFlightInContext } from '../../../utils/context-saga-effects';
import { createLogger } from '../../../../../lib/utils/client-logger';
import {
  backendReconnected,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { removeWorkspaceEntity } from '../../workspace/workspace-slice';
import {
  acquireWorkspaceTasksDemand,
  releaseWorkspaceTasksDemand,
  clearWorkspaceTasks,
  ensureWorkspaceTasksLoaded,
  workspaceTasksReadStarted,
  workspaceTasksReadCancelled,
  loadWorkspaceTasksFailed,
  loadWorkspaceTasksRequested,
  loadWorkspaceTasksSucceeded,
} from '../workspace-tasks-slice';
import type { WorkspaceTasksReadDependencies } from '../workspace-tasks-types';

/** The existing tasks reader and coalescing watcher, bound once by each renderer. */
export function createWorkspaceTasksReadSaga(dependencies: WorkspaceTasksReadDependencies) {
  const {
    tasks,
    selectWorkspaceTasksShouldLoad,
    admittedContext,
    runRead,
    selectDemandedTaskWorkspaceIds,
  } = dependencies;
  const logger = createLogger('WorkspaceTasksRead');
  function* refreshTasks(workspaceId: string): SagaGenerator<void> {
    if (!(yield* selectWorkspaceTasksShouldLoad.effect(workspaceId))) return;
    const context = admittedContext ? yield* admittedContext.effect(workspaceId) : undefined;
    if (context === null) return;
    function* current(): SagaGenerator<boolean> {
      return !admittedContext || (yield* admittedContext.effect(workspaceId)) === context;
    }
    let accepted = false;
    yield* put(workspaceTasksReadStarted(workspaceId));
    try {
      if (!(yield* current())) return;
      const result = yield* call([tasks, tasks.list], workspaceId);
      if (!(yield* current())) return;
      yield* put(loadWorkspaceTasksSucceeded(workspaceId, result.tasks, result.stats));
      accepted = true;
    } catch (error) {
      if (yield* current()) {
        yield* put(loadWorkspaceTasksFailed(workspaceId, String(error)));
        accepted = true;
      }
      throw error;
    } finally {
      if ((yield* cancelled()) || !accepted) yield* put(workspaceTasksReadCancelled(workspaceId));
    }
  }
  type TasksReadAction = ReturnType<
    | typeof acquireWorkspaceTasksDemand
    | typeof releaseWorkspaceTasksDemand
    | typeof ensureWorkspaceTasksLoaded
    | typeof loadWorkspaceTasksRequested
    | typeof workspaceUnmounted
    | typeof clearWorkspaceTasks
    | typeof removeWorkspaceEntity
  >;
  function tasksReadContext(action: TasksReadAction) {
    const workspaceId = action.payload[0];
    return action.type === workspaceUnmounted.type ||
      action.type === clearWorkspaceTasks.type ||
      action.type === removeWorkspaceEntity.type
      ? { context: workspaceId, cancel: true as const }
      : workspaceId;
  }
  function* tasksWorker(action: TasksReadAction): SagaGenerator<void> {
    const workspaceId = action.payload[0];
    if (!workspaceId) return;
    try {
      if (runRead) yield* call(runRead, workspaceId, refreshTasks);
      else yield* call(refreshTasks, workspaceId);
    } catch (error) {
      logger.error(`Refresh failed for tasks:${workspaceId}`, error);
    }
  }
  function* reconnect(): SagaGenerator<void> {
    while (true) {
      yield* take(backendReconnected);
      if (selectDemandedTaskWorkspaceIds)
        for (const workspaceId of yield* selectDemandedTaskWorkspaceIds.effect())
          yield* put(ensureWorkspaceTasksLoaded(workspaceId));
    }
  }
  return function* workspaceTasksReadSaga(): SagaGenerator<void> {
    if (selectDemandedTaskWorkspaceIds) yield* fork(reconnect);
    yield* takeSingleFlightInContext(
      [
        acquireWorkspaceTasksDemand,
        releaseWorkspaceTasksDemand,
        ensureWorkspaceTasksLoaded,
        loadWorkspaceTasksRequested,
        workspaceUnmounted,
        clearWorkspaceTasks,
        removeWorkspaceEntity,
      ],
      tasksReadContext,
      tasksWorker,
    );
  };
}
