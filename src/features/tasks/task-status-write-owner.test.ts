import { describe, expect, it, vi } from 'vitest';
import { ContentType, NoteVisibility, type Note, type TaskStatus } from '../../shared/types';
import { NoteId, WorkspaceId } from '../../shared/types/branded-ids';
import { createBackendTaskStatusClient } from '../../lib/client/live/backend-task-status-client';
import type { TaskStatusTransport } from '../../lib/client/live/backend-task-status-types';
import { BackendError } from '../../lib/client/live/backend-transport-types';
import * as notes from '../../store/renderer/slices/workspace-notes/workspace-notes-slice';
import * as tasks from '../../store/renderer/slices/workspace-tasks/workspace-tasks-slice';
import * as projections from '../../store/renderer/slices/workspace-tasks/workspace-tasks-projections';
import { getNoteById } from '../../store/renderer/slices/workspace-notes/workspace-notes-projections';
import {
  backendReconnected,
  workspaceUnmounted,
} from '../../store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import type { ExplicitTaskStatusIdentity } from '../../store/renderer/slices/workspace-tasks/workspace-tasks-types';
import { createTaskStatusWriteOwner } from './task-status-write-owner';

const identity: ExplicitTaskStatusIdentity = {
  workspaceId: 'ws',
  noteId: 'task',
  viewId: 'view',
  consumerId: 'content',
  authority: 'principal@backend',
  context: 'root-connection-1',
};
const note = (status: TaskStatus = 'not_started', rev = 1): Note => ({
  id: NoteId('task'),
  workspaceId: WorkspaceId('ws'),
  title: 'Task',
  content: 'Untouched body',
  contentType: ContentType.Markdown,
  tags: [],
  isPinned: false,
  isArchived: false,
  visibility: NoteVisibility.Workspace,
  metadata: { task: { status } },
  rev,
  createdAt: '2026-10-15T00:00:00Z',
  updatedAt: '2026-10-15T00:00:00Z',
});
const ack = (status: TaskStatus = 'in_progress', rev = 2) => ({
  ok: true,
  noteId: 'task',
  status,
  note: note(status, rev),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function harness() {
  let state = { workspaceNotes: notes.initialState, workspaceTasks: tasks.initialState };
  let active = true;
  let afterDispatch: ((action: { type: string }) => void) | undefined;
  let beforeWire: (() => void) | undefined;
  const dispatch = (action: { type: string }) => {
    state = {
      workspaceNotes: notes.workspaceNotesReducer(state.workspaceNotes, action),
      workspaceTasks: tasks.workspaceTasksReducer(state.workspaceTasks, action),
    };
    afterDispatch?.(action);
  };
  const wire = vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(ack());
  const request: TaskStatusTransport = async <T>(
    method: string,
    params?: unknown,
    options?: { onDispatch?: () => void },
  ) => {
    beforeWire?.();
    options?.onDispatch?.();
    return (await wire(method, params)) as T;
  };
  const refresh = vi.fn();
  const owner = createTaskStatusWriteOwner({
    explicit: {
      getState: () => state,
      dispatch,
      isCurrent: (value) =>
        active && value.authority === identity.authority && value.context === identity.context,
      client: createBackendTaskStatusClient(request),
      requestRefresh: refresh,
    },
  });
  const hydrate = (value = note()) => {
    dispatch(notes.loadWorkspaceNotesSucceeded(['ws'], { ws: [value] }));
    dispatch(
      tasks.loadWorkspaceTasksSucceeded(
        'ws',
        [{ id: 'task', title: 'Task', status: value.metadata!.task!.status, rev: value.rev }],
        { total: 9, completed: 2, inProgress: 3 },
      ),
    );
  };
  hydrate();
  owner.open(identity);
  return {
    owner,
    dispatch,
    wire,
    refresh,
    hydrate,
    state: () => state,
    note: () => getNoteById(state, 'ws', 'task'),
    operations: () => projections.getExplicitTaskStatusOperations(state, 'ws', 'task'),
    blocked: () => projections.getExplicitTaskStatusBlocked(state, 'ws', 'task'),
    change: (
      id = 'request',
      status: TaskStatus = 'in_progress',
      expectedVersion = 1,
      view = identity,
    ) => owner.update('ws', 'task', status, { ...view, requestId: id, expectedVersion }),
    beforeWire: (fn: () => void) => {
      beforeWire = fn;
    },
    afterDispatch: (fn: (action: { type: string }) => void) => {
      afterDispatch = fn;
    },
    setActive: (value: boolean) => {
      active = value;
    },
  };
}

describe('canonical explicit task status owner and strict backend client', () => {
  it('sends exact scoped CAS params and applies only a newer validated status/revision receipt', async () => {
    const h = harness();
    await h.change();
    expect(h.wire).toHaveBeenCalledExactlyOnceWith('task.updateNoteStatus', {
      workspaceId: 'ws',
      noteId: 'task',
      status: 'in_progress',
      expectedVersion: 1,
    });
    expect(h.note()).toMatchObject({
      content: 'Untouched body',
      rev: 2,
      metadata: { task: { status: 'in_progress' } },
    });
    expect(h.state().workspaceTasks.byWorkspaceId.ws.tasks.map.task).toMatchObject({
      status: 'in_progress',
      rev: 2,
    });
    expect(h.state().workspaceTasks.byWorkspaceId.ws.stats).toEqual({
      total: 9,
      completed: 2,
      inProgress: 3,
    });
    expect(h.operations()).toMatchObject([
      { status: 'confirmed', echoedRev: 2, echoedStatus: 'in_progress' },
    ]);
    expect(JSON.stringify(h.operations())).not.toContain('Untouched body');
    expect(h.refresh).toHaveBeenCalledExactlyOnceWith('ws', 'task');
  });
  it('treats the genuine daemon pre-write revision as confirmed but blocks until canonical refresh advances', async () => {
    const h = harness();
    h.wire.mockResolvedValueOnce(ack('in_progress', 1));
    await h.change();
    expect(h.operations()[0]).toMatchObject({ status: 'confirmed', echoedRev: 1 });
    expect(h.note()?.rev).toBe(1);
    expect(h.note()?.metadata?.task?.status).toBe('not_started');
    expect(h.blocked()).toBe(true);
    await h.change('premature', 'complete');
    expect(h.wire).toHaveBeenCalledTimes(1);
    h.hydrate(note('in_progress', 2));
    expect(h.blocked()).toBe(false);
    h.wire.mockResolvedValueOnce(ack('complete', 2));
    await h.change('next', 'complete', 2);
    expect(h.wire).toHaveBeenLastCalledWith('task.updateNoteStatus', {
      workspaceId: 'ws',
      noteId: 'task',
      status: 'complete',
      expectedVersion: 2,
    });
  });
  it('does not send no-op status or concurrent duplicate clicks', async () => {
    const h = harness();
    await h.change('noop', 'not_started');
    expect(h.wire).not.toHaveBeenCalled();
    const d = deferred<unknown>();
    h.wire.mockReturnValueOnce(d.promise);
    const first = h.change();
    await h.change('second', 'complete');
    expect(h.wire).toHaveBeenCalledTimes(1);
    d.resolve(ack());
    await first;
  });
  it.each(['authority', 'revision', 'assignment', 'release', 'running-marker'] as const)(
    'rechecks %s at the final wire boundary',
    async (reason) => {
      const h = harness();
      const change = () => {
        if (reason === 'authority') h.setActive(false);
        if (reason === 'revision')
          h.dispatch(notes.applyNoteUpdated('ws', 'task', note('complete', 5)));
        if (reason === 'assignment')
          h.dispatch(
            notes.applyNoteUpdated('ws', 'task', {
              ...note(),
              metadata: { task: { status: 'not_started', assignedAgentIds: ['agent' as never] } },
            }),
          );
        if (reason === 'release') h.dispatch(tasks.explicitTaskStatusReleased('view'));
      };
      if (reason === 'running-marker')
        h.afterDispatch((action) => {
          if (action.type === tasks.explicitTaskStatusStarted.type) h.setActive(false);
        });
      else h.beforeWire(change);
      await h.change();
      expect(h.wire).not.toHaveBeenCalled();
      expect(h.operations()[0].status).toBe('failed');
    },
  );
  it('permits deliberate new-request retry after a structured daemon refusal', async () => {
    const h = harness();
    h.wire.mockRejectedValueOnce(
      new BackendError({ code: 'denied', message: 'Denied', rpcCode: -32003 }),
    );
    await h.change();
    expect(h.operations()[0].status).toBe('failed');
    expect(h.blocked()).toBe(false);
    await h.change('request');
    expect(h.wire).toHaveBeenCalledTimes(1);
    await h.change('retry');
    expect(h.wire).toHaveBeenCalledTimes(2);
    expect(h.operations()[1].status).toBe('confirmed');
  });
  it('keeps transport uncertainty blocking across release, reset and reconnect without replay', async () => {
    const h = harness();
    h.wire.mockRejectedValueOnce(new Error('Socket lost'));
    await h.change();
    expect(h.operations()[0].status).toBe('unknown');
    h.dispatch(tasks.explicitTaskStatusReleased('view'));
    h.dispatch(tasks.clearWorkspaceTasks('ws'));
    h.dispatch(notes.clearWorkspaceNotesForWorkspaces(['ws']));
    h.dispatch(backendReconnected());
    h.hydrate(note('in_progress', 2));
    const next = { ...identity, viewId: 'next' };
    h.owner.open(next);
    await h.change('retry', 'complete', 2, next);
    expect(h.wire).toHaveBeenCalledTimes(1);
    expect(h.blocked()).toBe(true);
  });
  it('reloads a valid conflict without replay and preserves newer event/hydration state', async () => {
    const h = harness();
    h.wire.mockRejectedValueOnce(
      new BackendError({
        code: 'conflict',
        rpcCode: -32005,
        message: 'Conflict',
        data: { code: 'conflict', current: note('blocked', 3) },
      }),
    );
    await h.change();
    expect(h.note()?.rev).toBe(1);
    expect(h.blocked()).toBe(true);
    expect(h.operations()[0].status).toBe('conflict');
    expect(h.wire).toHaveBeenCalledTimes(1);
    h.hydrate(note('blocked', 3));
    expect(h.blocked()).toBe(false);
    h.hydrate(note('not_started', 1));
    expect(h.note()?.rev).toBe(3);
    expect(h.state().workspaceTasks.byWorkspaceId.ws.tasks.map.task.rev).toBe(3);
  });
  it.each(['event', 'hydration'] as const)(
    'does not retire a current view from a stale assigned %s',
    async (source) => {
      const h = harness();
      h.hydrate(note('not_started', 5));
      const stale = note('not_started', 2);
      stale.metadata!.task!.assignedAgentIds = ['agent-assigned' as never];
      if (source === 'event') h.dispatch(notes.applyNoteUpdated('ws', 'task', stale));
      else h.hydrate(stale);
      h.wire.mockResolvedValueOnce(ack('in_progress', 5));
      await h.change('current', 'in_progress', 5);
      expect(h.wire).toHaveBeenCalledExactlyOnceWith('task.updateNoteStatus', {
        workspaceId: 'ws',
        noteId: 'task',
        status: 'in_progress',
        expectedVersion: 5,
      });
    },
  );
  it('does not grant a retry from a conflict revision before authoritative eligibility is read', async () => {
    const h = harness();
    const assigned = note('blocked', 3);
    assigned.metadata!.task!.assignedAgentIds = ['agent-assigned' as never];
    h.wire.mockRejectedValueOnce(
      new BackendError({
        code: 'conflict',
        rpcCode: -32005,
        message: 'Conflict',
        data: { code: 'conflict', current: assigned },
      }),
    );
    await h.change();
    await h.change('premature', 'complete', 3);
    expect(h.note()?.rev).toBe(1);
    expect(h.blocked()).toBe(true);
    expect(h.wire).toHaveBeenCalledTimes(1);
    h.hydrate(assigned);
    await h.change('after-read', 'complete', 3);
    expect(h.wire).toHaveBeenCalledTimes(1);
    expect(projections.getExplicitTaskStatusCurrent(h.state(), identity)).toBe(false);
  });
  it('retains a late receipt but cannot overwrite a newer event or departed view', async () => {
    const h = harness();
    const d = deferred<unknown>();
    h.wire.mockReturnValueOnce(d.promise);
    const pending = h.change();
    h.dispatch(notes.applyNoteUpdated('ws', 'task', note('complete', 7)));
    d.resolve(ack());
    await pending;
    expect(h.note()).toMatchObject({ rev: 7, metadata: { task: { status: 'complete' } } });
    const h2 = harness();
    const d2 = deferred<unknown>();
    h2.wire.mockReturnValueOnce(d2.promise);
    const p2 = h2.change();
    h2.dispatch(workspaceUnmounted('ws'));
    d2.resolve(ack());
    await p2;
    expect(h2.operations()[0].status).toBe('confirmed');
    expect(h2.note()).toBeUndefined();
    expect(h2.refresh).not.toHaveBeenCalled();
  });
  it.each([
    'deleted',
    'archived',
    'assigned',
    'content-release',
    'replacement',
    'retired',
  ] as const)('permanently revokes %s ABA before a rerender', async (reason) => {
    const h = harness();
    if (reason === 'deleted') {
      h.dispatch(notes.applyNoteDeleted('ws', 'task'));
      h.dispatch(notes.applyNoteCreated('ws', note()));
    }
    if (reason === 'archived') {
      h.dispatch(notes.applyNoteUpdated('ws', 'task', { ...note(), isArchived: true }));
      h.dispatch(notes.applyNoteUpdated('ws', 'task', note()));
    }
    if (reason === 'assigned') {
      h.dispatch(
        notes.applyNoteUpdated('ws', 'task', {
          ...note(),
          metadata: { task: { status: 'not_started', assignedAgentIds: ['a' as never] } },
        }),
      );
      h.dispatch(notes.applyNoteUpdated('ws', 'task', note()));
    }
    if (reason === 'content-release') h.dispatch(notes.noteContentViewReleased('ws', 'content'));
    if (reason === 'replacement')
      h.dispatch(notes.noteContentViewRequested('content', 'load', 'ws', 'different'));
    if (reason === 'retired') h.dispatch(tasks.explicitTaskStatusesRetired());
    h.owner.open(identity);
    await h.change();
    expect(h.wire).not.toHaveBeenCalled();
    expect(h.state().workspaceTasks.revokedStatusViews.view).toBe(true);
  });
  it('preserves an admitted view when its own note content is refreshed', async () => {
    const h = harness();
    h.dispatch(notes.noteContentViewRequested('content', 'refresh', 'ws', 'task'));
    expect(projections.getExplicitTaskStatusCurrent(h.state(), identity)).toBe(true);
  });
  it.each(['spec', 'default', 'archive', 'assigned', 'not-task', 'invalid-revision'] as const)(
    'refuses ineligible %s admission',
    async (reason) => {
      const h = harness();
      h.dispatch(tasks.explicitTaskStatusesRetired());
      let value = note();
      if (reason === 'spec') value = { ...value, id: NoteId('spec') };
      if (reason === 'default') value = { ...value, isDefault: true };
      if (reason === 'archive') value = { ...value, isArchived: true };
      if (reason === 'assigned')
        value = {
          ...value,
          metadata: { task: { status: 'not_started', assignedAgentIds: ['a' as never] } },
        };
      if (reason === 'not-task') value = { ...value, metadata: {} };
      if (reason === 'invalid-revision') value = { ...value, rev: NaN };
      h.dispatch(notes.loadWorkspaceNotesSucceeded(['ws'], { ws: [value] }));
      const next = { ...identity, viewId: 'next' };
      h.owner.open(next);
      await h.change('next', 'complete', 1, next);
      expect(h.wire).not.toHaveBeenCalled();
    },
  );
  it('treats malformed or wrong-target successful replies as unknown', async () => {
    const h = harness();
    h.wire.mockResolvedValueOnce({
      ...ack(),
      note: { ...note('in_progress', 2), workspaceId: 'foreign' },
    });
    await h.change();
    expect(h.operations()[0].status).toBe('unknown');
    expect(h.note()?.rev).toBe(1);
    expect(h.blocked()).toBe(true);
  });
  it('keeps receipts serializable and duplicate settlement/release actions idempotent', async () => {
    const h = harness();
    await h.change();
    const settled = h.state().workspaceTasks;
    h.dispatch(tasks.explicitTaskStatusSettled('request', 'confirmed', 'in_progress', 2));
    expect(h.state().workspaceTasks).toBe(settled);
    expect(structuredClone(settled)).toEqual(settled);
    h.dispatch(tasks.explicitTaskStatusReleased('view'));
    const released = h.state().workspaceTasks;
    h.dispatch(tasks.explicitTaskStatusReleased('view'));
    expect(h.state().workspaceTasks).toBe(released);
    expect(h.operations()[0].status).toBe('confirmed');
  });
  it('cannot re-admit an identity released before its open was processed', async () => {
    const h = harness();
    h.dispatch(tasks.explicitTaskStatusReleased('not-opened'));
    const view = { ...identity, viewId: 'not-opened' };
    h.owner.open(view);
    await h.change('late-open', 'complete', 1, view);
    expect(h.wire).not.toHaveBeenCalled();
  });
  it('keeps an ambiguous response unknown when the transport failed to invoke its dispatch boundary', async () => {
    const h = harness();
    const owner = createTaskStatusWriteOwner({
      explicit: {
        getState: h.state,
        dispatch: h.dispatch,
        isCurrent: () => true,
        client: createBackendTaskStatusClient(async <T>() => ack() as T),
        requestRefresh: h.refresh,
      },
    });
    await owner.update('ws', 'task', 'in_progress', {
      ...identity,
      requestId: 'missing-boundary',
      expectedVersion: 1,
    });
    expect(h.operations()[0].status).toBe('unknown');
    expect(h.blocked()).toBe(true);
    expect(h.note()?.rev).toBe(1);
  });
});
