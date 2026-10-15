import type { Note, TaskStatus, Workspace, WorkspaceTask, WorkspaceTaskStats } from '$shared/types';
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  addItem,
  getItems,
  removeItem,
  createCollection,
  getItem,
  updateItem,
} from '@themislib/themis/utils/collections/collection-utils';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import {
  removeWorkspaceEntity,
  replaceWorkspaceList,
  setWorkspaceEntity,
} from '../workspace/workspace-slice';
import type {
  ExplicitTaskStatusIdentity,
  ExplicitTaskStatusView,
  ExplicitTaskStatusRequest,
  ExplicitTaskStatusOperation,
  WorkspaceTasksState,
  WorkspaceTasksWorkspaceState,
} from './workspace-tasks-types';
import {
  backendReconnected,
  workspaceUnmounted,
  workspaceDeleted,
} from '../workspace-lifecycle/workspace-lifecycle-slice';

import {
  taskStatusReceiptAccepted,
  noteContentViewReleased,
  noteContentViewRequested,
  applyNoteDeleted,
  applyNoteUpdated,
  applyLocalNoteUpdate,
  loadWorkspaceNotesSucceeded,
  clearWorkspaceNotesForWorkspaces,
} from '../workspace-notes/workspace-notes-slice';
import { isTaskStatusEditable } from '../../../../features/tasks/task-status-policy';

export type { WorkspaceTasksState, WorkspaceTasksWorkspaceState };

/** Empty `WorkspaceTaskStats` used until the BE rollup arrives from `task.list`. */
export const emptyWorkspaceTaskStats: WorkspaceTaskStats = {
  total: 0,
  completed: 0,
  inProgress: 0,
};

export const emptyWorkspaceTasksState: WorkspaceTasksWorkspaceState = {
  tasks: createCollection<WorkspaceTask, 'id'>('id'),
  stats: emptyWorkspaceTaskStats,
  loading: false,
  error: null,
  initialized: false,
  demandIds: [],
  stale: true,
  revision: 0,
  readRevision: 0,
};

export const initialState: WorkspaceTasksState = {
  explicitStatusViews: createCollection<ExplicitTaskStatusView, 'viewId'>('viewId'),
  explicitStatusOperations: createCollection<ExplicitTaskStatusOperation, 'requestId'>('requestId'),
  revokedStatusViews: {},
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceTasksState);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Invalidate and request a refresh, admitted only while visible demand exists. */
export const loadWorkspaceTasksRequested = createAction<[workspaceId: string]>(
  'workspaceTasks/loadWorkspaceTasksRequested',
);

/** Record actual read admission, including the first ensure-only load. */
export const workspaceTasksReadStarted = createAction<[workspaceId: string]>(
  'workspaceTasks/workspaceTasksReadStarted',
);

export const workspaceTasksReadCancelled = createAction<[workspaceId: string]>(
  'workspaceTasks/readCancelled',
);

/** Check missing/stale data for existing demand; this does not acquire demand. */
export const ensureWorkspaceTasksLoaded = createAction<[workspaceId: string]>(
  'workspaceTasks/ensureWorkspaceTasksLoaded',
);

/**
 * A visible chat dispatches acquire with a unique ID for each visibility lifetime,
 * then releases that same ID on hide, workspace switch, or destroy. Do not acquire
 * from hidden mounted components. Multiple consumers share one canonical read.
 */
export const acquireWorkspaceTasksDemand = createAction<[workspaceId: string, demandId: string]>(
  'workspaceTasks/acquireWorkspaceTasksDemand',
);
export const releaseWorkspaceTasksDemand = createAction<[workspaceId: string, demandId: string]>(
  'workspaceTasks/releaseWorkspaceTasksDemand',
);
/** Mark stale immediately; event bridges schedule a coalesced ensure separately. */
export const invalidateWorkspaceTasks = createAction<[workspaceId: string]>(
  'workspaceTasks/invalidateWorkspaceTasks',
);

/**
 * Saga/middleware success action — applies the `task.list` payload to the
 * slice. The BE-owned `stats` rollup is stored alongside `tasks`; selectors
 * serve it verbatim per the AUDIT-P1-2 thin-presenter rule.
 */
