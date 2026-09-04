import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  queue: vi.fn(),
  hydrateQueue: vi.fn(async () => undefined),
  sendQueuedNow: vi.fn(),
  removeQueued: vi.fn(),
  stop: vi.fn(),
  rename: vi.fn(),
  toastInfo: vi.fn(),
  // Image pre-upload (monorepo#3338): default maps each inline block to a
  // deterministic reference block; individual tests override to assert the
  // failure path.
  toImageReferenceBlocks: vi.fn(
    async (_wsId: string, blocks: Array<{ attachmentId?: string; mimeType?: string }>) =>
      blocks.map((block, i) => ({
        type: 'image' as const,
        attachmentId: block.attachmentId ?? `attach-${i}`,
        ...(block.mimeType ? { mimeType: block.mimeType } : {}),
      })),
  ),
}));
vi.mock('$features/agent/agent-send', () => ({ sendMessage: mocks.send }));
vi.mock('svelte-sonner', () => ({ toast: { info: mocks.toastInfo } }));
vi.mock('$lib/components/chat/input/image-attachment-placement', () => ({
  toImageReferenceBlocks: mocks.toImageReferenceBlocks,
}));
vi.mock('$lib/client', () => ({
  appClient: {
    agents: {
      queue: mocks.queue,
      sendQueuedNow: mocks.sendQueuedNow,
      removeQueued: mocks.removeQueued,
      stop: mocks.stop,
      rename: mocks.rename,
    },
  },
}));
// Partial mock: the real seq counter drives the guard, but the reconciling
// hydrate is stubbed — the service dispatches to the configured appStore,
// which is not initialized under this runSaga harness. Its behavior is
// covered in agent-queue-read-service.test.ts / agent-send.test.ts.
vi.mock('$features/agent/agent-queue-read-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$features/agent/agent-queue-read-service')>()),
  hydrateAgentQueue: mocks.hydrateQueue,
}));

import type { AgentSession, QueuedMessage, Workspace } from '$shared/types';
import { AgentStatus, WorkspaceStatusEnum } from '$shared/types';
import {
  agentSessionReducer,
  agentSessionRetryFromStalledRequested,
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
  replaceAgentQueue,
} from '../../agent-queue/agent-queue-slice';
import {
  __resetAgentQueueReadServiceForTests,
  noteAgentQueueEventSnapshotApplied,
} from '$features/agent/agent-queue-read-service';
import { initialState as workspaceInitialState } from '../../workspace/workspace-slice';
import {
  chatQueueProcessingReceived,
  chatQueuedRetryRecordSet,
  chatLastAttemptedMessageSet,
  chatSendFailed,
  initialState as chatInitialState,
  chatStateReducer,
  refreshChatTranscriptRequested,
  sendMessage,
  streamActivityReceived,
  streamStatusReceived,
  transcriptHydrationSettled,
} from '../chat-state-slice';
import { chatSendSaga } from './chat-send-saga';

