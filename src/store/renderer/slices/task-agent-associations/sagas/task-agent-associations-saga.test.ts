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
import { taskAgentAssociationsSaga } from './task-agent-associations-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
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

  it('cancels an in-flight task-key queue without starting buffered wire work', async () => {
    let resolveFirst!: () => void;
    mocks.linkAgent.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveFirst = resolve;
      }),
    );
    const run = harness();
    await settle();
    const first = { taskKey: 'same', taskText: 'Same', agentId: 'agent-1' };
    const second = { ...first, agentId: 'agent-2' };
    run.send(addTaskAgentAssociation('ws-1', 'note-1', first));
    await settle();
    run.send(addTaskAgentAssociation('ws-1', 'note-1', second));
    await settle();
    expect(mocks.linkAgent).toHaveBeenCalledTimes(1);
    run.task.cancel();
    await run.task.toPromise();
    resolveFirst();
    await settle();
    expect(mocks.linkAgent).toHaveBeenCalledTimes(1);
  });
});
