import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ linkAgent: vi.fn(), unlinkAgent: vi.fn() }));
vi.mock('$lib/client', () => ({ appClient: { tasks: mocks } }));

import {
  addTaskAgentAssociation,
  applyTaskAgentLinked,
  applyTaskAgentUnlinked,
  hydrateTaskAgentAssociations,
  initialState as initialTaskAgentAssociationsState,
  pruneTaskAgentAssociationsForNote,
  removeTaskAgentAssociation,
  taskAgentAssociationsReducer,
} from '../task-agent-associations-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { taskAgentAssociationsSaga } from './task-agent-associations-saga';
import {
  beginLifecycleMetadataMutation,
  taskAgentLinksRecoveryKey,
  runLifecycleMetadataRead,
} from '$features/events/lifecycle-metadata-recovery';
import { RendererEventRecovery } from '$features/events/renderer-event-recovery';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

type AssociationAction = Parameters<typeof taskAgentAssociationsReducer>[1];

function harness(
  byNoteId: Parameters<typeof hydrateTaskAgentAssociations>[1] = {},
  onMutationQueueCountChange?: (count: number) => void,
) {
  let associations = taskAgentAssociationsReducer(
    initialTaskAgentAssociationsState,
    hydrateTaskAgentAssociations('ws-1', byNoteId),
  );
  const channel = stdChannel();
  const task = runSaga(
    { channel, dispatch: vi.fn(), getState: () => ({ taskAgentAssociations: associations }) },
    taskAgentAssociationsSaga,
    { onMutationQueueCountChange },
  );
  const send = (action: AssociationAction) => {
    associations = taskAgentAssociationsReducer(associations, action);
    channel.put(action);
  };
  return { send, task };
}