const WS = 'ws-send';
const AGENT = 'agent-send';
const OTHER_AGENT = 'agent-other';
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
    messages: [
      {
        id: 'seed',
        role: 'user',
        timestamp: '2026-01-01T00:00:00.000Z',
        contentBlocks: [{ type: 'text', text: 'seed' }],
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as AgentSession;
}

function harness(
  seedSession: AgentSession | AgentSession[] = session(),
  getStateError?: () => Error | undefined,
  workspaceRecord?: Workspace | null,
) {
  const channel = stdChannel();
  const seedSessions = Array.isArray(seedSession) ? seedSession : [seedSession];
  let agentSessions = agentSessionReducer(sessionInitialState, bulkUpsertSessions(seedSessions));
  let chatState = chatInitialState;
  let agentQueue = queueInitialState;
  const workspaceEntities =
    workspaceRecord === null
      ? []
      : [workspaceRecord ?? ({ id: WS, name: 'Workspace', path: '/repo' } as Workspace)];
  const workspace = {
    ...workspaceInitialState,
    workspaces: createCollection('id', workspaceEntities),
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
    setChat: (
      action:
        ReturnType<typeof chatLastAttemptedMessageSet> | ReturnType<typeof streamStatusReceived>,
    ) => {
      chatState = chatStateReducer(chatState, action);
    },
    settleTranscript: (agentId = AGENT) => {
      chatState = chatStateReducer(chatState, transcriptHydrationSettled(agentId));
    },
  };
}

describe('chatSendSaga', () => {
  afterEach(() => {
    vi.clearAllMocks();
    __resetAgentQueueReadServiceForTests();
  });

  it.each([
    { mode: 'text-only', text: 'hello', fileBlocks: undefined },
    {
      mode: 'attachment-only',
      text: '',
      fileBlocks: [
        {
          type: 'file' as const,
          attachmentId: 'att-uuid-1',
          fileName: 'dump.har',
          mimeType: 'application/json',
          size: 42,
        },
      ],
    },
    {
      mode: 'mixed',
      text: 'inspect this',
      fileBlocks: [
        {
          type: 'file' as const,
          attachmentId: 'att-uuid-1',
          fileName: 'dump.har',
          mimeType: 'application/json',
          size: 42,
        },
      ],
    },
  ])('accepts a $mode message', async ({ text, fileBlocks }) => {
    mocks.send.mockResolvedValue(undefined);
    const run = harness();
    run.channel.put(sendMessage(AGENT, { wsId: WS, text, fileBlocks }));
    await settle();

    expect(mocks.send).toHaveBeenCalledWith(
      AGENT,
      text,
      expect.objectContaining({ id: WS }),
      expect.objectContaining({ fileBlocks }),
    );
    run.task.cancel();
    await run.task.toPromise();
  });

  it('sends exact lifecycle options while processing same-agent work FIFO', async () => {
    let resolveFirst!: () => void;
    mocks.send
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValue(undefined);
    const run = harness();
    run.channel.put(
      sendMessage(AGENT, {
        wsId: WS,
        text: ' first ',
        userAppMessageId: 'app-message-first',
        forceSubmit: true,
        imageBlocks: [{ type: 'image', data: 'abc', mimeType: 'image/png' }],
        noteIds: ['note-1'],
      }),
    );
    run.channel.put(sendMessage(AGENT, { wsId: WS, text: 'second', forceSubmit: true }));
    await settle();

    expect(mocks.send).toHaveBeenCalledTimes(1);
    // Inline image blocks are pre-uploaded and swapped to attachment
    // references before the wire call (monorepo#3338).
    expect(mocks.toImageReferenceBlocks).toHaveBeenCalledWith(WS, [
      { type: 'image', data: 'abc', mimeType: 'image/png' },
    ]);
    expect(mocks.send).toHaveBeenNthCalledWith(
      1,
      AGENT,
      'first',
      expect.objectContaining({ id: WS }),
      {
        imageBlocks: [{ type: 'image', attachmentId: 'attach-0', mimeType: 'image/png' }],
        noteIds: ['note-1'],
        userAppMessageId: 'app-message-first',
        priority: 'interrupt',
      },
    );
    resolveFirst();
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    expect(mocks.send).toHaveBeenNthCalledWith(
      2,
      AGENT,
      'second',
      expect.objectContaining({ id: WS }),
      { imageBlocks: undefined, noteIds: undefined, priority: 'interrupt' },
    );
    run.task.cancel();
    await run.task.toPromise();
  });

  it('processes different agents concurrently', async () => {
    let resolveFirst!: () => void;
    mocks.send.mockImplementation((agentId: string) => {
      if (agentId !== AGENT) return Promise.resolve();
      return new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
    });
    const run = harness([
      session(),
      session({ id: OTHER_AGENT, backendSessionId: OTHER_AGENT, name: 'Other Agent' }),
    ]);

    run.channel.put(sendMessage(AGENT, { wsId: WS, text: 'blocked' }));
    run.channel.put(sendMessage(OTHER_AGENT, { wsId: WS, text: 'concurrent' }));
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));

    expect(mocks.send).toHaveBeenNthCalledWith(
      2,
      OTHER_AGENT,
      'concurrent',
      expect.objectContaining({ id: WS }),
      expect.any(Object),
    );
    resolveFirst();
    await settle();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('sends the first Chief message without redundantly reloading a settled blank transcript', async () => {
    const chiefWorkspaceId = '__chief__';
    mocks.send.mockResolvedValue(undefined);
    const run = harness(
      session({ workspaceId: chiefWorkspaceId, backendSessionId: null, messages: [] }),
      undefined,
      null,
    );
    run.settleTranscript();

    run.channel.put(
      sendMessage(AGENT, {
        wsId: chiefWorkspaceId,
        text: 'Summarize my active work',
      }),
    );
    await settle();

    expect(mocks.send).toHaveBeenCalledWith(
      AGENT,
      'Summarize my active work',
      expect.objectContaining({ id: chiefWorkspaceId }),
      {
        imageBlocks: undefined,
        noteIds: undefined,
        messageMetadata: undefined,
        userAppMessageId: undefined,
        priority: undefined,
      },
    );
    expect(run.dispatch).not.toHaveBeenCalledWith(
      refreshChatTranscriptRequested(chiefWorkspaceId, AGENT),
    );
    run.task.cancel();
    await run.task.toPromise();
  });

  it('lets stop bypass a blocked send while ordinary same-agent commands remain FIFO', async () => {
    const gates = Array.from({ length: 3 }, () => {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    });
    const order: string[] = [];
    let sendCount = 0;
    mocks.send.mockImplementation(() => {
      const callIndex = sendCount++;
      order.push(callIndex === 0 ? 'send' : 'retry');
      return gates[callIndex === 0 ? 0 : 2].promise;
    });
    mocks.removeQueued.mockImplementation(() => {
      order.push('remove');
      return gates[1].promise.then(() => ({ success: true }));
    });
    mocks.stop.mockImplementation(() => {
      order.push('stop');
      return Promise.resolve({ success: true });
    });
    const run = harness();
    run.setChat(chatLastAttemptedMessageSet(AGENT, { text: 'retry me', options: {} }));

    const stop = agentSessionStopChatRequested(AGENT);
    const retry = agentSessionRetryLastMessageRequested(AGENT, WS);
    run.channel.put(sendMessage(AGENT, { wsId: WS, text: 'first' }));

    await vi.waitFor(() => expect(order).toEqual(['send']));
    run.channel.put(removeQueuedMessageRequested(AGENT, 'queued-1'));
    run.channel.put(retry);
    run.channel.put(stop);
    await stop.promise;

    expect(order).toEqual(['send', 'stop']);
    expect(mocks.stop).toHaveBeenCalledWith(AGENT);
    expect(mocks.removeQueued).not.toHaveBeenCalled();
    await settle();
    expect(order).toEqual(['send', 'stop']);

    gates[0].resolve();
    await vi.waitFor(() => expect(order).toEqual(['send', 'stop', 'remove']));
    gates[1].resolve();
    await vi.waitFor(() => expect(order).toEqual(['send', 'stop', 'remove', 'retry']));
    gates[2].resolve();
    await retry.promise;

    expect(mocks.removeQueued).toHaveBeenCalledWith(AGENT, 'queued-1');
    run.task.cancel();
    await run.task.toPromise();
  });

  it('does not let a blocked stop stall an ordinary retry-with-model command', async () => {
    let resolveStop!: () => void;
    mocks.stop.mockReturnValue(
      new Promise<{ success: true }>((resolve) => {
        resolveStop = () => resolve({ success: true });
      }),
    );
    mocks.send.mockResolvedValue(undefined);
    const run = harness();
    run.setChat(chatLastAttemptedMessageSet(AGENT, { text: 'retry me', options: {} }));
    const stop = agentSessionStopChatRequested(AGENT);
    const retryWithModel = agentSessionRetryWithModelRequested(AGENT, WS, 'provider:model');

    run.channel.put(stop);
    await vi.waitFor(() => expect(mocks.stop).toHaveBeenCalledTimes(1));
    run.channel.put(retryWithModel);
    await retryWithModel.promise;
    expect(mocks.send).toHaveBeenCalledWith(
      AGENT,
      'retry me',
      expect.objectContaining({ id: WS }),
      expect.objectContaining({ model: 'provider:model' }),
    );

    resolveStop();
    await stop.promise;
    run.task.cancel();
    await run.task.toPromise();
  });

  it('continues the same-agent queue after a command failure', async () => {
    mocks.stop.mockRejectedValue(new Error('stop failed'));
    mocks.removeQueued.mockResolvedValue({ success: true });
    const run = harness();
    const stop = agentSessionStopChatRequested(AGENT);

    run.channel.put(stop);
    run.channel.put(removeQueuedMessageRequested(AGENT, 'queued-after-failure'));

    await expect(stop.promise).rejects.toThrow('stop failed');
    await vi.waitFor(() =>
      expect(mocks.removeQueued).toHaveBeenCalledWith(AGENT, 'queued-after-failure'),
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
      agentId: AGENT,
      workspaceId: WS,
      messageId: 'queued-1',
    });
    expect(run.dispatch).toHaveBeenCalledWith(chatQueueProcessingReceived(AGENT, 'turn-1'));
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.removeQueued).toHaveBeenCalledWith(AGENT, 'queued-2');
    expect(
      run.dispatch.mock.calls.some(([action]) => action.type === 'agentQueue/removeQueuedMessage'),
    ).toBe(true);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('surfaces a direct-send RPC failure via chatSendFailed with the retry payload preserved (monorepo#3040)', async () => {
    // Reaped-agent contract (intent-hq/intentd#1356): sends to an evicted
    // process auto-restore, so a THROW from sendMessage is a genuine failure
    // (agent deleted / RPC error) — it must surface in the chat, never render
    // as silently accepted. `chatLastAttemptedMessageSet` was dispatched
    // before the wire call, so the failure banner's "Try again" can resend.
    mocks.send.mockRejectedValue(new Error('Agent not found: agent-send'));
    const run = harness();
    run.channel.put(sendMessage(AGENT, { wsId: WS, text: 'hello after reap' }));
    await settle();

    expect(run.dispatch).toHaveBeenCalledWith(
      chatLastAttemptedMessageSet(AGENT, { text: 'hello after reap' }),
    );
    // The positive assertion above is satisfied by the pre-wire dispatch, so
    // also pin the invariant: the direct-send catch must never null the retry
    // record (the way the sendQueuedNow failure paths do) — that would break
    // the failure banner's "Try again".
    expect(run.dispatch).not.toHaveBeenCalledWith(chatLastAttemptedMessageSet(AGENT, null));
    expect(run.dispatch).toHaveBeenCalledWith(chatSendFailed(AGENT, 'Agent not found: agent-send'));
    run.task.cancel();
    await run.task.toPromise();
  });

  it('queues a normal send for a busy agent with the exact daemon payload', async () => {
    mocks.queue.mockResolvedValue({
      success: true,
      turnId: 'turn-queued',
      queuedMessage: { id: 'queued-1', content: 'later', timestamp: 1 },
    });
    const run = harness(
      session({
        status: AgentStatus.Active,
        isStreaming: true,
        isProcessing: true,
      }),
    );
    run.channel.put(
      sendMessage(AGENT, {
        wsId: WS,
        text: 'later',
        imageBlocks: [{ type: 'image', data: 'abc', mimeType: 'image/png' }],
      }),
    );
    await settle();

    // Queued sends carry the converted reference blocks too — the retry
    // record matches the wire payload (no re-upload on retry).
    expect(mocks.queue).toHaveBeenCalledWith(AGENT, 'later', {
      imageBlocks: [{ type: 'image', attachmentId: 'attach-0', mimeType: 'image/png' }],
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(run.dispatch).toHaveBeenCalledWith(
      chatQueuedRetryRecordSet(
        AGENT,
        'queued-1',
        {
          text: 'later',
          options: {
            imageBlocks: [{ type: 'image', attachmentId: 'attach-0', mimeType: 'image/png' }],
          },
        },
        'turn-queued',
      ),
    );
    run.task.cancel();
    await run.task.toPromise();
  });

  it('skips the queue-on-send seed when a live agent:queue:updated snapshot superseded the queue RPC (monorepo#2481)', async () => {
    // The daemon delivered the queued entry and emitted an EMPTY
    // agent:queue:updated snapshot while the agent.queueMessage response was
    // still in flight — seeding from the stale echo would re-add the row.
    const supersededQueuedMessage: QueuedMessage = {
      id: 'queued-superseded',
      content: 'later',
      queuedAt: '2026-08-15T14:00:00.000Z',
      position: 0,
      turnId: 'turn-superseded',
    };
    mocks.queue.mockImplementation(async () => {
      noteAgentQueueEventSnapshotApplied(AGENT);
      return {
        success: true,
        turnId: 'turn-superseded',
        queuedMessage: supersededQueuedMessage,
      };
    });
    const run = harness(
      session({ status: AgentStatus.Active, isStreaming: true, isProcessing: true }),
    );
    run.channel.put(sendMessage(AGENT, { wsId: WS, text: 'later' }));
    await settle();
    await settle();

    // The turn-scoped retry record is still parked (cleaned by
    // agent:queue:processing) — only the queue seed is guarded.
    expect(run.dispatch).toHaveBeenCalledWith(
      chatQueuedRetryRecordSet(AGENT, 'queued-superseded', { text: 'later' }, 'turn-superseded'),
    );
    expect(run.dispatch.mock.calls.some(([action]) => action.type === replaceAgentQueue.type)).toBe(
      false,
    );
    // The guard trip must be followed by a reconciling hydrate: client-side
    // apply order cannot rank the superseding snapshot against the echo, so
    // the daemon's true queue is re-read instead of trusting either side
    // (monorepo#2486 review).
    expect(mocks.hydrateQueue).toHaveBeenCalledWith(AGENT);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('seeds the queue mirror from the queue RPC echo when no live snapshot intervened', async () => {
    const freshQueuedMessage: QueuedMessage = {
      id: 'queued-fresh',
      content: 'later',
      queuedAt: '2026-08-15T14:00:00.000Z',
      position: 0,
      turnId: 'turn-fresh',
    };
    mocks.queue.mockResolvedValue({
      success: true,
      turnId: 'turn-fresh',
      queuedMessage: freshQueuedMessage,
    });
    const run = harness(
      session({ status: AgentStatus.Active, isStreaming: true, isProcessing: true }),
    );
    run.channel.put(sendMessage(AGENT, { wsId: WS, text: 'later' }));
    await settle();

    expect(run.dispatch).toHaveBeenCalledWith(replaceAgentQueue(AGENT, [freshQueuedMessage]));
    run.task.cancel();
    await run.task.toPromise();
  });

  it('threads attachment-reference fileBlocks through direct send, busy-agent queue, and retry', async () => {
    const fileBlocks = [
      {
        type: 'file' as const,
        attachmentId: 'att-uuid-1',
        fileName: 'dump.har',
        mimeType: 'application/json',
        size: 12_582_912,
      },
    ];

    // Direct attachment-only send: fileBlocks reach sendAgentMessage's options verbatim.
    mocks.send.mockResolvedValue(undefined);
    const directRun = harness();
    directRun.channel.put(sendMessage(AGENT, { wsId: WS, text: '', fileBlocks }));
    await settle();
    expect(mocks.send).toHaveBeenCalledWith(
      AGENT,
      '',
      expect.objectContaining({ id: WS }),
      expect.objectContaining({ fileBlocks }),
    );
    directRun.task.cancel();
    await directRun.task.toPromise();
    vi.clearAllMocks();

    // Busy agent: fileBlocks ride the daemon queue payload and the recorded
    // retry attempt.
    mocks.queue.mockResolvedValue({
      success: true,
      turnId: 'turn-queued',
      queuedMessage: { id: 'queued-1', content: 'later file', timestamp: 1 },
    });
    const queueRun = harness(
      session({ status: AgentStatus.Active, isStreaming: true, isProcessing: true }),
    );
    queueRun.channel.put(sendMessage(AGENT, { wsId: WS, text: '', fileBlocks }));
    await settle();
    expect(mocks.queue).toHaveBeenCalledWith(AGENT, '', { fileBlocks });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(queueRun.dispatch).toHaveBeenCalledWith(
      chatQueuedRetryRecordSet(
        AGENT,
        'queued-1',
        { text: '', options: { fileBlocks } },
        'turn-queued',
      ),
    );
    queueRun.task.cancel();
    await queueRun.task.toPromise();
    vi.clearAllMocks();

    // Retry: the recorded attempt's fileBlocks are resent.
    mocks.send.mockResolvedValue(undefined);
    const retryRun = harness();
    retryRun.setChat(chatLastAttemptedMessageSet(AGENT, { text: '', options: { fileBlocks } }));
    const retry = agentSessionRetryLastMessageRequested(AGENT, WS);
    retryRun.channel.put(retry);
    await expect(retry.promise).resolves.toBeUndefined();
    expect(mocks.send).toHaveBeenCalledWith(
      AGENT,
      '',
      expect.objectContaining({ id: WS }),
      expect.objectContaining({ fileBlocks }),
    );
    retryRun.task.cancel();
    await retryRun.task.toPromise();
  });

  it('retries with the requested model and handles exact stop results and payloads', async () => {
    mocks.send.mockResolvedValue(undefined);
    mocks.stop
      .mockResolvedValueOnce({ success: false, error: 'already stopped' })
      .mockRejectedValueOnce(new Error('stop failed'));
    const run = harness();
    run.setChat(chatLastAttemptedMessageSet(AGENT, { text: 'retry me', options: {} }));
    const retry = agentSessionRetryWithModelRequested(AGENT, WS, 'provider:new-model');
    run.channel.put(retry);
    await expect(retry.promise).resolves.toBeUndefined();
    expect(mocks.send).toHaveBeenCalledWith(
      AGENT,
      'retry me',
      expect.objectContaining({ id: WS }),
      expect.objectContaining({ model: 'provider:new-model' }),
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

  it('settles active and queued same-agent promise actions once on cancellation', async () => {
    mocks.stop.mockReturnValue(new Promise(() => {}));
    mocks.send.mockReturnValue(new Promise(() => {}));
    const run = harness();
    run.setChat(chatLastAttemptedMessageSet(AGENT, { text: 'retry after stop', options: {} }));
    const activeStop = agentSessionStopChatRequested(AGENT);
    const concurrentRetry = agentSessionRetryLastMessageRequested(AGENT, WS);
    const concurrentModelRetry = agentSessionRetryWithModelRequested(AGENT, WS, 'provider:model');
    const stopSettlement = activeStop.promise.catch((error) => error);
    const retrySettlement = concurrentRetry.promise.catch((error) => error);
    const modelRetrySettlement = concurrentModelRetry.promise.catch((error) => error);

    run.channel.put(activeStop);
    await vi.waitFor(() => expect(mocks.stop).toHaveBeenCalledWith(AGENT));
    run.channel.put(concurrentRetry);
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    run.channel.put(concurrentModelRetry);
    await settle();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    run.task.cancel();
    await run.task.toPromise();

    await expect(stopSettlement).resolves.toEqual(
      expect.objectContaining({ message: expect.stringContaining('cancelled') }),
    );
    await expect(retrySettlement).resolves.toEqual(
      expect.objectContaining({ message: expect.stringContaining('cancelled') }),
    );
    await expect(modelRetrySettlement).resolves.toEqual(
      expect.objectContaining({ message: expect.stringContaining('cancelled') }),
    );
    expect(
      run.dispatch.mock.calls.filter(([action]) => action.type === activeStop.failure.type),
    ).toHaveLength(1);
    expect(
      run.dispatch.mock.calls.filter(([action]) => action.type === concurrentRetry.failure.type),
    ).toHaveLength(1);
    expect(
      run.dispatch.mock.calls.filter(
        ([action]) => action.type === concurrentModelRetry.failure.type,
      ),
    ).toHaveLength(1);
  });

  it('awaits and isolates no-retry toast failures before resolving', async () => {
    mocks.toastInfo.mockImplementationOnce(() => {
      throw new Error('toast unavailable');
    });
    const run = harness();
    const retry = agentSessionRetryLastMessageRequested(AGENT, WS);
    run.channel.put(retry);

    await expect(retry.promise).resolves.toBeUndefined();
    await vi.waitFor(() => expect(mocks.toastInfo).toHaveBeenCalledTimes(1));
    run.task.cancel();
    await run.task.toPromise();
  });

  it('sends normally to an archived workspace with no suggestion toast (daemon auto-unarchives)', async () => {
    mocks.send.mockResolvedValue(undefined);
    const archivedWorkspace = {
      id: WS,
      name: 'Workspace',
      path: '/repo',
      status: WorkspaceStatusEnum.Archived,
      archived: true,
    } as Workspace;
    const run = harness(session(), undefined, archivedWorkspace);
    run.channel.put(sendMessage(AGENT, { wsId: WS, text: 'hello archived' }));
    await settle();

    expect(mocks.send).toHaveBeenCalledWith(
      AGENT,
      'hello archived',
      expect.objectContaining({ id: WS }),
      expect.any(Object),
    );
    expect(mocks.toastInfo).not.toHaveBeenCalled();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('retry-from-stalled stops the hung turn and re-sends the last attempt with interrupt priority', async () => {
    mocks.stop.mockResolvedValue({ success: true });
    mocks.send.mockResolvedValue(undefined);
    const run = harness();
    run.setChat(
      streamStatusReceived(
        AGENT,
        { phase: 'stalled', message: 'No model activity', level: 'warn', timestamp: Date.now() },
        false,
      ),
    );
    run.setChat(chatLastAttemptedMessageSet(AGENT, { text: 'stalled send', options: {} }));

    const retry = agentSessionRetryFromStalledRequested(AGENT, WS);
    run.channel.put(retry);
    await expect(retry.promise).resolves.toBeUndefined();

    expect(mocks.stop).toHaveBeenCalledWith(AGENT);
    expect(mocks.send).toHaveBeenCalledWith(
      AGENT,
      'stalled send',
      expect.objectContaining({ id: WS }),
      expect.objectContaining({ priority: 'interrupt' }),
    );
    run.task.cancel();
    await run.task.toPromise();
  });

  it('retry-from-stalled abandons the re-send when the user cancels mid-retry', async () => {
    // The retry's own stop RPC hangs while the user clicks Cancel: the
    // concurrent agentSessionStopChatRequested must win the race so no
    // message is re-sent after the user chose to stop.
    let releaseRetryStop!: (value: { success: boolean }) => void;
    mocks.stop
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseRetryStop = resolve;
          }),
      )
      .mockResolvedValue({ success: true });
    mocks.send.mockResolvedValue(undefined);
    const run = harness();
    run.setChat(
      streamStatusReceived(
        AGENT,
        { phase: 'stalled', message: 'No model activity', level: 'warn', timestamp: Date.now() },
        false,
      ),
    );
    run.setChat(chatLastAttemptedMessageSet(AGENT, { text: 'stalled send', options: {} }));

    const retry = agentSessionRetryFromStalledRequested(AGENT, WS);
    run.channel.put(retry);
    await settle();
    expect(mocks.stop).toHaveBeenCalledTimes(1);

    const stop = agentSessionStopChatRequested(AGENT);
    run.channel.put(stop);
    releaseRetryStop({ success: true });

    await expect(retry.promise).resolves.toBeUndefined();
    await expect(stop.promise).resolves.toBeUndefined();
    expect(mocks.send).not.toHaveBeenCalled();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('retry-from-stalled is a no-op when the stall is no longer active', async () => {
    const run = harness();
    // Stalled event followed by a later stream chunk: stall superseded.
    run.setChat(
      streamStatusReceived(
        AGENT,
        { phase: 'stalled', message: 'No model activity', level: 'warn', timestamp: 1_000 },
        false,
      ),
    );
    run.setChat(chatLastAttemptedMessageSet(AGENT, { text: 'stalled send', options: {} }));
    run.dispatch(streamActivityReceived(AGENT, true, 2_000));

    const retry = agentSessionRetryFromStalledRequested(AGENT, WS);
    run.channel.put(retry);
    await expect(retry.promise).resolves.toBeUndefined();

    expect(mocks.stop).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('retry-from-stalled with no recorded attempt stops the turn and toasts', async () => {
    mocks.stop.mockResolvedValue({ success: true });
    const run = harness();
    run.setChat(
      streamStatusReceived(
        AGENT,
        { phase: 'stalled', message: 'No model activity', level: 'warn', timestamp: Date.now() },
        false,
      ),
    );

    const retry = agentSessionRetryFromStalledRequested(AGENT, WS);
    run.channel.put(retry);
    await expect(retry.promise).resolves.toBeUndefined();

    expect(mocks.stop).toHaveBeenCalledWith(AGENT);
    expect(mocks.send).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(mocks.toastInfo).toHaveBeenCalledTimes(1));
    run.task.cancel();
    await run.task.toPromise();
  });
});
