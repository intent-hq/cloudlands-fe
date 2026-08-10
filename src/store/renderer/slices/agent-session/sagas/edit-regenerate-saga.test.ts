import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  editAndRegenerate: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: { agents: { editAndRegenerate: mocks.editAndRegenerate } },
}));
vi.mock('svelte-sonner', () => ({ toast: { error: mocks.toastError } }));

import type { AgentMessage, AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import {
  chatLastAttemptedMessageSet,
  chatQueuedRetryRecordsCleared,
  chatSendStarted,
} from '../../chat-state/chat-state-slice';
import { agentSessionEditAndRegenerateRequested, replaceMessages } from '../agent-session-slice';
import { editRegenerateSaga } from './edit-regenerate-saga';

const WS = 'ws-edit-saga';
const AGENT = 'agent-edit';
const OTHER_AGENT = 'agent-edit-other';
const messages: AgentMessage[] = [
  { id: 'm1', role: 'user', contentBlocks: [], timestamp: '2026-01-01' } as AgentMessage,
  { id: 'm2', role: 'assistant', contentBlocks: [], timestamp: '2026-01-02' } as AgentMessage,
  { id: 'm3', role: 'user', contentBlocks: [], timestamp: '2026-01-03' } as AgentMessage,
];

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function start() {
  const channel = stdChannel();
  const dispatched: any[] = [];
  const agent: AgentSession = {
    id: AGENT,
    workspaceId: WS,
    backendSessionId: `backend-${AGENT}`,
    name: 'Agent',
    status: AgentStatus.Active,
    messages,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  } as AgentSession;
  const task = runSaga(
    {
      channel,
      getState: () => ({ agentSessions: { byAgentId: { [AGENT]: agent } } }),
      dispatch: (action) => {
        dispatched.push(action);
        channel.put(action);
        return action;
      },
    },
    editRegenerateSaga,
  );
  return { channel, dispatched, task };
}

describe('editRegenerateSaga', () => {
  afterEach(() => vi.clearAllMocks());

  it('sends exact protocol params and applies success effects in order', async () => {
    mocks.editAndRegenerate.mockResolvedValue({ success: true });
    const { channel, dispatched, task } = start();
    const action = agentSessionEditAndRegenerateRequested(AGENT, WS, 'm3', 'edited', {
      model: 'opus',
    });
    channel.put(action);
    await expect(action.promise).resolves.toBeUndefined();

    expect(mocks.editAndRegenerate).toHaveBeenCalledWith({
      agentId: AGENT,
      workspaceId: WS,
      messageId: 'm3',
      content: 'edited',
      model: 'opus',
    });
    expect(dispatched.map((item) => item.type)).toEqual([
      replaceMessages.type,
      chatQueuedRetryRecordsCleared.type,
      chatSendStarted.type,
      chatLastAttemptedMessageSet.type,
      action.success(undefined as never).type,
    ]);
    expect(dispatched[0]).toEqual(replaceMessages(AGENT, messages.slice(0, 2)));
    task.cancel();
    await task.toPromise();
  });

  it('rejects and leaves transcript/chat actions untouched on daemon failure', async () => {
    mocks.editAndRegenerate.mockResolvedValue({ success: false, error: 'bad message' });
    const { channel, dispatched, task } = start();
    const action = agentSessionEditAndRegenerateRequested(AGENT, WS, 'm1', 'edited');
    channel.put(action);

    await expect(action.promise).rejects.toThrow('bad message');
    expect(mocks.toastError).toHaveBeenCalledWith('bad message');
    expect(dispatched).toEqual([
      expect.objectContaining({ type: action.failure(new Error()).type }),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('runs repeated edits for the same agent independently', async () => {
    let releaseFirst!: (value: { success: true }) => void;
    mocks.editAndRegenerate
      .mockReturnValueOnce(new Promise((resolve) => (releaseFirst = resolve)))
      .mockResolvedValueOnce({ success: true });
    const { channel, task } = start();
    const first = agentSessionEditAndRegenerateRequested(AGENT, WS, 'm1', 'first');
    const second = agentSessionEditAndRegenerateRequested(AGENT, WS, 'm2', 'second');
    channel.put(first);
    channel.put(second);
    await settle();
    expect(mocks.editAndRegenerate).toHaveBeenCalledTimes(2);
    await expect(second.promise).resolves.toBeUndefined();

    releaseFirst({ success: true });
    await expect(first.promise).resolves.toBeUndefined();
    task.cancel();
    await task.toPromise();
  });

  it('runs edits for different agents concurrently', async () => {
    let releaseFirst!: (value: { success: true }) => void;
    mocks.editAndRegenerate
      .mockReturnValueOnce(new Promise((resolve) => (releaseFirst = resolve)))
      .mockResolvedValueOnce({ success: true });
    const { channel, task } = start();
    const first = agentSessionEditAndRegenerateRequested(AGENT, WS, 'm1', 'first');
    const second = agentSessionEditAndRegenerateRequested(OTHER_AGENT, WS, 'm2', 'second');
    channel.put(first);
    channel.put(second);
    await settle();

    expect(mocks.editAndRegenerate).toHaveBeenCalledTimes(2);
    await expect(second.promise).resolves.toBeUndefined();
    releaseFirst({ success: true });
    await expect(first.promise).resolves.toBeUndefined();
    task.cancel();
    await task.toPromise();
  });

  it('rejects all active edits on cancellation', async () => {
    mocks.editAndRegenerate.mockReturnValue(new Promise(() => {}));
    const { channel, task } = start();
    const first = agentSessionEditAndRegenerateRequested(AGENT, WS, 'm1', 'first');
    const second = agentSessionEditAndRegenerateRequested(AGENT, WS, 'm2', 'second');
    channel.put(first);
    channel.put(second);
    await settle();
    task.cancel();

    await expect(first.promise).rejects.toThrow('Failed to edit message');
    await expect(second.promise).rejects.toThrow('Failed to edit message');
    await task.toPromise();
  });
});
