import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { select } from 'typed-redux-saga';
import { createBackendTasksClient } from '../../../../../lib/client/live/backend-tasks-client';
import * as actions from '../workspace-tasks-slice';
import * as projections from '../workspace-tasks-projections';
import { taskStatusReceiptAccepted } from '../../workspace-notes/workspace-notes-slice';
import {
  backendReconnected,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { createWorkspaceTasksReadSaga } from './workspace-tasks-read-saga-factory';

const running: Task[] = [];
afterEach(() => running.splice(0).forEach((task) => task.cancel()));
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
function pending() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function harness() {
  let state = { workspaceTasks: actions.initialState };
  let context: string | null = 'principal/backend/root';
  const channel = stdChannel();
  const request = vi
    .fn<(...args: unknown[]) => Promise<unknown>>()
    .mockResolvedValue({ tasks: [], stats: { total: 0, completed: 0, inProgress: 0 } });
  const dispatch = (action: { type: string }) => {
    state = { workspaceTasks: actions.workspaceTasksReducer(state.workspaceTasks, action) };
    channel.put(action);
  };
  const saga = createWorkspaceTasksReadSaga({
    tasks: createBackendTasksClient({
      backendRequest: async <T>(...args: unknown[]) => (await request(...args)) as T,
      rememberNoteWorkspace: () => {},
    }),
    selectWorkspaceTasksShouldLoad: {
      effect: function* (id) {
        return yield* select(projections.getWorkspaceTasksShouldLoad, id);
      },
    },
    admittedContext: {
      effect: function* (id) {
        return yield* select(() =>
          context && state.workspaceTasks.byWorkspaceId[id]?.demandIds.length
            ? JSON.stringify([context, state.workspaceTasks.byWorkspaceId[id].demandIds])
            : null,
        );
      },
    },
    selectDemandedTaskWorkspaceIds: {
      effect: function* () {
        return yield* select(projections.getDemandedTaskWorkspaceIds);
      },
    },
  });
  running.push(runSaga({ channel, dispatch, getState: () => state }, saga));
  return {
    dispatch,
    request,
    state: () => state.workspaceTasks.byWorkspaceId.ws,
    context: (value: string | null) => {
      context = value;
    },
  };
}
const response = (status = 'not_started') => ({
  tasks: [{ id: 'task', title: 'Task', status }],
  stats: { total: 1, completed: status === 'complete' ? 1 : 0, inProgress: 0 },
});

describe('shared canonical task read watcher', () => {
  it('forwards the exact explicit workspace query and coalesces a burst into one trailing fresh read', async () => {
    const h = harness();
    const first = pending(),
      second = pending();
    h.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    h.dispatch(actions.acquireWorkspaceTasksDemand('ws', 'view'));
    expect(h.request).toHaveBeenCalledExactlyOnceWith('task.list', { workspaceId: 'ws' });
    h.dispatch(actions.loadWorkspaceTasksRequested('ws'));
    h.dispatch(actions.loadWorkspaceTasksRequested('ws'));
    h.dispatch(actions.ensureWorkspaceTasksLoaded('ws'));
    first.resolve(response());
    await settle();
    expect(h.request).toHaveBeenCalledTimes(2);
    expect(h.state().tasks.ids).toEqual([]);
    second.resolve(response('complete'));
    await settle();
    expect(h.state().tasks.map.task.status).toBe('complete');
    expect(h.state().stats).toEqual({ total: 1, completed: 1, inProgress: 0 });
    expect(h.state().stale).toBe(false);
  });
  it('drops an old revisionless task list after invalidation without clobbering a newer receipt', async () => {
    const h = harness();
    h.dispatch(
      actions.loadWorkspaceTasksSucceeded(
        'ws',
        [{ id: 'task', title: 'Task', status: 'not_started', rev: 1 }],
        { total: 1, completed: 0, inProgress: 0 },
      ),
    );
    const first = pending(),
      second = pending();
    h.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    h.dispatch(actions.acquireWorkspaceTasksDemand('ws', 'view'));
    h.dispatch(actions.loadWorkspaceTasksRequested('ws'));
    h.dispatch(taskStatusReceiptAccepted('ws', 'task', 'complete', 2));
    h.dispatch(actions.loadWorkspaceTasksRequested('ws'));
    first.resolve(response());
    await settle();
    expect(h.state().tasks.map.task).toMatchObject({ status: 'complete', rev: 2 });
    expect(h.request).toHaveBeenCalledTimes(2);
    second.resolve(response('complete'));
    await settle();
    expect(h.state().tasks.map.task.status).toBe('complete');
    expect(h.state().stats.completed).toBe(1);
  });
  it('suppresses old-context completion and releases loading for explicit refresh', async () => {
    const h = harness();
    const first = pending();
    h.request.mockReturnValueOnce(first.promise);
    h.dispatch(actions.acquireWorkspaceTasksDemand('ws', 'view'));
    h.context('new-principal');
    first.resolve(response('complete'));
    await settle();
    expect(h.state().tasks.ids).toEqual([]);
    expect(h.state().loading).toBe(false);
    h.dispatch(actions.ensureWorkspaceTasksLoaded('ws'));
    await settle();
    expect(h.request).toHaveBeenCalledTimes(2);
  });
  it('cancels unmounted reads and only revalidates demanded workspaces after reconnect', async () => {
    const h = harness();
    const first = pending();
    h.request.mockReturnValueOnce(first.promise);
    h.dispatch(actions.acquireWorkspaceTasksDemand('ws', 'view'));
    h.dispatch(workspaceUnmounted('ws'));
    first.resolve(response('complete'));
    await settle();
    expect(h.state().tasks.ids).toEqual([]);
    expect(h.state().loading).toBe(false);
    h.dispatch(backendReconnected());
    await settle();
    expect(h.request).toHaveBeenCalledTimes(1);
    h.dispatch(actions.acquireWorkspaceTasksDemand('ws', 'new-view'));
    await settle();
    h.dispatch(backendReconnected());
    await settle();
    expect(h.request).toHaveBeenCalledTimes(3);
  });
  it('drops a held response after the final demand leaves', async () => {
    const h = harness();
    const first = pending();
    h.request.mockReturnValueOnce(first.promise);
    h.dispatch(actions.acquireWorkspaceTasksDemand('ws', 'view'));
    h.dispatch(actions.releaseWorkspaceTasksDemand('ws', 'view'));
    first.resolve(response('complete'));
    await settle();
    expect(h.state().tasks.ids).toEqual([]);
    expect(h.state().loading).toBe(false);
    h.dispatch(backendReconnected());
    await settle();
    expect(h.request).toHaveBeenCalledTimes(1);
  });
  it('refreshes the remaining demand after a partial release invalidates a held read', async () => {
    const h = harness();
    const first = pending(),
      second = pending(),
      third = pending();
    h.request
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    h.dispatch(actions.acquireWorkspaceTasksDemand('ws', 'progress'));
    h.dispatch(actions.acquireWorkspaceTasksDemand('ws', 'detail'));
    first.resolve(response());
    await settle();
    expect(h.request).toHaveBeenCalledTimes(2);
    h.dispatch(actions.releaseWorkspaceTasksDemand('ws', 'detail'));
    second.resolve(response('complete'));
    await settle();
    expect(h.request).toHaveBeenCalledTimes(3);
    expect(h.state().tasks.ids).toEqual([]);
    third.resolve(response('in_progress'));
    await settle();
    expect(h.state().tasks.map.task.status).toBe('in_progress');
    expect(h.state().stale).toBe(false);
  });
  it('discards a held pre-reconnect response and accepts the trailing read in the new context', async () => {
    const h = harness();
    const first = pending(),
      second = pending();
    h.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    h.dispatch(actions.acquireWorkspaceTasksDemand('ws', 'view'));
    h.context('principal/backend/root/reconnected');
    h.dispatch(backendReconnected());
    first.resolve(response('complete'));
    await settle();
    expect(h.state().tasks.ids).toEqual([]);
    expect(h.request).toHaveBeenCalledTimes(2);
    second.resolve(response('in_progress'));
    await settle();
    expect(h.state().tasks.map.task.status).toBe('in_progress');
    expect(h.state().loading).toBe(false);
  });
});
