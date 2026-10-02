import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { createCollection, getItem } from '@themislib/themis/utils/collections/collection-utils';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  queue: vi.fn(),
  hydrateQueue: vi.fn(async () => undefined),
  sendQueuedNow: vi.fn(),
  removeQueued: vi.fn(),
  editQueued: vi.fn(),
  stop: vi.fn(),
  rename: vi.fn(),
  toastInfo: vi.fn(),
  toastError: vi.fn(),
  // Retry-on-another-provider (#4455): the per-provider `models.list` catalog
  // and the live-session provider switch are the two daemon round-trips the
  // handler brackets; both are stubbed per-test.
  getModelsForProvider: vi.fn(),
  setModel: vi.fn(),
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
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { info: mocks.toastInfo, error: mocks.toastError },
}));
vi.mock('../../model/model-utils', () => ({
  getModelsForProviderForLoadingState: mocks.getModelsForProvider,
}));
vi.mock('$features/agent/agent.client', () => ({
  agentClient: { setModel: mocks.setModel },
}));
vi.mock('$lib/components/chat/input/image-attachment-placement', () => ({
  toImageReferenceBlocks: mocks.toImageReferenceBlocks,
}));
vi.mock('$lib/client', () => ({
  appClient: {
    agents: {
      queue: mocks.queue,
      sendQueuedNow: mocks.sendQueuedNow,
      removeQueued: mocks.removeQueued,
      editQueued: mocks.editQueued,
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
  agentSessionRetryWithProviderRequested,
  agentSessionStopChatRequested,
  bulkUpsertSessions,
  initialState as sessionInitialState,
} from '../../agent-session/agent-session-slice';
import {
  agentQueueReducer,
  initialState as queueInitialState,
  queuedMessageMutationRequested,
  replaceAgentQueue,
  upsertQueuedMessageInAgentQueue,
} from '../../agent-queue/agent-queue-slice';
import type { QueuedMessageMutationOperation } from '../../agent-queue/agent-queue-types';
import {
  __resetAgentQueueReadServiceForTests,
  noteAgentQueueEventSnapshotApplied,
} from '$features/agent/agent-queue-read-service';
import { initialState as workspaceInitialState } from '../../workspace/workspace-slice';
import {
  chatQueueProcessingReceived,
  chatQueuedRetryRecordSet,
  chatQueuedRetryRecordUpdated,
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
let mutationSeq = 0;
function queuedMutation(
  messageId: string,
  operation: QueuedMessageMutationOperation,
  workspaceId = WS,
): ReturnType<typeof queuedMessageMutationRequested> {
  return queuedMessageMutationRequested({
    requestId: `request-${++mutationSeq}`,
    consumerId: 'panel-a',
    workspaceId,
    agentId: AGENT,
    messageId,
    operation,
  });
}
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
  /**
   * `model.providerDefaults` mirrored renderer-side — the user's configured
   * model per provider. Seeded here so the quota-retry pick can assert that a
   * user's own choice wins over the provider's advertised default.
   */
  providerModels: Record<string, string> = {},
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
        return { agentSessions, chatState, agentQueue, workspace, model: { providerModels } };
      },
    },
    chatSendSaga,
  );
  return {
    channel,
    dispatch,
    task,
    /** Dispatch a queued mutation through the reducer and the saga channel, as the store does. */
    request: (action: ReturnType<typeof queuedMessageMutationRequested>) => {
      agentQueue = agentQueueReducer(agentQueue, action);
      channel.put(action);
      return action;
    },
    outcome: async (action: ReturnType<typeof queuedMessageMutationRequested>) => {
      const id = action.payload[0].requestId;
      await vi.waitFor(() => expect(getItem(agentQueue.mutations, id)?.status).not.toBe('pending'));
      return getItem(agentQueue.mutations, id);
    },
    queue: () => agentQueue,
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
    run.request(queuedMutation('queued-1', { kind: 'remove' }));
    run.channel.put(retry);
    run.channel.put(stop);
    await stop.promise;

    expect(order).toEqual(['send', 'stop']);
    expect(mocks.stop).toHaveBeenCalledWith(AGENT, WS);
    expect(mocks.removeQueued).not.toHaveBeenCalled();
    await settle();
    expect(order).toEqual(['send', 'stop']);

    gates[0].resolve();
    await vi.waitFor(() => expect(order).toEqual(['send', 'stop', 'remove']));
    gates[1].resolve();
    await vi.waitFor(() => expect(order).toEqual(['send', 'stop', 'remove', 'retry']));
    gates[2].resolve();
    await retry.promise;

    expect(mocks.removeQueued).toHaveBeenCalledWith(AGENT, 'queued-1', WS);
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
    run.request(queuedMutation('queued-after-failure', { kind: 'remove' }));

    await expect(stop.promise).rejects.toThrow('stop failed');
    await vi.waitFor(() =>
      expect(mocks.removeQueued).toHaveBeenCalledWith(AGENT, 'queued-after-failure', WS),
    );
    run.task.cancel();
    await run.task.toPromise();
  });

  it('keeps send-now atomic and queue removal optimistic when transport fails', async () => {
    mocks.sendQueuedNow.mockResolvedValue({ success: true, turnId: 'turn-1' });
    mocks.removeQueued.mockRejectedValue(new Error('offline'));
    const run = harness();
    run.channel.put(sendMessage(AGENT, { wsId: WS, text: 'ignored', queuedMessageId: 'queued-1' }));
    const removal = run.request(queuedMutation('queued-2', { kind: 'remove' }));
    await settle();

    expect(mocks.sendQueuedNow).toHaveBeenCalledWith({
      agentId: AGENT,
      workspaceId: WS,
      messageId: 'queued-1',
    });
    expect(run.dispatch).toHaveBeenCalledWith(chatQueueProcessingReceived(AGENT, 'turn-1'));
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.removeQueued).toHaveBeenCalledWith(AGENT, 'queued-2', WS);
    expect(
      run.dispatch.mock.calls.some(([action]) => action.type === 'agentQueue/removeQueuedMessage'),
    ).toBe(true);
    run.task.cancel();
    await run.task.toPromise();
  });

  it.each([
    { result: { success: true, queued: false, turnId: 'turn-now' }, outcome: 'delivered' },
    { result: { success: true, queued: true }, outcome: 'queued' },
    { result: { success: true, queued: true, quarantined: true }, outcome: 'quarantined' },
  ])(
    'acknowledges send-now as $outcome without changing the composer or stored attachments',
    async ({ result, outcome }) => {
      mocks.sendQueuedNow.mockResolvedValue(result);
      const run = harness();
      const entries: QueuedMessage[] = [
        {
          id: 'chosen',
          content: 'review fixture',
          queuedAt: '2026-01-01T00:00:00.000Z',
          position: 0,
          imageBlocks: [{ type: 'image', attachmentId: 'fixture-image' }],
          fileBlocks: [{ type: 'file', attachmentId: 'fixture-file', fileName: 'fixture.txt' }],
        },
      ];
      run.dispatch(replaceAgentQueue(AGENT, entries));
      run.setChat(chatLastAttemptedMessageSet(AGENT, { text: 'running turn' }));
      run.dispatch.mockClear();
      const action = run.request(queuedMutation('chosen', { kind: 'sendNow' }));
      await expect(run.outcome(action)).resolves.toMatchObject({
        consumerId: 'panel-a',
        status: 'succeeded',
        sendOutcome: outcome,
      });
      expect(mocks.sendQueuedNow).toHaveBeenCalledExactlyOnceWith({
        agentId: AGENT,
        workspaceId: WS,
        messageId: 'chosen',
      });
      expect(mocks.send).not.toHaveBeenCalled();
      expect(mocks.removeQueued).not.toHaveBeenCalled();
      expect(mocks.toImageReferenceBlocks).not.toHaveBeenCalled();
      expect(
        run.dispatch.mock.calls.some(
          ([sent]) =>
            sent.type === 'transientUi/clearChatDraft' ||
            sent.type === chatLastAttemptedMessageSet.type ||
            (sent.type.startsWith('agentQueue/') && sent.type !== 'agentQueue/mutationFinished'),
        ),
      ).toBe(false);
      if (outcome === 'delivered') {
        expect(run.dispatch).toHaveBeenCalledWith(chatQueueProcessingReceived(AGENT, 'turn-now'));
      } else {
        expect(
          run.dispatch.mock.calls.some(([sent]) => sent.type === chatQueueProcessingReceived.type),
        ).toBe(false);
      }
      run.task.cancel();
      await run.task.toPromise();
    },
  );

  it.each(['before', 'after'] as const)(
    'keeps send-now processing payload when its event arrives %s the response',
    async (eventOrder) => {
      const run = harness();
      const original: QueuedMessage = {
        id: 'chosen',
        turnId: 'turn-now',
        content: 'first',
        position: 0,
        queuedAt: '2026-10-02T00:00:00Z',
      };
      const admitted: QueuedMessage = {
        ...original,
        content: 'first\n\nsecond',
        fileBlocks: [{ type: 'file', attachmentId: 'f', fileName: 'file.txt' }],
        messageMetadata: {
          mergedMessageMetadata: [
            { answeredQuestionsMessageId: 'one' },
            { answeredQuestionsMessageId: 'two' },
          ],
        },
      };
      run.dispatch(
        chatQueuedRetryRecordSet(AGENT, original.id, { text: original.content }, original.turnId!),
      );
      run.dispatch(replaceAgentQueue(AGENT, [original], WS));
      mocks.sendQueuedNow.mockImplementation(async () => {
        if (eventOrder === 'before')
          run.dispatch(chatQueueProcessingReceived(AGENT, 'turn-now', [admitted]));
        return { success: true, queued: false, turnId: 'turn-now' };
      });
      const action = run.request(queuedMutation(original.id, { kind: 'sendNow' }));
      await expect(run.outcome(action)).resolves.toMatchObject({ sendOutcome: 'delivered' });
      if (eventOrder === 'after')
        run.dispatch(chatQueueProcessingReceived(AGENT, 'turn-now', [admitted]));
      run.dispatch(replaceAgentQueue(AGENT, [original], WS));
      run.dispatch(replaceAgentQueue(AGENT, [], WS));
      run.dispatch(chatSendFailed(AGENT, 'provider failed', 'turn-now'));
      run.channel.put(agentSessionRetryLastMessageRequested(AGENT, WS));
      await settle();
      await settle();
      expect(mocks.send).toHaveBeenCalledWith(
        AGENT,
        admitted.content,
        expect.anything(),
        expect.objectContaining({
          fileBlocks: admitted.fileBlocks,
          messageMetadata: admitted.messageMetadata,
        }),
      );
      run.task.cancel();
      await run.task.toPromise();
    },
  );

  it('rejects failed and cancelled send-now requests without retrying or dropping the queued item', async () => {
    mocks.sendQueuedNow.mockResolvedValueOnce({ success: false, error: 'already drained' });
    const run = harness();
    const failed = run.request(queuedMutation('gone', { kind: 'sendNow' }));
    await expect(run.outcome(failed)).resolves.toMatchObject({
      status: 'failed',
      error: 'already drained',
    });
    mocks.sendQueuedNow.mockReturnValue(new Promise(() => {}));
    const active = run.request(queuedMutation('waiting', { kind: 'sendNow' }));
    const queued = run.request(queuedMutation('later', { kind: 'sendNow' }));
    await vi.waitFor(() => expect(mocks.sendQueuedNow).toHaveBeenCalledTimes(2));
    run.task.cancel();
    await run.task.toPromise();
    for (const action of [active, queued]) {
      expect(getItem(run.queue().mutations, action.payload[0].requestId)?.status).toBe(
        'cancelled',
      );
    }
    expect(mocks.sendQueuedNow).toHaveBeenCalledTimes(2);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.removeQueued).not.toHaveBeenCalled();
    expect(
      run.dispatch.mock.calls.some(
        ([sent]) =>
          sent.type === chatSendFailed.type || sent.type === chatLastAttemptedMessageSet.type,
      ),
    ).toBe(false);
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
      workspaceId: WS,
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

  it('forwards the Q&A answer tag on the busy-agent queue payload', async () => {
    const messageMetadata = { type: 'question_answers', answeredQuestionsMessageId: 'msg-q1' };
    mocks.queue.mockResolvedValue({
      success: true,
      turnId: 'turn-queued',
      queuedMessage: { id: 'queued-1', content: 'Q: Auth method\nA: OAuth', timestamp: 1 },
    });
    const run = harness(
      session({ status: AgentStatus.Active, isStreaming: true, isProcessing: true }),
    );
    run.channel.put(
      sendMessage(AGENT, { wsId: WS, text: 'Q: Auth method\nA: OAuth', messageMetadata }),
    );
    await settle();

    expect(mocks.queue).toHaveBeenCalledWith(AGENT, 'Q: Auth method\nA: OAuth', {
      workspaceId: WS,
      messageMetadata,
    });
    expect(mocks.send).not.toHaveBeenCalled();
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
      noteAgentQueueEventSnapshotApplied(AGENT, WS);
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

    // A drained row must not regain a stale parked retry payload.
    expect(run.dispatch).not.toHaveBeenCalledWith(
      chatQueuedRetryRecordSet(AGENT, 'queued-superseded', { text: 'later' }, 'turn-superseded'),
    );
    expect(run.dispatch.mock.calls.some(([action]) => action.type === replaceAgentQueue.type)).toBe(
      false,
    );
    // The guard trip must be followed by a reconciling hydrate: client-side
    // apply order cannot rank the superseding snapshot against the echo, so
    // the daemon's true queue is re-read instead of trusting either side
    // (monorepo#2486 review).
    expect(mocks.hydrateQueue).toHaveBeenCalledWith(AGENT, WS);
    run.task.cancel();
    await run.task.toPromise();
  });

  it.each(
    [true, false].flatMap((prior) =>
      [
        'snapshot-first',
        'processing-first',
        'ack-only',
        'lagged-old-snapshot',
        'stale-after-processing',
        'legacy-lagged',
        'batch',
        'recovered-before-ack',
      ].map((order) => [prior, order] as const),
    ),
  )(
    'retries the processed snapshot after a delayed response (prior record: %s, order: %s)',
    async (hasPriorRecord, order) => {
      const first: QueuedMessage = {
        id: 'survivor',
        turnId: 'survivor',
        content: 'first',
        position: 0,
        queuedAt: '2026-10-02T00:00:00Z',
      };
      const latest: QueuedMessage = {
        ...first,
        content: 'first\n\nsecond\n\nthird',
        fileBlocks: [
          { type: 'file', attachmentId: 'first-file', fileName: 'first.txt' },
          { type: 'file', attachmentId: 'third-file', fileName: 'third.txt' },
        ],
        messageMetadata: {
          mergedMessageMetadata: [
            { type: 'question_answers', answeredQuestionsMessageId: 'question-one' },
            { type: 'question_answers', answeredQuestionsMessageId: 'question-two' },
          ],
        },
      };
      const run = harness(session({ isStreaming: true, isProcessing: true }));
      const bob: QueuedMessage = {
        ...first,
        id: 'bob',
        turnId: 'bob-turn',
        content: 'Bob input',
        fileBlocks: [{ type: 'file', attachmentId: 'bob-file', fileName: 'bob.txt' }],
        messageMetadata: {
          fromPrincipalId: 'bob',
          type: 'question_answers',
          answeredQuestionsMessageId: 'question-bob',
        },
      };
      const processedRows = order === 'batch' ? [latest, bob] : [latest];
      const expectedContent = order === 'batch' ? latest.content + '\n\nBob input' : latest.content;
      const expectedFiles =
        order === 'batch' ? [...latest.fileBlocks!, ...bob.fileBlocks!] : latest.fileBlocks;
      const expectedMetadata =
        order === 'batch'
          ? {
              mergedMessageMetadata: [
                ...(latest.messageMetadata!.mergedMessageMetadata as unknown[]),
                bob.messageMetadata,
              ],
            }
          : latest.messageMetadata;
      if (hasPriorRecord)
        run.dispatch(chatQueuedRetryRecordSet(AGENT, first.id, { text: first.content }, first.id));
      run.dispatch(replaceAgentQueue(AGENT, [first], WS));
      mocks.queue.mockImplementation(async () => {
        if (order === 'lagged-old-snapshot' || order === 'legacy-lagged') {
          run.dispatch(replaceAgentQueue(AGENT, [first], WS));
          noteAgentQueueEventSnapshotApplied(AGENT, WS);
        }
        if (order !== 'snapshot-first')
          run.dispatch(
            chatQueueProcessingReceived(
              AGENT,
              first.id,
              order === 'legacy-lagged'
                ? undefined
                : order === 'recovered-before-ack'
                  ? [first]
                  : processedRows,
            ),
          );
        if (order !== 'ack-only' && order !== 'lagged-old-snapshot' && order !== 'legacy-lagged') {
          run.dispatch(replaceAgentQueue(AGENT, [latest], WS));
          noteAgentQueueEventSnapshotApplied(AGENT, WS);
        }
        if (order === 'snapshot-first')
          run.dispatch(
            chatQueueProcessingReceived(
              AGENT,
              first.id,
              order === 'legacy-lagged'
                ? undefined
                : order === 'recovered-before-ack'
                  ? [first]
                  : processedRows,
            ),
          );
        if (order === 'recovered-before-ack') {
          run.dispatch(
            chatQueueProcessingReceived(AGENT, first.id, [{ ...latest, id: 'recovered-id' }]),
          );
        }
        if (order === 'stale-after-processing') {
          run.dispatch(replaceAgentQueue(AGENT, [first], WS));
          noteAgentQueueEventSnapshotApplied(AGENT, WS);
        }
        run.dispatch(replaceAgentQueue(AGENT, [], WS));
        noteAgentQueueEventSnapshotApplied(AGENT, WS);
        return {
          success: true,
          turnId: order === 'batch' ? bob.turnId : first.id,
          queuedMessage:
            order === 'batch'
              ? bob
              : order === 'ack-only' || order === 'lagged-old-snapshot' || order === 'legacy-lagged'
                ? latest
                : { ...first, content: 'first\n\nsecond' },
        };
      });
      run.channel.put(sendMessage(AGENT, { wsId: WS, text: 'second' }));
      await settle();
      await settle();
      run.dispatch(chatSendFailed(AGENT, 'turn failed', first.id));
      run.dispatch(bulkUpsertSessions([session()]));
      run.channel.put(agentSessionRetryLastMessageRequested(AGENT, WS));
      await settle();
      await settle();
      expect(mocks.send).toHaveBeenCalledWith(
        AGENT,
        expectedContent,
        expect.anything(),
        expect.objectContaining({
          fileBlocks: expectedFiles,
          messageMetadata: expectedMetadata,
        }),
      );
      run.task.cancel();
      await run.task.toPromise();
    },
  );

  it('replaces the surviving row in place after append and parks the full retry payload', async () => {
    const original: QueuedMessage = {
      id: 'surviving',
      turnId: 'surviving',
      content: 'first',
      queuedAt: '2026-10-02T00:00:00Z',
      position: 0,
      messageMetadata: { fromPrincipalId: 'alice' },
      imageBlocks: [{ type: 'image', attachmentId: 'first-image' }],
    };
    const system: QueuedMessage = {
      id: 'system',
      content: 'wake',
      queuedAt: original.queuedAt,
      position: 1,
      messageMetadata: { source: 'system' },
    };
    const merged = {
      ...original,
      content: 'first\n\nsecond',
      fileBlocks: [{ type: 'file' as const, attachmentId: 'second-file', fileName: 'report.txt' }],
    };
    mocks.queue.mockResolvedValue({ success: true, turnId: 'surviving', queuedMessage: merged });
    const run = harness(session({ isStreaming: true, isProcessing: true }));
    run.dispatch(replaceAgentQueue(AGENT, [original, system], WS));
    run.channel.put(
      sendMessage(AGENT, { wsId: WS, text: 'second', fileBlocks: merged.fileBlocks }),
    );
    await settle();
    await settle();
    expect(run.dispatch).toHaveBeenCalledWith(replaceAgentQueue(AGENT, [merged, system], WS));
    expect(run.dispatch).toHaveBeenCalledWith(
      chatQueuedRetryRecordSet(
        AGENT,
        'surviving',
        {
          text: 'first\n\nsecond',
          options: {
            imageBlocks: original.imageBlocks,
            fileBlocks: merged.fileBlocks,
            messageMetadata: original.messageMetadata,
          },
        },
        'surviving',
      ),
    );
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

    expect(run.dispatch).toHaveBeenCalledWith(replaceAgentQueue(AGENT, [freshQueuedMessage], WS));
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
      queuedMessage: {
        id: 'queued-1',
        content: '',
        queuedAt: '2026-10-02T00:00:00Z',
        position: 0,
        fileBlocks,
      },
    });
    const queueRun = harness(
      session({ status: AgentStatus.Active, isStreaming: true, isProcessing: true }),
    );
    queueRun.channel.put(sendMessage(AGENT, { wsId: WS, text: '', fileBlocks }));
    await settle();
    expect(mocks.queue).toHaveBeenCalledWith(AGENT, '', { workspaceId: WS, fileBlocks });
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
    expect(mocks.stop).toHaveBeenNthCalledWith(1, AGENT, WS);
    const failedStop = agentSessionStopChatRequested(AGENT);
    run.channel.put(failedStop);
    await expect(failedStop.promise).rejects.toThrow('stop failed');
    expect(mocks.stop).toHaveBeenNthCalledWith(2, AGENT, WS);
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
    await vi.waitFor(() => expect(mocks.stop).toHaveBeenCalledWith(AGENT, WS));
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

    expect(mocks.stop).toHaveBeenCalledWith(AGENT, WS);
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

    expect(mocks.stop).toHaveBeenCalledWith(AGENT, WS);
    expect(mocks.send).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(mocks.toastInfo).toHaveBeenCalledTimes(1));
    run.task.cancel();
    await run.task.toPromise();
  });
  describe('retry on another provider (#4455)', () => {
    const OTHER_PROVIDER = 'codex';

    beforeEach(() => {
      // `vi.clearAllMocks()` keeps mock implementations, so without an
      // explicit per-test seed each case would silently inherit the previous
      // test's catalog and fail when run in isolation (`-t`). Reset both
      // saga-facing mocks and install the default catalog; tests that need a
      // different shape override it below. Row order matters: the isDefault
      // row must win over the first row, so the catalog deliberately puts a
      // non-default first.
      mocks.getModelsForProvider.mockReset();
      mocks.setModel.mockReset();
      mocks.send.mockReset();
      mocks.queue.mockReset();
      mocks.getModelsForProvider.mockResolvedValue({
        models: [
          { value: 'gpt-5-mini', label: 'Mini' },
          { value: 'gpt-5-codex', label: 'Codex', isDefault: true },
        ],
      });
      mocks.setModel.mockResolvedValue({ ok: true, data: { success: true } });
      mocks.send.mockResolvedValue(undefined);
    });

    /** The wire sends issued by the redrive, as `[agentId, text, model]`. */
    function sentTurns() {
      return mocks.send.mock.calls.map(([agentId, text, , options]) => [
        agentId,
        text,
        options?.model,
      ]);
    }

    it('switches the session to the provider default model, then redrives the turn', async () => {
      const run = harness();
      run.setChat(chatLastAttemptedMessageSet(AGENT, { text: 'retry me', options: {} }));

      const retry = agentSessionRetryWithProviderRequested(AGENT, WS, OTHER_PROVIDER);
      run.channel.put(retry);
      await expect(retry.promise).resolves.toBeUndefined();

      expect(mocks.getModelsForProvider).toHaveBeenCalledWith(OTHER_PROVIDER, { workspaceId: WS });
      expect(mocks.setModel).toHaveBeenCalledWith(AGENT, 'gpt-5-codex', WS, OTHER_PROVIDER);
      // The redrive MUST carry the newly picked model as an explicit
      // override on the wire: the plain last-message retry resolves the
      // model from the recorded attempt (the exhausted provider's model) or
      // the stale Redux session, either of which re-sends the model we just
      // switched away from and defeats the recovery.
      expect(sentTurns()).toEqual([[AGENT, 'retry me', 'gpt-5-codex']]);
      // The redrive ran inline; it is not re-queued as its own command.
      expect(
        run.dispatch.mock.calls.filter(
          ([action]) =>
            action.type === agentSessionRetryWithModelRequested.type ||
            action.type === agentSessionRetryLastMessageRequested.type,
        ),
      ).toHaveLength(0);
      expect(mocks.toastError).not.toHaveBeenCalled();
      run.task.cancel();
      await run.task.toPromise();
    });

    it('a second provider click queued during the first switch cannot hijack the first redrive', async () => {
      // The provider buttons stay rendered while the first click's catalog
      // and setModel RPCs are in flight, so a second click is already queued
      // on the per-agent FIFO by the time the first handler is ready to
      // redrive. If that redrive were put back onto the FIFO it would run
      // AFTER the second click's setModel, sending the first provider's
      // model against the second provider's live session. Each click must
      // therefore complete switch + send before the next click's switch.
      //
      // Once the first redrive's turn is live the session is responding, so
      // the second click's redrive takes the ordinary enqueue path (the
      // daemon drains it on the session's then-current provider) rather than
      // a second direct send — the same rule as any send during a turn.
      const SECOND_PROVIDER = 'claude-code';
      mocks.getModelsForProvider.mockImplementation(async (providerId: string) => ({
        models:
          providerId === OTHER_PROVIDER
            ? [{ value: 'gpt-5-codex', label: 'Codex', isDefault: true }]
            : [{ value: 'claude-opus', label: 'Opus', isDefault: true }],
      }));
      mocks.queue.mockResolvedValue({ success: true });
      const run = harness();
      run.setChat(chatLastAttemptedMessageSet(AGENT, { text: 'retry me', options: {} }));

      const first = agentSessionRetryWithProviderRequested(AGENT, WS, OTHER_PROVIDER);
      const second = agentSessionRetryWithProviderRequested(AGENT, WS, SECOND_PROVIDER);
      run.channel.put(first);
      run.channel.put(second);
      await expect(first.promise).resolves.toBeUndefined();
      await expect(second.promise).resolves.toBeUndefined();

      // The first provider's model is what went out on the first (and only
      // direct) send; the second click did not hijack it.
      expect(sentTurns()).toEqual([[AGENT, 'retry me', 'gpt-5-codex']]);
      expect(mocks.setModel).toHaveBeenNthCalledWith(1, AGENT, 'gpt-5-codex', WS, OTHER_PROVIDER);
      expect(mocks.setModel).toHaveBeenNthCalledWith(2, AGENT, 'claude-opus', WS, SECOND_PROVIDER);
      // Interleaving on the wire: switch(1) → send(1) → switch(2) → queue(2),
      // never switch(1) → switch(2) → send(1).
      const [switch1, switch2] = mocks.setModel.mock.invocationCallOrder;
      const [send1] = mocks.send.mock.invocationCallOrder;
      const [queue2] = mocks.queue.mock.invocationCallOrder;
      expect(switch1).toBeLessThan(send1);
      expect(send1).toBeLessThan(switch2);
      expect(switch2).toBeLessThan(queue2);
      expect(mocks.queue).toHaveBeenCalledTimes(1);
      expect(mocks.queue).toHaveBeenCalledWith(AGENT, 'retry me', { workspaceId: WS });
      expect(mocks.toastError).not.toHaveBeenCalled();
      run.task.cancel();
      await run.task.toPromise();
    });

    it("honours the user's configured model for the target provider (#4455)", async () => {
      // `model.providerDefaults` is where the user has already said which
      // model this provider should use — the same setting the model picker
      // and the daemon's creation-time chain honour. A failover that landed
      // on the provider's advertised default instead would silently override
      // an explicit preference.
      const run = harness(session(), undefined, undefined, {
        [OTHER_PROVIDER]: 'gpt-5-mini',
      });
      run.setChat(chatLastAttemptedMessageSet(AGENT, { text: 'retry me', options: {} }));

      const retry = agentSessionRetryWithProviderRequested(AGENT, WS, OTHER_PROVIDER);
      run.channel.put(retry);
      await expect(retry.promise).resolves.toBeUndefined();

      // 'gpt-5-codex' is the catalog's isDefault row; the user's choice wins.
      expect(mocks.setModel).toHaveBeenCalledWith(AGENT, 'gpt-5-mini', WS, OTHER_PROVIDER);
      expect(sentTurns()).toEqual([[AGENT, 'retry me', 'gpt-5-mini']]);
      run.task.cancel();
      await run.task.toPromise();
    });

    it('ignores a configured model the provider no longer serves (#4455)', async () => {
      // A persisted id that has been renamed or retired must not reach
      // agent.setModel, which would reject it — fall back to the catalog.
      const run = harness(session(), undefined, undefined, {
        [OTHER_PROVIDER]: 'model-that-no-longer-exists',
      });
      run.setChat(chatLastAttemptedMessageSet(AGENT, { text: 'retry me', options: {} }));

      const retry = agentSessionRetryWithProviderRequested(AGENT, WS, OTHER_PROVIDER);
      run.channel.put(retry);
      await expect(retry.promise).resolves.toBeUndefined();

      expect(mocks.setModel).toHaveBeenCalledWith(AGENT, 'gpt-5-codex', WS, OTHER_PROVIDER);
      run.task.cancel();
      await run.task.toPromise();
    });

    it('falls back to the first catalog row when no model is flagged default', async () => {
      mocks.getModelsForProvider.mockResolvedValue({
        models: [
          { value: 'gpt-5-mini', label: 'Mini' },
          { value: 'gpt-5-codex', label: 'Codex' },
        ],
      });
      const run = harness();

      const retry = agentSessionRetryWithProviderRequested(AGENT, WS, OTHER_PROVIDER);
      run.channel.put(retry);
      await expect(retry.promise).resolves.toBeUndefined();

      expect(mocks.setModel).toHaveBeenCalledWith(AGENT, 'gpt-5-mini', WS, OTHER_PROVIDER);
      run.task.cancel();
      await run.task.toPromise();
    });

    it.each([
      {
        mode: 'transport failure',
        result: { ok: false, error: 'IPC not available' },
        expected: 'IPC not available',
      },
      {
        mode: 'daemon rejection',
        result: { ok: true, data: { success: false, error: 'provider not installed' } },
        expected: 'provider not installed',
      },
    ])('does not redrive when setModel reports a $mode', async ({ result, expected }) => {
      mocks.setModel.mockResolvedValue(result);
      const run = harness();
      run.setChat(chatLastAttemptedMessageSet(AGENT, { text: 'retry me', options: {} }));

      const retry = agentSessionRetryWithProviderRequested(AGENT, WS, OTHER_PROVIDER);
      await expect(
        (async () => {
          run.channel.put(retry);
          return retry.promise;
        })(),
      ).rejects.toThrow(expected);

      expect(
        run.dispatch.mock.calls.filter(
          ([action]) => action.type === agentSessionRetryLastMessageRequested.type,
        ),
      ).toHaveLength(0);
      expect(mocks.send).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
      run.task.cancel();
      await run.task.toPromise();
    });

    it.each([
      {
        mode: 'an empty catalog',
        setup: () => mocks.getModelsForProvider.mockResolvedValue({ models: [] }),
      },
      {
        mode: 'a failed catalog fetch',
        setup: () => mocks.getModelsForProvider.mockRejectedValue(new Error('models.list failed')),
      },
    ])('never calls setModel on $mode', async ({ setup }) => {
      setup();
      const run = harness();
      run.setChat(chatLastAttemptedMessageSet(AGENT, { text: 'retry me', options: {} }));

      const retry = agentSessionRetryWithProviderRequested(AGENT, WS, OTHER_PROVIDER);
      run.channel.put(retry);
      // Resolves, not rejects: nothing was mutated, so this is a reported
      // no-op rather than a broken command.
      await expect(retry.promise).resolves.toBeUndefined();

      expect(mocks.setModel).not.toHaveBeenCalled();
      expect(
        run.dispatch.mock.calls.filter(
          ([action]) => action.type === agentSessionRetryLastMessageRequested.type,
        ),
      ).toHaveLength(0);
      await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
      run.task.cancel();
      await run.task.toPromise();
    });
  });
});
