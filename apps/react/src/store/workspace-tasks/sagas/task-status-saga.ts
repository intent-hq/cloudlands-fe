import { takeEveryFromSelector } from '@themislib/themis/saga';
import {
  applyNoteUpdated,
  applyNoteCreated,
  applyNoteDeleted,
} from '../../../../../../src/store/renderer/slices/workspace-notes/workspace-notes-slice';
import { tasksReadClient } from '@/features/tasks/tasks-read-client';
import { createWorkspaceTasksReadSaga } from '../../../../../../src/store/renderer/slices/workspace-tasks/sagas/workspace-tasks-read-saga-factory';
import {
  selectWorkspaceTasksShouldLoad,
  selectDemandedTaskWorkspaceIds,
  selectTaskReadContext,
  selectTaskReadScopes,
} from '../workspace-tasks-selectors';
import { call, cancelled, fork, put, take, takeEvery } from 'typed-redux-saga';
import { store } from '@/store';
import { backend } from '@/features/backend/backend-transport';
import { createBackendTaskStatusClient } from '$lib/client/live/backend-task-status-client';
import { createTaskStatusWriteOwner } from '../../../../../../src/features/tasks/task-status-write-owner';
import { readNoteRequested } from '../../../../../../src/store/renderer/slices/workspace-notes/workspace-notes-slice';
import {
  explicitTaskStatusViewOpened,
  explicitTaskStatusReleased,
  ensureWorkspaceTasksLoaded,
  explicitTaskStatusChangeRequested,
  explicitTaskStatusesRetired,
  invalidateWorkspaceTasks,
  loadWorkspaceTasksRequested,
} from '../../../../../../src/store/renderer/slices/workspace-tasks/workspace-tasks-slice';
import {
  selectTaskStatusHostCurrent,
  selectInvalidTaskStatusViews,
} from '../task-status-selectors';

/** The canonical readers own revalidation; mutation receipts never guess the next revision. */
const owner = createTaskStatusWriteOwner({
  explicit: {
    getState: () => store.state,
    dispatch: (action) => store.dispatch(action),
    isCurrent: (identity) => selectTaskStatusHostCurrent.select(store.state, identity),
    client: createBackendTaskStatusClient(backend.backendRequest),
    requestRefresh(workspaceId, noteId) {
      void store
        .dispatch(readNoteRequested(workspaceId, noteId, 'note:updated'))
        .catch(() => undefined);
      store.dispatch(invalidateWorkspaceTasks(workspaceId));
      store.dispatch(loadWorkspaceTasksRequested(workspaceId));
    },
  },
});
const taskReads = createWorkspaceTasksReadSaga({
  tasks: tasksReadClient,
  selectWorkspaceTasksShouldLoad,
  admittedContext: selectTaskReadContext,
  selectDemandedTaskWorkspaceIds,
});
export function* taskStatusSaga() {
  try {
    yield* fork(taskReads);
    yield* takeEveryFromSelector(selectInvalidTaskStatusViews, function* ({ payload }) {
      for (const viewId of payload) yield* put(explicitTaskStatusReleased(viewId));
    });
    yield* takeEveryFromSelector(selectTaskReadScopes, function* ({ payload, prevPayload }) {
      for (const workspaceId of new Set([
        ...Object.keys(prevPayload ?? {}),
        ...Object.keys(payload),
      ])) {
        if (payload[workspaceId] === prevPayload?.[workspaceId]) continue;
        yield* put(invalidateWorkspaceTasks(workspaceId));
        if (payload[workspaceId]) yield* put(ensureWorkspaceTasksLoaded(workspaceId));
      }
    });
    yield* takeEvery([applyNoteUpdated, applyNoteCreated, applyNoteDeleted], function* (action) {
      const workspaceId = action.payload[0];
      yield* put(invalidateWorkspaceTasks(workspaceId));
      yield* put(ensureWorkspaceTasksLoaded(workspaceId));
    });
    yield* takeEvery(explicitTaskStatusViewOpened, function* (action) {
      yield* call(owner.open, action.payload[0]);
    });
    yield* takeEvery(explicitTaskStatusChangeRequested, function* (action) {
      yield* call(owner.update, ...action.payload);
    });
    while (true) yield* take(explicitTaskStatusesRetired);
  } finally {
    if (yield* cancelled()) yield* put(explicitTaskStatusesRetired());
  }
}