export const loadWorkspaceTasksSucceeded = createAction<
  [workspaceId: string, tasks: WorkspaceTask[], stats: WorkspaceTaskStats]
>('workspaceTasks/loadWorkspaceTasksSucceeded');

export const loadWorkspaceTasksFailed = createAction<[workspaceId: string, error: string]>(
  'workspaceTasks/loadWorkspaceTasksFailed',
);

/** Optimistically apply a task status change ahead of the tasks-changed refresh. */
export const applyTaskStatusChanged = createAction<
  [workspaceId: string, taskId: string, newStatus: TaskStatus]
>('workspaceTasks/applyTaskStatusChanged');

/** Clear all task state for a workspace. */
export const clearWorkspaceTasks = createAction<[workspaceId: string]>(
  'workspaceTasks/clearWorkspaceTasks',
);

/** Public triggers are consumed by the renderer's existing root saga binding. */
export const explicitTaskStatusViewOpened = createAction<[identity: ExplicitTaskStatusIdentity]>(
  'workspaceTasks/explicitStatusViewOpened',
);
export const explicitTaskStatusChangeRequested = createAction<
  [workspaceId: string, noteId: string, status: TaskStatus, request: ExplicitTaskStatusRequest]
>('workspaceTasks/explicitStatusChangeRequested');
export const explicitTaskStatusViewAdmitted = createAction<[identity: ExplicitTaskStatusView]>(
  'workspaceTasks/explicitStatusViewAdmitted',
);
export const explicitTaskStatusReleased = createAction<[viewId: string]>(
  'workspaceTasks/explicitStatusReleased',
);
export const explicitTaskStatusesRetired = createAction('workspaceTasks/explicitStatusesRetired');
export const explicitTaskStatusQueued = createAction<[operation: ExplicitTaskStatusOperation]>(
  'workspaceTasks/explicitStatusQueued',
);
export const explicitTaskStatusStarted = createAction<[requestId: string]>(
  'workspaceTasks/explicitStatusStarted',
);
export const explicitTaskStatusSettled = createAction<
  [
    requestId: string,
    status: 'confirmed' | 'failed' | 'conflict' | 'unknown',
    echoedStatus?: TaskStatus,
    echoedRev?: number,
    error?: string,
  ]
