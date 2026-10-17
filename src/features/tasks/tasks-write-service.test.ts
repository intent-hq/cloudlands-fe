import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType, NoteVisibility } from '$shared/types';
import type { Note, TaskStatus, WorkspaceTask } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';

// FAKE seam: appClient.tasks.* are stubbed so no mutation reaches the daemon.
// The service runs against the REAL configured store so optimistic dispatch and
// rollback across the notes + tasks slices are exercised end to end.
vi.mock('$lib/client', () => ({
  appClient: {
    tasks: {
      updateNoteStatus: vi.fn(() => Promise.resolve({ success: true })),
      createPrerequisite: vi.fn(() => Promise.resolve({ success: true })),
    },
  },
}));

// FAKE the toast seam so the conflict prompt is asserted without $lib/components/patterns/notify.
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

import { appClient } from '$lib/client';
import { notify } from '$lib/components/patterns/notify';
import { store as appStore } from '$store/renderer/store';
import { loadWorkspaceNotesSucceeded } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import { loadWorkspaceTasksSucceeded } from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';
import { selectNoteById } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
import { selectWorkspaceTasks } from '$store/renderer/slices/workspace-tasks/workspace-tasks-selectors';
import { createPrerequisiteTask, updateTaskNoteStatus } from './tasks-write-service';

const tasksApi = appClient.tasks as unknown as Record<string, ReturnType<typeof vi.fn>>;
const WS = 'ws-task-svc-1';

function makeTaskNote(id: string, status: TaskStatus): Note {
  const now = new Date().toISOString();
  return {
    id: NoteId(id),
    workspaceId: WorkspaceId(WS),
    title: 'Task Title',
    content: 'body',
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Workspace,
    metadata: { task: { status } },
    createdAt: now,
    updatedAt: now,
  };
}

function makeTask(id: string, status: TaskStatus): WorkspaceTask {
  return { id, title: `Task ${id}`, status };
}

const ZERO_STATS = { total: 0, completed: 0, inProgress: 0 } as const;

function seed(status: TaskStatus): void {
  appStore.dispatch(loadWorkspaceNotesSucceeded([WS], { [WS]: [makeTaskNote('t1', status)] }));
  appStore.dispatch(loadWorkspaceTasksSucceeded(WS, [makeTask('t1', status)], ZERO_STATS));
}

function noteStatus(): TaskStatus | undefined {
  return selectNoteById.select(appStore.state, WS, 't1')?.metadata?.task?.status;
}

function taskStatus(): TaskStatus | undefined {
  return selectWorkspaceTasks.select(appStore.state, WS).find((t) => t.id === 't1')?.status;
}

