import { afterEach, describe, expect, it, vi } from 'vitest';
import { channel as createChannel, runSaga, stdChannel } from 'redux-saga';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  queue: vi.fn(),
  sendQueuedNow: vi.fn(),
  removeQueued: vi.fn(),
  stop: vi.fn(),
  rename: vi.fn(),
  toastInfo: vi.fn(),
}));
vi.mock('$features/agent/agent-send', () => ({ sendMessage: mocks.send }));
vi.mock('svelte-sonner', () => ({ toast: { info: mocks.toastInfo } }));
vi.mock('$lib/client', () => ({
  appClient: { agents: {
    queue: mocks.queue,
    sendQueuedNow: mocks.sendQueuedNow,
    removeQueued: mocks.removeQueued,
    stop: mocks.stop,
    rename: mocks.rename,
  } },
}));

import type { AgentSession, Workspace } from '$shared/types';
import { AgentStatus } from '$shared/types';
import {
  agentSessionReducer,
  agentSessionRetryLastMessageRequested,
  agentSessionRetryWithModelRequested,
  agentSessionStopChatRequested,
  bulkUpsertSessions,
  initialState as sessionInitialState,
} from '../../agent-session/agent-session-slice';
import {
  agentQueueReducer,
  initialState as queueInitialState,
  removeQueuedMessageRequested,
} from '../../agent-queue/agent-queue-slice';
import { initialState as workspaceInitialState } from '../../workspace/workspace-slice';
import {
  chatQueueProcessingReceived,
  chatQueuedRetryRecordSet,
  chatLastAttemptedMessageSet,
  initialState as chatInitialState,
  chatStateReducer,
  sendMessage,
} from '../chat-state-slice';
import { chatSendSaga } from './chat-send-saga';

const WS = 'ws-send';
const AGENT = 'agent-send';
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: AGENT,
    workspaceId: WS,
    backendSessionId: AGENT,
    name: 'Agent',
    status: AgentStatus.Idle,
    messages: [{
      id: 'seed', role: 'user', timestamp: '2026-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'seed' }],
    }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as AgentSession;
}

function harness(
  seedSession = session(),
  getStateError?: () => Error | undefined,
) {
  const channel = stdChannel();
  let agentSessions = agentSessionReducer(sessionInitialState, bulkUpsertSessions([seedSession]));
  let chatState = chatInitialState;
  let agentQueue = queueInitialState;
  const workspace = {
    ...workspaceInitialState,
    workspaces: createCollection('id', [{ id: WS, name: 'Workspace', path: '/repo' } as Workspace]),
  };
  const dispatch = vi.fn((action) => {
    agentSessions = agentSessionReducer(agentSessions, action);
    chatState = chatStateReducer(chatState, action);
    agentQueue = agentQueueReducer(agentQueue, action);
    return action;
  });
  const task = runSaga(
    {
      channel,
      dispatch,
      getState: () => {
        const error = getStateError?.();
        if (error) throw error;
        return { agentSessions, chatState, agentQueue, workspace };
      },
    },
    chatSendSaga,
  );
  return {
    channel,
    dispatch,
    task,
    setChat: (action: ReturnType<typeof chatLastAttemptedMessageSet>) => {
      chatState = chatStateReducer(chatState, action);
    },
  };
}

