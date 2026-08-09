import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  rename: vi.fn(),
  deleteAgent: vi.fn(),
  dismissQuestions: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: {
    agents: {
      get: mocks.get,
      rename: mocks.rename,
      delete: mocks.deleteAgent,
      dismissQuestions: mocks.dismissQuestions,
    },
  },
}));
vi.mock('svelte-sonner', () => ({
  toast: { warning: mocks.warning, error: mocks.error },
}));

import {
  clearPendingAgentDeletions,
  listPendingAgentDeletions,
} from '$features/agent/utils/pending-agent-deletions';
import type { AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import {
  refreshWorkspaceSubscriptionEntriesRequested,
  removeWatchedAgent,
} from '../../agent-subscription-ui/agent-subscription-ui-slice';
import {
  activateAgentRequested,
  commitPendingAgentDeletionRequested,
  deleteAgentWithUndoRequested,
  deleteAgentSessionRequested,
  flushPendingAgentDeletionsRequested,
  renameAgentSessionRequested,
  restoreAgentSessionRequested,
  undoAgentDeletionRequested,
} from '../../workspace-agents/workspace-agents-slice';
import { agentSessionDismissQuestionsRequested, bulkUpsertSessions } from '../agent-session-slice';
import { agentMutationSaga } from './agent-mutation-saga';

const WS = 'ws-mutation';
const A1 = 'agent-1';
const A2 = 'agent-2';
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function session(id = A1, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id,
    backendSessionId: `backend-${id}`,
    workspaceId: WS,
    name: id,
    status: AgentStatus.Active,
    messages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as AgentSession;
}

function start(sessions: Record<string, AgentSession> = { [A1]: session() }) {
  const channel = stdChannel();
  const dispatched: any[] = [];
  const task = runSaga(
    {
      channel,
      getState: () => ({ agentSessions: { byAgentId: sessions } }),
      dispatch: (action) => {
        dispatched.push(action);
        channel.put(action);
        return action;
      },
    },
    agentMutationSaga,
  );
  return { channel, dispatched, task };
}

async function stop(task: Task): Promise<void> {
  task.cancel();
  await task.toPromise();
}

describe('agentMutationSaga', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.deleteAgent.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    clearPendingAgentDeletions();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('restores through agents.get, preserves hydrated messages, and settles success', async () => {
    const messages = [{ id: 'm1', role: 'user', contentBlocks: [], timestamp: '2026-01-01' }];
    const existing = session(A1, { backendSessionId: null, messages } as Partial<AgentSession>);
    mocks.get.mockResolvedValue(session(A1, { messages: [] }));
    const { channel, dispatched, task } = start({ [A1]: existing });
    const action = restoreAgentSessionRequested(WS, A1);
    channel.put(action);

    await expect(action.promise).resolves.toEqual(expect.objectContaining({ id: A1, messages }));
    expect(mocks.get).toHaveBeenCalledWith(A1);
    const upsert = dispatched.find((candidate) => candidate.type === bulkUpsertSessions.type);
    expect(upsert.payload[0][0]).toEqual(expect.objectContaining({ id: A1, messages }));
    await stop(task);
  });

  it('marks activation failure and rejects the action promise', async () => {
    const existing = session(A1, { backendSessionId: null, status: AgentStatus.Pending });
    mocks.get.mockRejectedValue(new Error('activation failed'));
    const { channel, dispatched, task } = start({ [A1]: existing });
    const action = activateAgentRequested(WS, A1);
    channel.put(action);

    await expect(action.promise).rejects.toThrow('activation failed');
    expect(dispatched).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: bulkUpsertSessions.type,
          payload: [
            [
              expect.objectContaining({
                activationState: 'error',
                lastActivationError: 'activation failed',
              }),
            ],
          ],
        }),
      ]),
    );
    await stop(task);
  });

  it('forwards exact rename parameters and settles daemon failure', async () => {
    mocks.rename.mockResolvedValue({ success: false, error: 'rename rejected' });
    const { channel, task } = start();
    const action = renameAgentSessionRequested(WS, A1, 'New Name');
    channel.put(action);

    await expect(action.promise).rejects.toThrow('rename rejected');
    expect(mocks.rename).toHaveBeenCalledWith(A1, 'New Name', WS);
    await stop(task);
  });

  it('restores an immediately deleted session once and rejects on daemon failure', async () => {
    mocks.deleteAgent.mockResolvedValue({ success: false, error: 'delete rejected' });
    const { channel, dispatched, task } = start();
    const action = deleteAgentSessionRequested(WS, A1);
    channel.put(action);

    await expect(action.promise).rejects.toThrow('delete rejected');
    expect(mocks.deleteAgent).toHaveBeenCalledWith(A1, WS);
    expect(dispatched.filter((candidate) => candidate.type === bulkUpsertSessions.type)).toEqual([
      bulkUpsertSessions([session()]),
    ]);
    await stop(task);
  });

  it('surfaces a daemon dismiss-questions failure as an error toast and rejects', async () => {
    mocks.dismissQuestions.mockResolvedValue({ success: false, error: 'dismiss rejected' });
    const { channel, task } = start();
    const action = agentSessionDismissQuestionsRequested(A1, WS, 'msg-q1');
    channel.put(action);

    await expect(action.promise).rejects.toThrow('dismiss rejected');
    expect(mocks.dismissQuestions).toHaveBeenCalledWith({
      agentId: A1,
      workspaceId: WS,
      messageId: 'msg-q1',
    });
    expect(mocks.error).toHaveBeenCalledWith('dismiss rejected');
    await stop(task);
  });

  it('surfaces a dismiss-questions RPC error as an error toast and rejects', async () => {
    mocks.dismissQuestions.mockRejectedValue(new Error('socket closed'));
    const { channel, task } = start();
    const action = agentSessionDismissQuestionsRequested(A1, WS, 'msg-q1');
    channel.put(action);

    await expect(action.promise).rejects.toThrow('socket closed');
    expect(mocks.error).toHaveBeenCalledWith('socket closed');
    await stop(task);
  });

  it('shows no error toast when dismiss-questions succeeds', async () => {
    mocks.dismissQuestions.mockResolvedValue({ success: true });
    const { channel, task } = start();
    const action = agentSessionDismissQuestionsRequested(A1, WS, 'msg-q1');
    channel.put(action);

    await expect(action.promise).resolves.toBeUndefined();
    expect(mocks.error).not.toHaveBeenCalled();
    await stop(task);
  });

  it('soft-hides without a wire call and undo wins the timer race', async () => {
    const { channel, dispatched, task } = start();
    const deletion = deleteAgentWithUndoRequested(WS, A1, 'Agent');
    channel.put(deletion);
    await expect(deletion.promise).resolves.toEqual(session());
    expect(mocks.deleteAgent).not.toHaveBeenCalled();
    expect(dispatched).toContainEqual(removeWatchedAgent(WS, A1));

    const undo = undoAgentDeletionRequested(WS, A1);
    channel.put(undo);
    await expect(undo.promise).resolves.toBe(true);
    expect(dispatched).toContainEqual(refreshWorkspaceSubscriptionEntriesRequested(WS));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mocks.deleteAgent).not.toHaveBeenCalled();
    await stop(task);
  });

  it('refetches subscription entries when a pending delete commit restores on daemon failure', async () => {
    mocks.deleteAgent.mockResolvedValue({ success: false, error: 'delete rejected' });
    const { channel, dispatched, task } = start();
    const deletion = deleteAgentWithUndoRequested(WS, A1);
    channel.put(deletion);
    await deletion.promise;
    channel.put(commitPendingAgentDeletionRequested(WS, A1));
    await settle();

    expect(mocks.deleteAgent).toHaveBeenCalledWith(A1, WS);
    expect(dispatched).toContainEqual(refreshWorkspaceSubscriptionEntriesRequested(WS));
    await stop(task);
  });

  it('refetches subscription entries when immediate delete restores on daemon failure', async () => {
    mocks.deleteAgent.mockResolvedValue({ success: false, error: 'delete rejected' });
    const { channel, dispatched, task } = start();
    const action = deleteAgentSessionRequested(WS, A1);
    channel.put(action);

    await expect(action.promise).rejects.toThrow('delete rejected');
    expect(dispatched).toContainEqual(removeWatchedAgent(WS, A1));
    expect(dispatched).toContainEqual(refreshWorkspaceSubscriptionEntriesRequested(WS));
    await stop(task);
  });

  it('commits once when explicit commit beats the undo timer', async () => {
    const { channel, task } = start();
    const deletion = deleteAgentWithUndoRequested(WS, A1);
    channel.put(deletion);
    await deletion.promise;
    channel.put(commitPendingAgentDeletionRequested(WS, A1));
    await settle();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(mocks.deleteAgent).toHaveBeenCalledTimes(1);
    expect(mocks.deleteAgent).toHaveBeenCalledWith(A1, WS);
    await stop(task);
  });

  it('flushes every pending deletion in one workspace and settles', async () => {
    const { channel, task } = start({ [A1]: session(A1), [A2]: session(A2) });
    const first = deleteAgentWithUndoRequested(WS, A1);
    const second = deleteAgentWithUndoRequested(WS, A2);
    channel.put(first);
    channel.put(second);
    await Promise.all([first.promise, second.promise]);
    const flush = flushPendingAgentDeletionsRequested(WS);
    channel.put(flush);

    await expect(flush.promise).resolves.toBeUndefined();
    expect(mocks.deleteAgent.mock.calls).toEqual(
      expect.arrayContaining([
        [A1, WS],
        [A2, WS],
      ]),
    );
    expect(listPendingAgentDeletions()).toEqual([]);
    await stop(task);
  });

  it('flushes the soft-hidden deletion when the saga is cancelled', async () => {
    const { channel, task } = start();
    const deletion = deleteAgentWithUndoRequested(WS, A1);
    channel.put(deletion);
    await deletion.promise;
    task.cancel();
    await task.toPromise();

    expect(mocks.deleteAgent).toHaveBeenCalledWith(A1, WS);
    expect(listPendingAgentDeletions()).toEqual([]);
  });
});