>('workspaceTasks/explicitStatusSettled');

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const workspaceTasksReducer = createReducer<WorkspaceTasksState>(initialState);
/** Revoked view IDs and unresolved receipts survive workspace resets and reconnects. */
function retireStatusViews(
  state: WorkspaceTasksState,
  matches: (view: ExplicitTaskStatusView) => boolean,
): WorkspaceTasksState {
  let views = state.explicitStatusViews;
  let operations = state.explicitStatusOperations;
  let revoked = state.revokedStatusViews;
  for (const view of getItems(views)) {
    if (!matches(view)) continue;
    views = removeItem(views, view.viewId);
    revoked = { ...revoked, [view.viewId]: true };
    for (const operation of getItems(operations)) {
      if (
        operation.viewId !== view.viewId ||
        (operation.status !== 'queued' && operation.status !== 'running')
      )
        continue;
      operations = updateItem(operations, {
        ...operation,
        status: operation.status === 'queued' ? 'failed' : 'unknown',
      });
    }
  }
  return views === state.explicitStatusViews
    ? state
    : {
        ...state,
        explicitStatusViews: views,
        explicitStatusOperations: operations,
        revokedStatusViews: revoked,
      };
}
function observeStatusNote(
  state: WorkspaceTasksState,
  workspaceId: string,
  noteId: string,
  note: Note | undefined,
): WorkspaceTasksState {
  let next = state;
  for (const view of getItems(state.explicitStatusViews)) {
    if (view.workspaceId !== workspaceId || view.noteId !== noteId) continue;
    if (note?.rev !== undefined && note.rev < view.noteRevision) continue;
    if (!isTaskStatusEditable(note)) {
      next = retireStatusViews(next, (candidate) => candidate.viewId === view.viewId);
    } else if (note.rev !== view.noteRevision) {
      next = {
        ...next,
        explicitStatusViews: updateItem(next.explicitStatusViews, {
          ...view,
          noteRevision: note.rev,
        }),
      };
    }
  }
  return next;
}
workspaceTasksReducer.with(explicitTaskStatusViewAdmitted, (state, { payload: [identity] }) => {
  if (
    state.revokedStatusViews[identity.viewId] ||
    getItem(state.explicitStatusViews, identity.viewId)
  )
    return state;
  return { ...state, explicitStatusViews: addItem(state.explicitStatusViews, identity) };
});
workspaceTasksReducer.with(explicitTaskStatusReleased, (state, { payload: [viewId] }) => {
  const retired = retireStatusViews(state, (view) => view.viewId === viewId);
  return retired.revokedStatusViews[viewId]
    ? retired
    : { ...retired, revokedStatusViews: { ...retired.revokedStatusViews, [viewId]: true } };
});
workspaceTasksReducer.with(explicitTaskStatusesRetired, (state) =>
  retireStatusViews(state, () => true),
);
workspaceTasksReducer.with(explicitTaskStatusQueued, (state, { payload: [operation] }) => {
  if (getItem(state.explicitStatusOperations, operation.requestId)) return state;
  return { ...state, explicitStatusOperations: addItem(state.explicitStatusOperations, operation) };
});
workspaceTasksReducer.with(explicitTaskStatusStarted, (state, { payload: [requestId] }) => {
  const operation = getItem(state.explicitStatusOperations, requestId);
  if (operation?.status !== 'queued') return state;
  return {
    ...state,
    explicitStatusOperations: updateItem(state.explicitStatusOperations, {
      ...operation,
      status: 'running',
    }),
  };
});
workspaceTasksReducer.with(
  explicitTaskStatusSettled,
  (state, { payload: [requestId, status, echoedStatus, echoedRev, error] }) => {
    const operation = getItem(state.explicitStatusOperations, requestId);
    if (
      !operation ||
      ['confirmed', 'failed', 'conflict'].includes(operation.status) ||
      (operation.status === status &&
        operation.echoedStatus === echoedStatus &&
        operation.echoedRev === echoedRev &&
        operation.error === error)
    )
      return state;
    return {
      ...state,
      explicitStatusOperations: updateItem(state.explicitStatusOperations, {
        ...operation,
        status,
        echoedStatus,
        echoedRev,
        error,
      }),
    };
  },
);
workspaceTasksReducer.with(
  taskStatusReceiptAccepted,
  (state, { payload: [workspaceId, noteId, status, rev] }) => {
    for (const view of getItems(state.explicitStatusViews)) {
      if (view.workspaceId === workspaceId && view.noteId === noteId && rev > view.noteRevision) {
        state = {
          ...state,
          explicitStatusViews: updateItem(state.explicitStatusViews, {
            ...view,
            noteRevision: rev,
          }),
        };
      }
    }
    const ws = state.byWorkspaceId[workspaceId];
    const task = ws && getItem(ws.tasks, noteId);
    if (
      !task ||
      (task.rev !== undefined && task.rev > rev) ||
      (task.rev === rev && task.status === status)
    )
      return state;
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      tasks: updateItem(ws.tasks, { id: noteId, status, rev }),
    });
  },
);
workspaceTasksReducer.with(
  noteContentViewReleased,
  (state, { payload: [workspaceId, consumerId] }) =>
    retireStatusViews(
      state,
      (view) => view.workspaceId === workspaceId && view.consumerId === consumerId,
    ),
);
workspaceTasksReducer.with(
  noteContentViewRequested,
  (state, { payload: [consumerId, , workspaceId, noteId] }) =>
    retireStatusViews(
      state,
      (view) =>
        view.workspaceId === workspaceId &&
        view.consumerId === consumerId &&
        view.noteId !== noteId,
    ),
);
workspaceTasksReducer.with(applyNoteDeleted, (state, { payload: [ws, noteId] }) =>
  retireStatusViews(state, (view) => view.workspaceId === ws && view.noteId === noteId),
);
workspaceTasksReducer.with(applyNoteUpdated, (state, { payload: [ws, noteId, note] }) =>
  note.workspaceId === ws ? observeStatusNote(state, ws, noteId, note) : state,
);
workspaceTasksReducer.with(applyLocalNoteUpdate, (state, { payload }) => {
  if (payload.updates.rev !== undefined) {
    for (const view of getItems(state.explicitStatusViews)) {
      if (
        view.workspaceId === payload.workspaceId &&
        view.noteId === payload.noteId &&
        payload.updates.rev > view.noteRevision
      ) {
        state = {
          ...state,
          explicitStatusViews: updateItem(state.explicitStatusViews, {
            ...view,
            noteRevision: payload.updates.rev,
          }),
        };
      }
    }
  }
  if (
    payload.updates.isArchived !== true &&
    !payload.updates.metadata?.task?.assignedAgentIds?.length
  )
    return state;
  return retireStatusViews(
    state,
    (view) => view.workspaceId === payload.workspaceId && view.noteId === payload.noteId,
  );
});
workspaceTasksReducer.with(
  loadWorkspaceNotesSucceeded,
  (state, { payload: [workspaceIds, notesByWorkspace] }) => {
    let next = state;
    for (const view of getItems(state.explicitStatusViews)) {
      if (workspaceIds.includes(view.workspaceId))
        next = observeStatusNote(
          next,
          view.workspaceId,
          view.noteId,
          notesByWorkspace[view.workspaceId]?.find((note) => note.id === view.noteId),
        );
    }
    return next;
  },
);
workspaceTasksReducer.with(clearWorkspaceNotesForWorkspaces, (state, { payload: [workspaceIds] }) =>
  retireStatusViews(state, (view) => workspaceIds.includes(view.workspaceId)),
);
workspaceTasksReducer.with(workspaceDeleted, (state, { payload: [id] }) =>
  retireStatusViews(state, (view) => view.workspaceId === id),
);
function invalidate(state: WorkspaceTasksState, workspaceId: string): WorkspaceTasksState {
  const ws = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, { ...ws, stale: true, revision: ws.revision + 1 });
}
workspaceTasksReducer.with(invalidateWorkspaceTasks, (state, { payload: [id] }) =>
  invalidate(state, id),
);
// Events may have been missed while disconnected. Retain rows and demand,
// but invalidate every cache; the read owner refreshes displayed consumers only.
workspaceTasksReducer.with(backendReconnected, (state) =>
  Object.keys(state.byWorkspaceId).reduce(invalidate, state),
);
workspaceTasksReducer.with(loadWorkspaceTasksRequested, (state, { payload: [id] }) =>
  invalidate(state, id),
);
workspaceTasksReducer.with(acquireWorkspaceTasksDemand, (state, { payload: [id, demandId] }) => {
  const ws = getWorkspaceState(state, id);
  if (ws.demandIds.includes(demandId)) return state;
  return setWorkspaceState(state, id, { ...ws, demandIds: [...ws.demandIds, demandId] });
});
workspaceTasksReducer.with(releaseWorkspaceTasksDemand, (state, { payload: [id, demandId] }) => {
  const ws = state.byWorkspaceId[id];
  if (!ws?.demandIds.includes(demandId)) return state;
  return setWorkspaceState(state, id, {
    ...ws,
    demandIds: ws.demandIds.filter((value) => value !== demandId),
  });
});
workspaceTasksReducer.with(workspaceTasksReadStarted, (state, { payload: [workspaceId] }) => {
  const ws = getWorkspaceState(state, workspaceId);
  if (ws.loading && ws.error === null) return state;
  return setWorkspaceState(state, workspaceId, {
    ...ws,
    loading: true,
    error: null,
    readRevision: ws.revision,
  });
});
workspaceTasksReducer.with(
  loadWorkspaceTasksSucceeded,
  (state, { payload: [workspaceId, tasks, stats] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      tasks:
        ws.revision !== ws.readRevision
          ? ws.tasks
          : createCollection<WorkspaceTask, 'id'>(
              'id',
              tasks.map((task) => {
                const existing = getItem(ws.tasks, task.id);
                return existing?.rev !== undefined &&
                  task.rev !== undefined &&
                  existing.rev > task.rev
                  ? existing
                  : task;
              }),
            ),
      // An invalidated read may finish after a newer workspace summary.
      // Keep that aggregate, especially when no demand remains to re-read tasks.
      stats: ws.revision === ws.readRevision ? stats : ws.stats,
      loading: false,
      error: null,
      initialized: true,
      stale: ws.revision !== ws.readRevision,
    });
  },
);
workspaceTasksReducer.with(workspaceTasksReadCancelled, (state, { payload: [workspaceId] }) => {
  const ws = state.byWorkspaceId[workspaceId];
  return ws?.loading
    ? setWorkspaceState(state, workspaceId, { ...ws, loading: false, stale: true })
    : state;
});
workspaceTasksReducer.with(loadWorkspaceTasksFailed, (state, { payload: [workspaceId, error] }) => {
  const ws = getWorkspaceState(state, workspaceId);
  if (!ws.loading && ws.error === error) return state;
  return setWorkspaceState(state, workspaceId, {
    ...ws,
    loading: false,
    error,
    stale: true,
  });
});
workspaceTasksReducer.with(
  applyTaskStatusChanged,
  (state, { payload: [workspaceId, taskId, newStatus] }) => {
    const ws = state.byWorkspaceId[workspaceId];
    if (!ws?.initialized) return state;

    const task = getItem(ws.tasks, taskId as WorkspaceTask['id']);
    if (!task || task.status === newStatus) return state;

    return setWorkspaceState(state, workspaceId, {
      ...ws,
      tasks: updateItem(ws.tasks, { id: task.id, status: newStatus }),
    });
  },
);
// Unmount cancels the owning saga read; release its loading state for future demand.
workspaceTasksReducer.with(workspaceUnmounted, (state, { payload: [workspaceId] }) => {
  state = retireStatusViews(state, (view) => view.workspaceId === workspaceId);
  const ws = state.byWorkspaceId[workspaceId];
  return ws
    ? setWorkspaceState(state, workspaceId, {
        ...ws,
        loading: false,
        demandIds: [],
        stale: ws.stale || ws.loading,
      })
    : state;
});
workspaceTasksReducer.with(clearWorkspaceTasks, (state, { payload: [workspaceId] }) =>
  clearWorkspaceState(
    retireStatusViews(state, (view) => view.workspaceId === workspaceId),
    workspaceId,
  ),
);
workspaceTasksReducer.with(removeWorkspaceEntity, (state, { payload: [wsId] }) =>
  clearWorkspaceState(
    retireStatusViews(state, (view) => view.workspaceId === wsId),
    wsId,
  ),
);

