import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ linkAgent: vi.fn(), unlinkAgent: vi.fn() }));
vi.mock('$lib/client', () => ({ appClient: { tasks: mocks } }));

import {
  addTaskAgentAssociation,
  applyTaskAgentLinked,
  applyTaskAgentUnlinked,
  hydrateTaskAgentAssociations,
  initialTaskAgentAssociationsState,
  pruneTaskAgentAssociationsForNote,
  removeTaskAgentAssociation,
  taskAgentAssociationsReducer,
} from '../task-agent-associations-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { taskAgentAssociationsSaga } from './task-agent-associations-saga';

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

function harness(byNoteId: Parameters<typeof hydrateTaskAgentAssociations>[1] = {}) {
  let associations = taskAgentAssociationsReducer(
    initialTaskAgentAssociationsState,
    hydrateTaskAgentAssociations('ws-1', byNoteId),
  );
  const channel = stdChannel();
  const task = runSaga(
    { channel, dispatch: vi.fn(), getState: () => ({ taskAgentAssociations: associations }) },
    taskAgentAssociationsSaga,
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
          first: { taskKey: 'first', taskText: 'First', agentId: 'agent-1' },
          second: { taskKey: 'second', taskText: 'Second', agentId: 'agent-2' },
        },
      }),
    );
    const channel = stdChannel();
    const task = runSaga(
      { channel, dispatch: vi.fn(), getState: () => ({ taskAgentAssociations: associations }) },
      taskAgentAssociationsSaga,
    );
    await settle();

    const added = { taskKey: 'third', taskText: 'Third', agentId: 'agent-3' };
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
        'key-alpha': { taskKey: 'key-alpha', taskText: 'Alpha', agentId: 'agent-1' },
        'key-beta': { taskKey: 'key-beta', taskText: 'Beta', agentId: 'agent-2' },
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
        taskText: 'Linked',
        agentId: 'agent-1',
      }),
    );
    run.send(applyTaskAgentUnlinked('ws-1', 'note-1', 'linked'));
    run.send(
      hydrateTaskAgentAssociations('ws-1', {
        'note-2': {
          hydrated: { taskKey: 'hydrated', taskText: 'Hydrated', agentId: 'agent-2' },
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
        stale: { taskKey: 'stale', taskText: 'Stale', agentId: 'agent-old' },
      },
    });
    await settle();
    run.send(
      hydrateTaskAgentAssociations('ws-1', {
        'note-new': {
          fresh: { taskKey: 'fresh', taskText: 'Fresh', agentId: 'agent-new' },
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
    const first = { taskKey: 'same', taskText: 'Same', agentId: 'agent-1' };
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

  it('runs different composite task keys concurrently', async () => {
    const firstCall = deferred();
    mocks.linkAgent.mockImplementationOnce(() => firstCall.promise).mockResolvedValue(undefined);
    const run = harness();
    await settle();
    const first = { taskKey: 'same', taskText: 'Same', agentId: 'agent-1' };
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
        first: { taskKey: 'first', taskText: 'First', agentId: 'agent-1' },
        second: { taskKey: 'second', taskText: 'Second', agentId: 'agent-2' },
      },
    });
    await settle();
    const relinked = { taskKey: 'first', taskText: 'First', agentId: 'agent-3' };
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
    const first = { taskKey: 'same', taskText: 'Same', agentId: 'agent-1' };
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
    const run = harness();
    await settle();
    const first = { taskKey: 'same', taskText: 'Same', agentId: 'agent-1' };
    const second = { ...first, agentId: 'agent-2' };
    run.send(addTaskAgentAssociation('ws-1', 'note-1', first));
    run.send(addTaskAgentAssociation('ws-1', 'note-1', second));
    await settle();
    run.send(workspaceUnmounted('ws-1'));
    await settle();
    firstCall.resolve();
    await settle();
    expect(mocks.linkAgent.mock.calls).toEqual([['ws-1', 'note-1', first]]);

    const restored = { taskKey: 'restored', taskText: 'Restored', agentId: 'agent-3' };
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
    const run = harness();
    await settle();
    const first = { taskKey: 'same', taskText: 'Same', agentId: 'agent-1' };
    const second = { ...first, agentId: 'agent-2' };
    run.send(addTaskAgentAssociation('ws-1', 'note-1', first));
    run.send(addTaskAgentAssociation('ws-1', 'note-1', second));
    await settle();
    run.task.cancel();
    await run.task.toPromise();
    firstCall.resolve();
    await settle();
    expect(mocks.linkAgent.mock.calls).toEqual([['ws-1', 'note-1', first]]);
  });
});