describe('taskAgentAssociationsSaga', () => {
  afterEach(() => vi.clearAllMocks());

  it('links exact payloads and fans pruned keys out independently', async () => {
    mocks.linkAgent.mockResolvedValue(undefined);
    mocks.unlinkAgent.mockResolvedValue(undefined);
    let associations = taskAgentAssociationsReducer(
      initialTaskAgentAssociationsState,
      hydrateTaskAgentAssociations('ws-1', {
        'note-1': {
          first: {
            taskKey: 'first',
            noteId: 'note-1',
            createdAt: 1,
            taskText: 'First',
            agentId: 'agent-1',
          },
          second: {
            taskKey: 'second',
            noteId: 'note-1',
            createdAt: 1,
            taskText: 'Second',
            agentId: 'agent-2',
          },
        },
      }),
    );
    const channel = stdChannel();
    const task = runSaga(
      { channel, dispatch: vi.fn(), getState: () => ({ taskAgentAssociations: associations }) },
      taskAgentAssociationsSaga,
    );
    await settle();

    const added = {
      taskKey: 'third',
      noteId: 'note-1',
      createdAt: 1,
      taskText: 'Third',
      agentId: 'agent-3',
    };
    const addAction = addTaskAgentAssociation('ws-1', 'note-1', added);
    associations = taskAgentAssociationsReducer(associations, addAction);
    channel.put(addAction);
    await settle();
    expect(mocks.linkAgent).toHaveBeenCalledWith('ws-1', 'note-1', added);

    const pruneAction = pruneTaskAgentAssociationsForNote('ws-1', 'note-1', ['third']);
    associations = taskAgentAssociationsReducer(associations, pruneAction);
    channel.put(pruneAction);
    await settle();
    expect(mocks.unlinkAgent.mock.calls).toEqual(
      expect.arrayContaining([
        ['ws-1', 'note-1', 'first'],
        ['ws-1', 'note-1', 'second'],
      ]),
    );
    task.cancel();
    await task.toPromise();
  });

  it('removes associations by exact key or legacy task text using daemon task keys', async () => {
    mocks.unlinkAgent.mockResolvedValue(undefined);
    const run = harness({
      'note-1': {
        'key-alpha': {
          taskKey: 'key-alpha',
          noteId: 'note-1',
          createdAt: 1,
          taskText: 'Alpha',
          agentId: 'agent-1',
        },
        'key-beta': {
          taskKey: 'key-beta',
          noteId: 'note-1',
          createdAt: 1,
          taskText: 'Beta',
          agentId: 'agent-2',
        },
      },
    });
    await settle();
    run.send(removeTaskAgentAssociation('ws-1', 'note-1', 'key-alpha'));
    await settle();
    run.send(removeTaskAgentAssociation('ws-1', 'note-1', 'Beta'));
    await settle();
    expect(mocks.unlinkAgent.mock.calls).toEqual([
      ['ws-1', 'note-1', 'key-alpha'],
      ['ws-1', 'note-1', 'key-beta'],
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('does not echo no-op or daemon-authoritative hydration/link/unlink actions', async () => {
    const run = harness();
    await settle();
    run.send(removeTaskAgentAssociation('ws-1', 'missing', 'missing'));
    run.send(
      applyTaskAgentLinked('ws-1', 'note-1', {
        taskKey: 'linked',
        noteId: 'note-1',
        createdAt: 1,
        taskText: 'Linked',
        agentId: 'agent-1',
      }),
    );
    run.send(applyTaskAgentUnlinked('ws-1', 'note-1', 'linked'));
    run.send(
      hydrateTaskAgentAssociations('ws-1', {
        'note-2': {
          hydrated: {
            taskKey: 'hydrated',
            noteId: 'note-1',
            createdAt: 1,
            taskText: 'Hydrated',
            agentId: 'agent-2',
          },
        },
      }),
    );
    await settle();
    expect(mocks.linkAgent).not.toHaveBeenCalled();
    expect(mocks.unlinkAgent).not.toHaveBeenCalled();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('replaces workspace snapshots on hydration so omitted notes cannot unlink later', async () => {
    const run = harness({
      'note-old': {
        stale: {
          taskKey: 'stale',
          noteId: 'note-1',
          createdAt: 1,
          taskText: 'Stale',
          agentId: 'agent-old',
        },
      },
    });
    await settle();
    run.send(
      hydrateTaskAgentAssociations('ws-1', {
        'note-new': {
          fresh: {
            taskKey: 'fresh',
            noteId: 'note-1',
            createdAt: 1,
            taskText: 'Fresh',
            agentId: 'agent-new',
          },
        },
      }),
    );
    run.send(removeTaskAgentAssociation('ws-1', 'note-old', 'stale'));
    run.send(pruneTaskAgentAssociationsForNote('ws-1', 'note-old', []));
    await settle();
    expect(mocks.unlinkAgent).not.toHaveBeenCalled();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('runs same-key mutations FIFO', async () => {
    const firstCall = deferred();
    mocks.linkAgent.mockImplementationOnce(() => firstCall.promise).mockResolvedValue(undefined);
    const run = harness();
    await settle();
    const first = {
      taskKey: 'same',
      noteId: 'note-1',
      createdAt: 1,
      taskText: 'Same',
      agentId: 'agent-1',
    };
    const second = { ...first, agentId: 'agent-2' };
    run.send(addTaskAgentAssociation('ws-1', 'note-1', first));
    await settle();
    run.send(addTaskAgentAssociation('ws-1', 'note-1', second));
    await settle();
    expect(mocks.linkAgent.mock.calls).toEqual([['ws-1', 'note-1', first]]);
    firstCall.resolve();
    await settle();
    expect(mocks.linkAgent.mock.calls).toEqual([
      ['ws-1', 'note-1', first],
      ['ws-1', 'note-1', second],
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('retires an idle queue and recreates the same authoritative key later', async () => {
    mocks.linkAgent.mockResolvedValue(undefined);
    const queueCounts: number[] = [];
    const run = harness({}, (count) => queueCounts.push(count));
    const first = {
      taskKey: 'same',
      noteId: 'note-1',
      createdAt: 1,
      taskText: 'Same',
      agentId: 'agent-1',
    };
    const second = { ...first, agentId: 'agent-2' };

    run.send(addTaskAgentAssociation('ws-1', 'note-1', first));
    await vi.waitFor(() => expect(queueCounts.at(-1)).toBe(0));
    run.send(addTaskAgentAssociation('ws-1', 'note-1', second));
    await vi.waitFor(() => expect(queueCounts).toEqual([1, 0, 1, 0]));

    expect(mocks.linkAgent.mock.calls).toEqual([
      ['ws-1', 'note-1', first],
      ['ws-1', 'note-1', second],
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('does not retain idle queues after many-key churn', async () => {
    mocks.linkAgent.mockResolvedValue(undefined);
    const queueCounts: number[] = [];
    const run = harness({}, (count) => queueCounts.push(count));

    for (let index = 0; index < 100; index += 1) {
      run.send(
        addTaskAgentAssociation('ws-1', `note-${index}`, {
          taskKey: `task-${index}`,
          noteId: 'note-1',
          createdAt: 1,
          taskText: `Task ${index}`,
          agentId: `agent-${index}`,
        }),
      );
    }

    await vi.waitFor(() => expect(queueCounts.at(-1)).toBe(0));
    expect(mocks.linkAgent).toHaveBeenCalledTimes(100);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('does not lose a same-key action dispatched at the retirement boundary', async () => {
    mocks.linkAgent.mockResolvedValue(undefined);
    const queueCounts: number[] = [];
    const first = {
      taskKey: 'same',
      noteId: 'note-1',
      createdAt: 1,
      taskText: 'Same',
      agentId: 'agent-1',
    };
    const second = { ...first, agentId: 'agent-2' };
    let sentRacingAction = false;
    const racing = { send: undefined as ReturnType<typeof harness>['send'] | undefined };
    const run = harness({}, (count) => {
      queueCounts.push(count);
      if (count === 0 && !sentRacingAction) {
        sentRacingAction = true;
        racing.send?.(addTaskAgentAssociation('ws-1', 'note-1', second));
      }
    });
    racing.send = run.send;

    run.send(addTaskAgentAssociation('ws-1', 'note-1', first));
    await vi.waitFor(() => expect(queueCounts).toEqual([1, 0, 1, 0]));

    expect(mocks.linkAgent.mock.calls).toEqual([
      ['ws-1', 'note-1', first],
      ['ws-1', 'note-1', second],
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('runs different composite task keys concurrently', async () => {
    const firstCall = deferred();
    mocks.linkAgent.mockImplementationOnce(() => firstCall.promise).mockResolvedValue(undefined);
    const run = harness();
    await settle();
    const first = {
      taskKey: 'same',
      noteId: 'note-1',
      createdAt: 1,
      taskText: 'Same',
      agentId: 'agent-1',
    };
    const second = { ...first, agentId: 'agent-2' };
    run.send(addTaskAgentAssociation('ws-1', 'note-1', first));
    await settle();
    run.send(addTaskAgentAssociation('ws-1', 'note-2', second));
    await settle();
    expect(mocks.linkAgent.mock.calls).toEqual([
      ['ws-1', 'note-1', first],
      ['ws-1', 'note-2', second],
    ]);
    firstCall.resolve();
    await settle();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('orders prune fan-out behind active work only for each affected key', async () => {
    const firstCall = deferred();
    mocks.linkAgent.mockImplementationOnce(() => firstCall.promise).mockResolvedValue(undefined);
    mocks.unlinkAgent.mockResolvedValue(undefined);
    const run = harness({
      'note-1': {
        first: {
          taskKey: 'first',
          noteId: 'note-1',
          createdAt: 1,
          taskText: 'First',
          agentId: 'agent-1',
        },
        second: {
          taskKey: 'second',
          noteId: 'note-1',
          createdAt: 1,
          taskText: 'Second',
          agentId: 'agent-2',
        },
      },
    });
    await settle();
    const relinked = {
      taskKey: 'first',
      noteId: 'note-1',
      createdAt: 1,
      taskText: 'First',
      agentId: 'agent-3',
    };
    run.send(addTaskAgentAssociation('ws-1', 'note-1', relinked));
    await settle();
    run.send(pruneTaskAgentAssociationsForNote('ws-1', 'note-1', []));
    await settle();
    expect(mocks.unlinkAgent.mock.calls).toEqual([['ws-1', 'note-1', 'second']]);
    firstCall.resolve();
    await settle();
    expect(mocks.unlinkAgent.mock.calls).toEqual([
      ['ws-1', 'note-1', 'second'],
      ['ws-1', 'note-1', 'first'],
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('continues same-key FIFO work after a failed mutation', async () => {
    mocks.linkAgent.mockRejectedValueOnce(new Error('first failed')).mockResolvedValue(undefined);
    const run = harness();
    await settle();
    const first = {
      taskKey: 'same',
      noteId: 'note-1',
      createdAt: 1,
      taskText: 'Same',
      agentId: 'agent-1',
    };
    const second = { ...first, agentId: 'agent-2' };
    run.send(addTaskAgentAssociation('ws-1', 'note-1', first));
    run.send(addTaskAgentAssociation('ws-1', 'note-1', second));
    await settle();
    expect(mocks.linkAgent.mock.calls).toEqual([
      ['ws-1', 'note-1', first],
      ['ws-1', 'note-1', second],
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('drops workspace queues and can rebuild authoritative snapshots afterward', async () => {
    const firstCall = deferred();
    mocks.linkAgent.mockImplementationOnce(() => firstCall.promise).mockResolvedValue(undefined);
    mocks.unlinkAgent.mockResolvedValue(undefined);
    const queueCounts: number[] = [];
    const run = harness({}, (count) => queueCounts.push(count));
    await settle();
    const first = {
      taskKey: 'same',
      noteId: 'note-1',
      createdAt: 1,
      taskText: 'Same',
      agentId: 'agent-1',
    };
    const second = { ...first, agentId: 'agent-2' };
    run.send(addTaskAgentAssociation('ws-1', 'note-1', first));
    run.send(addTaskAgentAssociation('ws-1', 'note-1', second));
    await settle();
    run.send(workspaceUnmounted('ws-1'));
    await settle();
    expect(queueCounts.at(-1)).toBe(0);
    firstCall.resolve();
    await settle();
    expect(mocks.linkAgent.mock.calls).toEqual([['ws-1', 'note-1', first]]);

    const restored = {
      taskKey: 'restored',
      noteId: 'note-1',
      createdAt: 1,
      taskText: 'Restored',
      agentId: 'agent-3',
    };
    run.send(hydrateTaskAgentAssociations('ws-1', { 'note-2': { restored } }));
    run.send(removeTaskAgentAssociation('ws-1', 'note-2', 'restored'));
    await settle();
    expect(mocks.unlinkAgent.mock.calls).toEqual([['ws-1', 'note-2', 'restored']]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('drops queued mutations when the root saga is cancelled', async () => {
    const firstCall = deferred();
    mocks.linkAgent.mockImplementationOnce(() => firstCall.promise).mockResolvedValue(undefined);
    const queueCounts: number[] = [];
    const run = harness({}, (count) => queueCounts.push(count));
    await settle();
    const first = {
      taskKey: 'same',
      noteId: 'note-1',
      createdAt: 1,
      taskText: 'Same',
      agentId: 'agent-1',
    };
    const second = { ...first, agentId: 'agent-2' };
    run.send(addTaskAgentAssociation('ws-1', 'note-1', first));
    run.send(addTaskAgentAssociation('ws-1', 'note-1', second));
    await settle();
    run.task.cancel();
    await run.task.toPromise();
    expect(queueCounts.at(-1)).toBe(0);
    firstCall.resolve();
    await settle();
    expect(mocks.linkAgent.mock.calls).toEqual([['ws-1', 'note-1', first]]);
  });
});

describe('task link recovery mutation barriers', () => {
  afterEach(() => vi.clearAllMocks());
  it('finishes no-op removal ingress so future reads proceed', async () => {
    const run = harness();
    const action = removeTaskAgentAssociation('ws-1', 'absent', 'absent');
    const lease = beginLifecycleMetadataMutation(action)!;
    const registry = new RendererEventRecovery();
    const read = vi.fn(async () => ({}));
    try {
      run.send(action);
      const pending = runLifecycleMetadataRead(
        taskAgentLinksRecoveryKey('ws-1'),
        registry.capture(taskAgentLinksRecoveryKey('ws-1')),
        read,
      );
      await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
      await pending;
      expect(mocks.unlinkAgent).not.toHaveBeenCalled();
    } finally {
      lease.finish();
      run.task.cancel();
      await run.task.toPromise();
      registry.dispose();
    }
  });
  it.each(['unmount', 'root'] as const)(
    'drains queued reservations on %s but waits for the physical write',
    async (stop) => {
      const held = deferred();
      mocks.linkAgent.mockReturnValue(held.promise);
      const run = harness();
      const first = addTaskAgentAssociation('ws-1', 'note', {
        taskKey: 'key',
        noteId: 'note-1',
        createdAt: 1,
        taskText: 'Task',
        agentId: 'one',
      });
      const second = addTaskAgentAssociation('ws-1', 'note', {
        taskKey: 'key',
        noteId: 'note-1',
        createdAt: 1,
        taskText: 'Task',
        agentId: 'two',
      });
      const leases = [
        beginLifecycleMetadataMutation(first)!,
        beginLifecycleMetadataMutation(second)!,
      ];
      const registry = new RendererEventRecovery();
      const read = vi.fn(async () => ({}));
      try {
        run.send(first);
        run.send(second);
        await settle();
        const pending = runLifecycleMetadataRead(
          taskAgentLinksRecoveryKey('ws-1'),
          registry.capture(taskAgentLinksRecoveryKey('ws-1')),
          read,
        );
        if (stop === 'root') run.task.cancel();
        else run.send(workspaceUnmounted('ws-1'));
        await settle();
        expect(read).not.toHaveBeenCalled();
        held.resolve();
        await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
        await pending;
        expect(mocks.linkAgent).toHaveBeenCalledTimes(1);
      } finally {
        held.resolve();
        leases.forEach((lease) => lease.finish());
        run.task.cancel();
        await run.task.toPromise();
        registry.dispose();
      }
    },
  );
});