describe('chatSendSaga', () => {
  afterEach(() => vi.clearAllMocks());

  it('sends exact lifecycle options, uses interrupt priority, and serializes work per agent', async () => {
    let resolveFirst!: () => void;
    mocks.send
      .mockReturnValueOnce(new Promise<void>((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValue(undefined);
    const run = harness();
    run.channel.put(sendMessage(AGENT, {
      wsId: WS, text: ' first ', forceSubmit: true,
      imageBlocks: [{ type: 'image', data: 'abc', mimeType: 'image/png' }], noteIds: ['note-1'],
    }));
    run.channel.put(sendMessage(AGENT, { wsId: WS, text: 'second', forceSubmit: true }));
    await settle();

    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledWith(AGENT, 'first', expect.objectContaining({ id: WS }), {
      imageBlocks: [{ type: 'image', data: 'abc', mimeType: 'image/png' }],
      noteIds: ['note-1'],
      priority: 'interrupt',
    });
    resolveFirst();
    await settle();
    expect(mocks.send).toHaveBeenNthCalledWith(
      2, AGENT, 'second', expect.objectContaining({ id: WS }),
      { imageBlocks: undefined, noteIds: undefined, priority: 'interrupt' },
    );
    run.task.cancel();
    await run.task.toPromise();
  });

  it('keeps send-now atomic and queue removal optimistic when transport fails', async () => {
    mocks.sendQueuedNow.mockResolvedValue({ success: true, turnId: 'turn-1' });
    mocks.removeQueued.mockRejectedValue(new Error('offline'));
    const run = harness();
    run.channel.put(sendMessage(AGENT, { wsId: WS, text: 'ignored', queuedMessageId: 'queued-1' }));
    run.channel.put(removeQueuedMessageRequested(AGENT, 'queued-2'));
    await settle();

    expect(mocks.sendQueuedNow).toHaveBeenCalledWith({
      agentId: AGENT, workspaceId: WS, messageId: 'queued-1',
    });
    expect(run.dispatch).toHaveBeenCalledWith(chatQueueProcessingReceived(AGENT, 'turn-1'));
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.removeQueued).toHaveBeenCalledWith(AGENT, 'queued-2');
    expect(run.dispatch.mock.calls.some(([action]) => action.type === 'agentQueue/removeQueuedMessage')).toBe(true);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('queues a normal send for a busy agent with the exact daemon payload', async () => {
    mocks.queue.mockResolvedValue({
      success: true,
      turnId: 'turn-queued',
      queuedMessage: { id: 'queued-1', content: 'later', timestamp: 1 },
    });
    const run = harness(session({
      status: AgentStatus.Active,
      isStreaming: true,
      isProcessing: true,
    }));
    run.channel.put(sendMessage(AGENT, {
      wsId: WS,
      text: 'later',
      imageBlocks: [{ type: 'image', data: 'abc', mimeType: 'image/png' }],
    }));
    await settle();

    expect(mocks.queue).toHaveBeenCalledWith(AGENT, 'later', {
      imageBlocks: [{ type: 'image', data: 'abc', mimeType: 'image/png' }],
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(run.dispatch).toHaveBeenCalledWith(chatQueuedRetryRecordSet(
      AGENT,
      'queued-1',
      {
        text: 'later',
        options: { imageBlocks: [{ type: 'image', data: 'abc', mimeType: 'image/png' }] },
      },
      'turn-queued',
    ));
    run.task.cancel();
    await run.task.toPromise();
  });

  it('retries with the requested model and handles exact stop results and payloads', async () => {
    mocks.send.mockResolvedValue(undefined);
    mocks.stop.mockResolvedValueOnce({ success: false, error: 'already stopped' })
      .mockRejectedValueOnce(new Error('stop failed'));
    const run = harness();
    run.setChat(chatLastAttemptedMessageSet(AGENT, { text: 'retry me', options: {} }));
    const retry = agentSessionRetryWithModelRequested(AGENT, WS, 'provider:new-model');
    run.channel.put(retry);
    await expect(retry.promise).resolves.toBeUndefined();
    expect(mocks.send).toHaveBeenCalledWith(
      AGENT, 'retry me', expect.objectContaining({ id: WS }), expect.objectContaining({ model: 'provider:new-model' }),
    );

    const successfulStop = agentSessionStopChatRequested(AGENT);
    run.channel.put(successfulStop);
    await expect(successfulStop.promise).resolves.toBeUndefined();
    expect(mocks.stop).toHaveBeenNthCalledWith(1, AGENT);
    const failedStop = agentSessionStopChatRequested(AGENT);
    run.channel.put(failedStop);
    await expect(failedStop.promise).rejects.toThrow('stop failed');
    expect(mocks.stop).toHaveBeenNthCalledWith(2, AGENT);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('rejects a retry on an unexpected throw and when active work is cancelled', async () => {
    const stateError = new Error('state unavailable');
    const thrownRun = harness(session(), () => stateError);
    thrownRun.setChat(chatLastAttemptedMessageSet(AGENT, { text: 'retry me', options: {} }));
    const thrownRetry = agentSessionRetryLastMessageRequested(AGENT, WS);
    thrownRun.channel.put(thrownRetry);
    await expect(thrownRetry.promise).rejects.toThrow('state unavailable');
    thrownRun.task.cancel();
    await thrownRun.task.toPromise();

    mocks.send.mockReset().mockReturnValue(new Promise(() => {}));
    const cancelledRun = harness();
    cancelledRun.setChat(chatLastAttemptedMessageSet(AGENT, { text: 'retry me', options: {} }));
    const cancelledRetry = agentSessionRetryLastMessageRequested(AGENT, WS);
    const cancellation = cancelledRetry.promise.catch((error) => error);
    cancelledRun.channel.put(cancelledRetry);
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    cancelledRun.task.cancel();
    await cancelledRun.task.toPromise();
    await expect(cancellation).resolves.toEqual(
      expect.objectContaining({ message: expect.stringContaining('cancelled') }),
    );
  });

  it('settles active and same-agent queued promise actions once on cancellation', async () => {
    mocks.stop.mockReturnValue(new Promise(() => {}));
    const run = harness();
    run.setChat(chatLastAttemptedMessageSet(AGENT, { text: 'retry after stop', options: {} }));
    const activeStop = agentSessionStopChatRequested(AGENT);
    const queuedRetry = agentSessionRetryLastMessageRequested(AGENT, WS);
    const stopSettlement = activeStop.promise.catch((error) => error);
    const retrySettlement = queuedRetry.promise.catch((error) => error);

    run.channel.put(activeStop);
    await vi.waitFor(() => expect(mocks.stop).toHaveBeenCalledWith(AGENT));
    run.channel.put(queuedRetry);
    await settle();
    run.task.cancel();
    await run.task.toPromise();

    await expect(stopSettlement).resolves.toEqual(
      expect.objectContaining({ message: expect.stringContaining('cancelled') }),
    );
    await expect(retrySettlement).resolves.toEqual(
      expect.objectContaining({ message: expect.stringContaining('cancelled') }),
    );
    expect(run.dispatch.mock.calls.filter(([action]) => action.type === activeStop.failure.type)).toHaveLength(1);
    expect(run.dispatch.mock.calls.filter(([action]) => action.type === queuedRetry.failure.type)).toHaveLength(1);
  });

  it('flushes and settles promise actions still buffered at root teardown', async () => {
    const bufferedStop = agentSessionStopChatRequested(AGENT);
    const bufferedRetry = agentSessionRetryLastMessageRequested(AGENT, WS);
    const stopSettlement = bufferedStop.promise.catch((error) => error);
    const retrySettlement = bufferedRetry.promise.catch((error) => error);
    const generator = chatSendSaga();
    generator.next();
    const bufferedChannel = createChannel();
    generator.next(bufferedChannel as never);
    bufferedChannel.put(bufferedStop);
    bufferedChannel.put(bufferedRetry);

    const cleanup = generator.return(undefined);
    expect(cleanup.value).toMatchObject({
      type: 'FLUSH',
      payload: bufferedChannel,
    });
    let buffered: unknown[] = [];
    bufferedChannel.flush((items) => { buffered = items; });
    const firstFailure = generator.next(buffered as never);
    expect(firstFailure.value).toMatchObject({ type: 'PUT' });
    const secondFailure = generator.next();
    expect(secondFailure.value).toMatchObject({ type: 'PUT' });
    expect(generator.next().done).toBe(true);

    await expect(stopSettlement).resolves.toEqual(
      expect.objectContaining({ message: expect.stringContaining('cancelled') }),
    );
    await expect(retrySettlement).resolves.toEqual(
      expect.objectContaining({ message: expect.stringContaining('cancelled') }),
    );
    expect(firstFailure.value).toMatchObject({
      payload: { action: { type: bufferedStop.failure.type } },
    });
    expect(secondFailure.value).toMatchObject({
      payload: { action: { type: bufferedRetry.failure.type } },
    });
  });

  it('awaits and isolates no-retry toast failures before resolving', async () => {
    mocks.toastInfo.mockImplementationOnce(() => { throw new Error('toast unavailable'); });
    const run = harness();
    const retry = agentSessionRetryLastMessageRequested(AGENT, WS);
    run.channel.put(retry);

    await expect(retry.promise).resolves.toBeUndefined();
    expect(mocks.toastInfo).toHaveBeenCalledTimes(1);
    run.task.cancel();
    await run.task.toPromise();
  });
});