describe('tasksWriteService (fake seam, real store)', () => {
  beforeAll(() => {
    appStore.init();
  });
  beforeEach(() => {
    tasksApi.updateNoteStatus.mockResolvedValue({ success: true } as never);
    tasksApi.createPrerequisite.mockResolvedValue({ success: true } as never);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('applies the status optimistically to both slices and forwards task.updateNoteStatus', async () => {
    seed('not_started');

    await updateTaskNoteStatus(WS, 't1', 'in_progress');

    expect(tasksApi.updateNoteStatus).toHaveBeenCalledWith('t1', 'in_progress');
    expect(noteStatus()).toBe('in_progress');
    expect(taskStatus()).toBe('in_progress');
  });

  it('rolls both slices back to the prior status on failure', async () => {
    seed('not_started');
    tasksApi.updateNoteStatus.mockResolvedValueOnce({ success: false, error: 'no' } as never);

    await updateTaskNoteStatus(WS, 't1', 'complete');

    expect(tasksApi.updateNoteStatus).toHaveBeenCalledWith('t1', 'complete');
    expect(noteStatus()).toBe('not_started');
    expect(taskStatus()).toBe('not_started');
    expect(notify.error).toHaveBeenCalledOnce();
  });

  it('passes the stored rev as expectedVersion when known (§11.4-D)', async () => {
    appStore.dispatch(
      loadWorkspaceNotesSucceeded([WS], {
        [WS]: [{ ...makeTaskNote('t1', 'not_started'), rev: 5 }],
      }),
    );
    appStore.dispatch(loadWorkspaceTasksSucceeded(WS, [makeTask('t1', 'not_started')], ZERO_STATS));

    await updateTaskNoteStatus(WS, 't1', 'in_progress');

    expect(tasksApi.updateNoteStatus).toHaveBeenCalledWith('t1', 'in_progress', 5);
  });

  it('falls back to the tasks-slice rev when the note carries none (§11.4-D)', async () => {
    appStore.dispatch(
      loadWorkspaceNotesSucceeded([WS], { [WS]: [makeTaskNote('t1', 'not_started')] }),
    );
    appStore.dispatch(
      loadWorkspaceTasksSucceeded(WS, [{ ...makeTask('t1', 'not_started'), rev: 8 }], ZERO_STATS),
    );

    await updateTaskNoteStatus(WS, 't1', 'in_progress');

    expect(tasksApi.updateNoteStatus).toHaveBeenCalledWith('t1', 'in_progress', 8);
  });

  it('createPrerequisiteTask forwards to the seam and returns the surfaced id', async () => {
    tasksApi.createPrerequisite.mockResolvedValueOnce({ success: true, id: 'task-9' } as never);

    const id = await createPrerequisiteTask('dep-1', 'Prereq title', {
      content: 'body',
      status: 'not_started',
    });

    expect(id).toBe('task-9');
    expect(tasksApi.createPrerequisite).toHaveBeenCalledWith('dep-1', 'Prereq title', {
      content: 'body',
      status: 'not_started',
    });
  });

  it('createPrerequisiteTask returns undefined when the seam mutation fails', async () => {
    tasksApi.createPrerequisite.mockResolvedValueOnce({ success: false, error: 'no' } as never);

    expect(await createPrerequisiteTask('dep-1', 'Prereq title')).toBeUndefined();
  });

  // ---- §11.4-D: conflict outcome → reload-to-latest + prompt ----------------

  it('reloads to the server status/rev and prompts on a conflict (no rollback)', async () => {
    appStore.dispatch(
      loadWorkspaceNotesSucceeded([WS], {
        [WS]: [{ ...makeTaskNote('t1', 'not_started'), rev: 3 }],
      }),
    );
    appStore.dispatch(loadWorkspaceTasksSucceeded(WS, [makeTask('t1', 'not_started')], ZERO_STATS));
    tasksApi.updateNoteStatus.mockResolvedValueOnce({
      success: false,
      conflict: { current: { id: 't1', title: 'Task Title', status: 'complete', rev: 12 } },
    } as never);

    await updateTaskNoteStatus(WS, 't1', 'in_progress');

    // Authoritative server status lands in both slices; the optimistic change is
    // NOT rolled back to the prior "not_started".
    expect(noteStatus()).toBe('complete');
    expect(taskStatus()).toBe('complete');
    expect(selectNoteById.select(appStore.state, WS, 't1')?.rev).toBe(12);
    expect(notify.warning).toHaveBeenCalledTimes(1);
  });
});

import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import {
  createEventRecoverySession,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
const flushRecovery = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};
describe('task status continuation after notes recovery', () => {
  beforeAll(() => appStore.init());
  afterEach(() => {
    rendererEventRecovery.dispose();
    vi.clearAllMocks();
  });
  it.each(['failure', 'conflict'] as const)(
    'rejects old %s response after authoritative recovery',
    async (kind) => {
      let receive!: (n: RecoveryNotification) => void;
      const scope = rendererEventRecovery.attach(
        createEventRecoverySession({
          supported: true,
          isCurrent: () => true,
          onRetired: () => () => {},
          onNotification: (fn) => {
            receive = fn;
            return () => {};
          },
          request: async (method, params, observe) => {
            const result =
              method === 'events.subscribe'
                ? { subscriptionId: 'tasks-loss', lossRecovery: 1 }
                : params;
            observe?.(result);
            return result;
          },
          dispose: () => {},
        }),
      );
      const handle = scope.registerResource({
        key: `notes:${JSON.stringify([WS])}`,
        workspaceId: WS,
        eventTypes: ['note:*', 'task:*'],
        isCurrent: () => true,
        read: async () => 'complete' as const,
        apply: (status) => {
          seed(status);
        },
        invalidate: () => {},
        retire: () => {},
      });
      await scope.subscribe(
        { workspaceId: WS, eventTypes: ['note:*', 'task:*'] },
        { recover: true },
      );
      seed('not_started');
      let finish!: (value: import('$lib/client').MutationResult) => void;
      tasksApi.updateNoteStatus.mockImplementationOnce(
        () =>
          new Promise((done) => {
            finish = done;
          }),
      );
      const pending = updateTaskNoteStatus(WS, 't1', 'in_progress');
      receive({
        method: 'events.lost',
        params: { subscriptionId: 'tasks-loss', generation: '1', scope: { workspaceId: WS } },
      });
      await flushRecovery();
      expect(noteStatus()).toBe('complete');
      finish(
        kind === 'conflict'
          ? { success: false, conflict: { current: { id: 't1', status: 'not_started', rev: 2 } } }
          : { success: false, error: 'old failure' },
      );
      await pending;
      expect(noteStatus()).toBe('complete');
      expect(taskStatus()).toBe('complete');
      expect(notify.warning).not.toHaveBeenCalled();
      expect(notify.error).not.toHaveBeenCalled();
      expect(tasksApi.updateNoteStatus).toHaveBeenCalledTimes(1);
      handle.dispose();
    },
  );
});

describe('task status command ownership', () => {
  beforeAll(() => appStore.init());
  afterEach(() => {
    rendererEventRecovery.dispose();
    vi.clearAllMocks();
  });
  it('does not roll back a newer command on the same note', async () => {
    seed('not_started');
    let finish!: (value: import('$lib/client').MutationResult) => void;
    tasksApi.updateNoteStatus.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    const old = updateTaskNoteStatus(WS, 't1', 'in_progress');
    await updateTaskNoteStatus(WS, 't1', 'complete');
    finish({ success: false, error: 'old failure' });
    await old;
    expect(noteStatus()).toBe('complete');
    expect(taskStatus()).toBe('complete');
    expect(notify.error).not.toHaveBeenCalled();
    expect(tasksApi.updateNoteStatus).toHaveBeenCalledTimes(2);
  });
  it.each(['notes', 'tasks'])('rejects a same-ID %s owner replacement', async (domain) => {
    const scope = rendererEventRecovery.attach(
      createEventRecoverySession({
        supported: true,
        isCurrent: () => true,
        onRetired: () => () => {},
        onNotification: () => () => {},
        request: async () => ({}),
        dispose: () => {},
      }),
    );
    const owner = {
      key: `${domain}:${JSON.stringify([WS])}`,
      workspaceId: WS,
      eventTypes: ['task:*'],
      isCurrent: () => true,
      read: async () => null,
      apply: () => undefined,
      invalidate: () => undefined,
      retire: () => undefined,
    };
    const handle = scope.registerResource(owner);
    seed('not_started');
    let finish!: (value: import('$lib/client').MutationResult) => void;
    tasksApi.updateNoteStatus.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    const old = updateTaskNoteStatus(WS, 't1', 'in_progress');
    handle.dispose();
    scope.registerResource(owner);
    seed('complete');
    finish({
      success: false,
      conflict: { current: { id: 't1', status: 'not_started', rev: 2 } },
    } as import('$lib/client').MutationResult);
    await old;
    expect(noteStatus()).toBe('complete');
    expect(taskStatus()).toBe('complete');
    expect(selectNoteById.select(appStore.state, WS, 't1')?.rev).toBeUndefined();
    expect(notify.warning).not.toHaveBeenCalled();
    expect(tasksApi.updateNoteStatus).toHaveBeenCalledTimes(1);
  });
});

import { applyTaskStatusChanged as applyNoteTaskStatusChanged } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import { applyTaskStatusChanged } from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';
describe('task status settlement after sibling task pushes', () => {
  beforeAll(() => appStore.init());
  afterEach(() => {
    rendererEventRecovery.dispose();
    vi.clearAllMocks();
  });
  it.each(['t1', 't2'])(
    'settles the failed t1 command without changing the newer %s push',
    async (pushedId) => {
      const scope = rendererEventRecovery.attach(
        createEventRecoverySession({
          supported: true,
          isCurrent: () => true,
          onRetired: () => () => {},
          onNotification: () => () => {},
          request: async () => ({}),
          dispose: () => {},
        }),
      );
      const handles = ['notes', 'tasks'].map((domain) =>
        scope.registerResource({
          key: `${domain}:${JSON.stringify([WS])}`,
          workspaceId: WS,
          eventTypes: ['note:*', 'task:*'],
          isCurrent: () => true,
          read: async () => null,
          apply: () => {},
          invalidate: () => {},
          retire: () => {},
        }),
      );
      appStore.dispatch(
        loadWorkspaceNotesSucceeded([WS], {
          [WS]: [makeTaskNote('t1', 'not_started'), makeTaskNote('t2', 'not_started')],
        }),
      );
      appStore.dispatch(
        loadWorkspaceTasksSucceeded(
          WS,
          [makeTask('t1', 'not_started'), makeTask('t2', 'not_started')],
          ZERO_STATS,
        ),
      );
      let finish!: (v: import('$lib/client').MutationResult) => void;
      tasksApi.updateNoteStatus.mockImplementationOnce(
        () =>
          new Promise((done) => {
            finish = done;
          }),
      );
      const pending = updateTaskNoteStatus(WS, 't1', 'in_progress');
      for (const domain of ['notes', 'tasks'])
        expect(rendererEventRecovery.push(`${domain}:${JSON.stringify([WS])}`)).toBe(true);
      appStore.dispatch(applyNoteTaskStatusChanged(WS, pushedId, 'complete'));
      appStore.dispatch(applyTaskStatusChanged(WS, pushedId, 'complete'));
      finish({ success: false, error: 'the original command was rejected' });
      await pending;
      expect.soft(noteStatus()).toBe(pushedId === 't1' ? 'complete' : 'not_started');
      expect.soft(taskStatus()).toBe(pushedId === 't1' ? 'complete' : 'not_started');
      expect(selectNoteById.select(appStore.state, WS, pushedId)?.metadata?.task?.status).toBe(
        'complete',
      );
      expect(tasksApi.updateNoteStatus).toHaveBeenCalledTimes(1);
      for (const h of handles) h.dispose();
    },
  );
});

describe('task status reconciliation without a note projection', () => {
  beforeAll(() => appStore.init());
  afterEach(() => {
    rendererEventRecovery.dispose();
    vi.clearAllMocks();
  });
  it('uses one authoritative read after a sibling push when direct rollback is ambiguous', async () => {
    const request = vi.fn(async (method: string, params?: unknown) =>
      method === 'events.subscribe'
        ? { subscriptionId: 'task-reconcile', lossRecovery: 1 }
        : params,
    );
    const scope = rendererEventRecovery.attach(
      createEventRecoverySession({
        supported: true,
        isCurrent: () => true,
        onRetired: () => () => {},
        onNotification: () => () => {},
        request: async (method, params, observe) => {
          const result = await request(method, params);
          observe?.(result);
          return result;
        },
        dispose: () => {},
      }),
    );
    const read = vi.fn(async () => [makeTask('t1', 'not_started'), makeTask('t2', 'complete')]);
    scope.registerResource({
      key: `tasks:${JSON.stringify([WS])}`,
      workspaceId: WS,
      eventTypes: ['task:*'],
      isCurrent: () => true,
      read,
      apply: (tasks) => {
        appStore.dispatch(loadWorkspaceTasksSucceeded(WS, tasks, ZERO_STATS));
      },
      invalidate: () => {},
      retire: () => {},
    });
    await scope.subscribe({ workspaceId: WS, eventTypes: ['task:*'] }, { recover: true });
    appStore.dispatch(loadWorkspaceNotesSucceeded([WS], { [WS]: [] }));
    appStore.dispatch(
      loadWorkspaceTasksSucceeded(
        WS,
        [makeTask('t1', 'not_started'), makeTask('t2', 'not_started')],
        ZERO_STATS,
      ),
    );
    let finish!: (value: import('$lib/client').MutationResult) => void;
    tasksApi.updateNoteStatus.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    const pending = updateTaskNoteStatus(WS, 't1', 'in_progress');
    expect(rendererEventRecovery.push(`tasks:${JSON.stringify([WS])}`)).toBe(true);
    appStore.dispatch(applyTaskStatusChanged(WS, 't2', 'complete'));
    finish({ success: false, error: 'rejected' });
    await pending;
    await flushRecovery();
    expect(taskStatus()).toBe('not_started');
    expect(
      selectWorkspaceTasks.select(appStore.state, WS).find((task) => task.id === 't2')?.status,
    ).toBe('complete');
    expect(read).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.filter(([method]) => method === 'events.fence')).toHaveLength(2);
    expect(tasksApi.updateNoteStatus).toHaveBeenCalledTimes(1);
    expect(notify.error).not.toHaveBeenCalled();
  });
});