/**
 * Seed `stats` from a workspace list row's `taskStats` rollup (PROTOCOL §5.1)
 * so sidebar progress renders before any per-workspace `task.list` load.
 * A clean task list stays authoritative. Once invalidated, accept fresher
 * daemon summaries without treating stale individual rows as initialized anew.
 */
function seedStatsFromListRow(
  state: WorkspaceTasksState,
  workspace: Workspace,
): WorkspaceTasksState {
  const stats = workspace.taskStats;
  if (!stats) return state;

  const ws = getWorkspaceState(state, workspace.id);
  if (ws.initialized && !ws.stale) return state;
  // Shallow-compare every field present on the incoming rollup so the no-op
  // check stays correct if the wire shape grows beyond the current trio.
  const keys = Object.keys(stats) as (keyof WorkspaceTaskStats)[];
  if (keys.every((key) => ws.stats[key] === stats[key])) return state;

  return setWorkspaceState(state, workspace.id, {
    ...ws,
    stats,
  });
}

workspaceTasksReducer.with(replaceWorkspaceList, (state, { payload: [workspaces] }) =>
  workspaces.reduce(seedStatsFromListRow, state),
);
workspaceTasksReducer.with(setWorkspaceEntity, (state, { payload: [workspace] }) =>
  seedStatsFromListRow(state, workspace),
);
