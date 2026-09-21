import { beforeEach, describe, expect, it, vi } from 'vitest';
import { channel as createChannel, runSaga, stdChannel } from 'redux-saga';

const { reportStreamLifecycleSpy } = vi.hoisted(() => ({ reportStreamLifecycleSpy: vi.fn() }));

vi.mock('$lib/utils/stream-lifecycle-telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/utils/stream-lifecycle-telemetry')>()),
  reportStreamLifecycle: reportStreamLifecycleSpy,
}));

import {
  clearAllStandingChatSubscriptions,
  markStandingChatSubscription,
} from '$features/agent/utils/chat-subscription-registry';
import type { AgentMessage, AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import {
  agentSessionReducer,
  bulkUpsertSessions,
  initialState as sessionInitialState,
} from '../agent-session-slice';
import {
  chatStateReducer,
  initialState as chatInitialState,
  streamCompleted,
  streamTimedOut,
} from '../../chat-state/chat-state-slice';
import { agentStreamUpdateReceived } from '../../workspace-agents/workspace-agents-stream-slice';
import { agentStreamSaga } from './agent-stream-saga';

const WS = 'ws-stream';
const AGENT = 'agent-stream';
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function session(messages: AgentMessage[] = []): AgentSession {
  return {
    id: AGENT,
    workspaceId: WS,
    backendSessionId: AGENT,
    name: 'Agent',
    status: AgentStatus.Active,
    messages,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as AgentSession;
}

/**
 * Runs the saga against an in-memory store. `covered` (default) installs a
 * standing chat.subscribe marker for the agent — the only configuration under
 * which the saga touches transcript rows.
 */
function harness({
  covered = true,
  messages = [],
}: { covered?: boolean; messages?: AgentMessage[] } = {}) {
  if (covered) markStandingChatSubscription(AGENT);
  const channel = stdChannel();
  let agentSessions = agentSessionReducer(
    sessionInitialState,
    bulkUpsertSessions([session(messages)]),
  );
  let chatState = chatInitialState;
  const dispatch = vi.fn((action) => {
    agentSessions = agentSessionReducer(agentSessions, action);
    chatState = chatStateReducer(chatState, action);
  });
  const task = runSaga(
    { channel, dispatch, getState: () => ({ agentSessions, chatState }) },
    agentStreamSaga,
  );
  return {
    channel,
    dispatch,
    task,
    messages: () => agentSessions.byAgentId[AGENT]?.messages ?? [],
    rowWrites: () =>
      dispatch.mock.calls
        .map(([action]) => action)
        .filter(
          (action) =>
            action.type === 'agentSessions/addMessage' ||
            action.type === 'agentSessions/updateMessage',
        ),
  };
}

describe('agentStreamSaga', () => {
  beforeEach(() => {
    clearAllStandingChatSubscriptions();
    reportStreamLifecycleSpy.mockClear();
  });

  it('keeps streaming flags and stamps interrupted metadata for a covered agent without applying firehose blocks', async () => {
    const run = harness();
    run.channel.put(
      agentStreamUpdateReceived({
        agentId: AGENT,
        workspaceId: WS,
        handlerSessionId: AGENT,
        source: 'sendMessage',
        eventType: 'started',
        assistantMessageId: 'msg-1',
        assistantAppMessageId: 'app-1',
        timestamp: 1,
        contentBlocks: [{ type: 'text', text: '' }],
      }),
    );
    run.channel.put(
      agentStreamUpdateReceived({
        agentId: AGENT,
        workspaceId: WS,
        handlerSessionId: AGENT,
        source: 'sendMessage',
        eventType: 'content-blocks',
        assistantMessageId: 'msg-1',
        assistantAppMessageId: 'app-1',
        contentBlocks: [
          { type: 'text', text: 'hello' },
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'read',
            input: { path: 'first' },
            toolCallId: 'call-1',
          },
        ],
      }),
    );
    run.channel.put(
      agentStreamUpdateReceived({
        agentId: AGENT,
        workspaceId: WS,
        handlerSessionId: AGENT,
        source: 'sendMessage',
        eventType: 'content-blocks',
        assistantMessageId: 'msg-1',
        assistantAppMessageId: 'app-1',
        contentBlocks: [
          { type: 'text', text: 'hello world' },
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'read',
            input: { path: 'second' },
            toolCallId: 'call-1',
          },
          { type: 'tool_result', tool_use_id: 'tool-1', output: 'done' },
        ],
      }),
    );
    run.channel.put(
      agentStreamUpdateReceived({
        agentId: AGENT,
        workspaceId: WS,
        handlerSessionId: AGENT,
        source: 'sendMessage',
        eventType: 'complete',
        assistantMessageId: 'msg-1',
        assistantAppMessageId: 'app-1',
        stopReason: 'interrupted',
        interruptReason: 'user_stop',
        contentBlocks: [
          { type: 'text', text: 'hello world' },
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'read',
            input: { path: 'second' },
            toolCallId: 'call-1',
          },
          { type: 'tool_result', tool_use_id: 'tool-1', output: 'done' },
        ],
      }),
    );
    await settle();

    expect(run.messages()).toHaveLength(1);
    expect(run.messages()[0]?.contentBlocks).toEqual([]);
    expect(run.messages()[0]).toEqual(
      expect.objectContaining({
        id: 'msg-1',
        appMessageId: 'app-1',
        isStreaming: false,
        streamingComplete: true,
        metadata: { interrupted: true, stopReason: 'interrupted', interruptReason: 'user_stop' },
      }),
    );
    const messageUpdates = run.dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action.type === 'agentSessions/updateMessage');
    expect(messageUpdates.map((action) => action.payload.slice(0, 2))).toEqual([[AGENT, 'msg-1']]);
    expect(reportStreamLifecycleSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stage: 'store',
        event: 'update-applied',
        callbackResult: 'observed',
        storeStreamState: 'idle',
        blockCount: 0,
      }),
    );
    run.task.cancel();
    await run.task.toPromise();
  });

  describe('agent without a standing chat subscription', () => {
    const canonical: AgentMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'question' }],
        timestamp: '2026-01-01T00:00:01.000Z',
      },
      {
        id: 'msg-1',
        appMessageId: 'app-1',
        role: 'assistant',
        contentBlocks: [{ type: 'text', text: 'canonical answer' }],
        timestamp: '2026-01-01T00:00:02.000Z',
        isStreaming: true,
        streamingComplete: false,
      },
    ];
    const firehoseBlocks = [
      {
        type: 'tool_use' as const,
        id: 'tool-1',
        name: 'read',
        input: { path: 'first' },
        toolCallId: 'call-1',
      },
    ];

    it.each([
      ['content-blocks', undefined],
      ['complete', streamCompleted(AGENT, { lastAttemptedMessage: null, modelUnavailable: null })],
      ['error', streamCompleted(AGENT, { lastAttemptedMessage: null, modelUnavailable: null })],
      ['timeout', streamTimedOut(AGENT)],
    ] as const)(
      'writes no row on %s for an existing or a new target, but still clears session streaming',
      async (eventType, expectedAction) => {
        const run = harness({ covered: false, messages: canonical });
        run.channel.put(
          agentStreamUpdateReceived({
            agentId: AGENT,
            workspaceId: WS,
            handlerSessionId: AGENT,
            source: 'sendMessage',
            eventType,
            assistantMessageId: 'msg-1',
            assistantAppMessageId: 'app-1',
            timestamp: 3,
            contentBlocks: firehoseBlocks,
            ...(eventType === 'error' ? { error: 'failed' } : {}),
          }),
        );
        run.channel.put(
          agentStreamUpdateReceived({
            agentId: AGENT,
            workspaceId: WS,
            handlerSessionId: AGENT,
            source: 'sendMessage',
            eventType,
            assistantMessageId: 'msg-2',
            assistantAppMessageId: 'app-2',
            timestamp: 4,
            stopReason: eventType === 'complete' ? 'interrupted' : undefined,
            contentBlocks: firehoseBlocks,
            ...(eventType === 'error' ? { error: 'failed' } : {}),
          }),
        );
        await settle();

        expect(run.rowWrites()).toEqual([]);
        expect(run.messages()).toEqual(canonical);
        if (expectedAction) {
          expect(run.dispatch).toHaveBeenCalledWith(expectedAction);
        } else {
          expect(run.dispatch).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'chatState/streamCompleted' }),
          );
          expect(run.dispatch).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'chatState/streamTimedOut' }),
          );
        }
        expect(reportStreamLifecycleSpy).toHaveBeenCalledTimes(2);
        expect(reportStreamLifecycleSpy).toHaveBeenLastCalledWith(
          expect.objectContaining({
            stage: 'store',
            event: 'update-ignored',
            callbackResult: 'ignored',
          }),
        );
        run.task.cancel();
        await run.task.toPromise();
      },
    );

    it('writes no placeholder on started for an agent never opened in this session', async () => {
      const run = harness({ covered: false });
      run.channel.put(
        agentStreamUpdateReceived({
          agentId: AGENT,
          workspaceId: WS,
          handlerSessionId: AGENT,
          source: 'sendMessage',
          eventType: 'started',
          assistantMessageId: 'msg-1',
          assistantAppMessageId: 'app-1',
          timestamp: 1,
          contentBlocks: [{ type: 'text', text: '' }],
        }),
      );
      await settle();

      expect(run.rowWrites()).toEqual([]);
      expect(run.messages()).toEqual([]);
      run.task.cancel();
      await run.task.toPromise();
    });

    it('drops the terminal flush buffered across cancellation without writing a row', async () => {
      const run = harness({ covered: false, messages: canonical });
      run.channel.put(
        agentStreamUpdateReceived({
          agentId: AGENT,
          workspaceId: WS,
          handlerSessionId: AGENT,
          source: 'sendMessage',
          eventType: 'complete',
          assistantMessageId: 'msg-1',
          assistantAppMessageId: 'app-1',
          contentBlocks: firehoseBlocks,
        }),
      );
      run.task.cancel();
      await run.task.toPromise();

      expect(run.rowWrites()).toEqual([]);
      expect(run.messages()).toEqual(canonical);
      expect(run.dispatch).toHaveBeenCalledWith(
        streamCompleted(AGENT, { lastAttemptedMessage: null, modelUnavailable: null }),
      );
    });
  });

  it('stamps interruptReason + interruptedBy (PROTOCOL §7.2) on a user preemption so the live row mirrors the persisted one', async () => {
    const run = harness();
    run.channel.put(
      agentStreamUpdateReceived({
        agentId: AGENT,
        workspaceId: WS,
        handlerSessionId: AGENT,
        source: 'sendMessage',
        eventType: 'started',
        assistantMessageId: 'msg-pu',
        assistantAppMessageId: 'app-pu',
        timestamp: 1,
        contentBlocks: [{ type: 'text', text: '' }],
      }),
    );
    run.channel.put(
      agentStreamUpdateReceived({
        agentId: AGENT,
        workspaceId: WS,
        handlerSessionId: AGENT,
        source: 'sendMessage',
        eventType: 'complete',
        assistantMessageId: 'msg-pu',
        assistantAppMessageId: 'app-pu',
        stopReason: 'interrupted',
        interruptReason: 'preempted_by_message',
        interruptedBy: { kind: 'user' },
        contentBlocks: [{ type: 'text', text: 'partial' }],
      }),
    );
    await settle();

    expect(run.messages()[0]).toEqual(
      expect.objectContaining({
        id: 'msg-pu',
        isStreaming: false,
        streamingComplete: true,
        metadata: {
          interrupted: true,
          stopReason: 'interrupted',
          interruptReason: 'preempted_by_message',
          interruptedBy: { kind: 'user' },
        },
      }),
    );
    run.task.cancel();
    await run.task.toPromise();
  });

  it('stamps interruptedBy agent attribution (PROTOCOL §7.2) on an agent preemption', async () => {
    const run = harness();
    run.channel.put(
      agentStreamUpdateReceived({
        agentId: AGENT,
        workspaceId: WS,
        handlerSessionId: AGENT,
        source: 'sendMessage',
        eventType: 'started',
        assistantMessageId: 'msg-pa',
        assistantAppMessageId: 'app-pa',
        timestamp: 1,
        contentBlocks: [{ type: 'text', text: '' }],
      }),
    );
    run.channel.put(
      agentStreamUpdateReceived({
        agentId: AGENT,
        workspaceId: WS,
        handlerSessionId: AGENT,
        source: 'sendMessage',
        eventType: 'complete',
        assistantMessageId: 'msg-pa',
        assistantAppMessageId: 'app-pa',
        stopReason: 'interrupted',
        interruptReason: 'preempted_by_message',
        interruptedBy: { kind: 'agent', agentId: 'agent-child', name: 'Child' },
        contentBlocks: [{ type: 'text', text: 'partial' }],
      }),
    );
    await settle();

    expect(run.messages()[0]).toEqual(
      expect.objectContaining({
        id: 'msg-pa',
        isStreaming: false,
        streamingComplete: true,
        metadata: {
          interrupted: true,
          stopReason: 'interrupted',
          interruptReason: 'preempted_by_message',
          interruptedBy: { kind: 'agent', agentId: 'agent-child', name: 'Child' },
        },
      }),
    );
    run.task.cancel();
    await run.task.toPromise();
  });

  it('does not stamp interruptReason/interruptedBy on a normal completion', async () => {
    // Seed an UNFLAGGED in-flight row so the assertion below proves the
    // firehose complete setter adds `provisional` rather than inheriting it
    // from a `started` placeholder.
    const run = harness({
      messages: [
        {
          id: 'msg-ok',
          appMessageId: 'app-ok',
          role: 'assistant',
          contentBlocks: [{ type: 'text', text: 'partial' }],
          timestamp: '2026-01-01T00:00:01.000Z',
          isStreaming: true,
          streamingComplete: false,
        },
      ],
    });
    expect(run.messages()[0]?.provisional).toBeUndefined();
    run.channel.put(
      agentStreamUpdateReceived({
        agentId: AGENT,
        workspaceId: WS,
        handlerSessionId: AGENT,
        source: 'sendMessage',
        eventType: 'complete',
        assistantMessageId: 'msg-ok',
        assistantAppMessageId: 'app-ok',
        contentBlocks: [{ type: 'text', text: 'done' }],
      }),
    );
    await settle();

    const message = run.messages()[0];
    // The firehose, not the §7.1 terminal frame, settled the existing row.
    expect(message).toEqual(
      expect.objectContaining({
        id: 'msg-ok',
        isStreaming: false,
        streamingComplete: true,
        provisional: true,
      }),
    );
    expect(message?.metadata?.interrupted).toBeUndefined();
    expect(message?.metadata?.interruptReason).toBeUndefined();
    expect(message?.metadata?.interruptedBy).toBeUndefined();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('stamps metadata.finishReason on a finalized abnormal turn (PROTOCOL §7.3) without interrupted markers', async () => {
    const run = harness();
    run.channel.put(
      agentStreamUpdateReceived({
        agentId: AGENT,
        workspaceId: WS,
        handlerSessionId: AGENT,
        source: 'sendMessage',
        eventType: 'started',
        assistantMessageId: 'msg-fr',
        assistantAppMessageId: 'app-fr',
        timestamp: 1,
        contentBlocks: [{ type: 'text', text: '' }],
      }),
    );
    run.channel.put(
      agentStreamUpdateReceived({
        agentId: AGENT,
        workspaceId: WS,
        handlerSessionId: AGENT,
        source: 'sendMessage',
        eventType: 'complete',
        assistantMessageId: 'msg-fr',
        assistantAppMessageId: 'app-fr',
        finishReason: 'max_tokens',
        contentBlocks: [{ type: 'text', text: 'partial' }],
      }),
    );
    await settle();

    expect(run.messages()[0]).toEqual(
      expect.objectContaining({
        id: 'msg-fr',
        isStreaming: false,
        streamingComplete: true,
        metadata: { finishReason: 'max_tokens' },
      }),
    );
    run.task.cancel();
    await run.task.toPromise();
  });

  it('merges interrupted metadata AND finishReason when the terminal payload carries both', async () => {
    const run = harness();
    run.channel.put(
      agentStreamUpdateReceived({
        agentId: AGENT,
        workspaceId: WS,
        handlerSessionId: AGENT,
        source: 'sendMessage',
        eventType: 'started',
        assistantMessageId: 'msg-both',
        assistantAppMessageId: 'app-both',
        timestamp: 1,
        contentBlocks: [{ type: 'text', text: '' }],
      }),
    );
    run.channel.put(
      agentStreamUpdateReceived({
        agentId: AGENT,
        workspaceId: WS,
        handlerSessionId: AGENT,
        source: 'sendMessage',
        eventType: 'complete',
        assistantMessageId: 'msg-both',
        assistantAppMessageId: 'app-both',
        stopReason: 'interrupted',
        finishReason: 'refusal',
        contentBlocks: [{ type: 'text', text: 'partial' }],
      }),
    );
    await settle();

    expect(run.messages()[0]).toEqual(
      expect.objectContaining({
        id: 'msg-both',
        isStreaming: false,
        streamingComplete: true,
        metadata: { interrupted: true, stopReason: 'interrupted', finishReason: 'refusal' },
      }),
    );
    run.task.cancel();
    await run.task.toPromise();
  });

  it('isolates malformed events and still applies the following terminal event', async () => {
    const run = harness();
    run.channel.put(
      agentStreamUpdateReceived({
        agentId: AGENT,
        workspaceId: WS,
        handlerSessionId: AGENT,
        source: 'restored',
        eventType: 'started',
        assistantMessageId: 'bad',
        timestamp: Number.NaN,
      }),
    );
    run.channel.put(
      agentStreamUpdateReceived({
        agentId: AGENT,
        workspaceId: WS,
        handlerSessionId: AGENT,
        source: 'restored',
        eventType: 'complete',
        assistantMessageId: 'good',
        timestamp: 2,
        contentBlocks: [{ type: 'text', text: 'final' }],
      }),
    );
    await settle();

    expect(run.messages()).toHaveLength(1);
    // No row existed for `good`: the covered-path placeholder is provisional
    // until the §7.1 reconcile replaces it by id.
    expect(run.messages()[0]).toMatchObject({
      id: 'good',
      isStreaming: false,
      streamingComplete: true,
      provisional: true,
    });
    expect(
      run.dispatch.mock.calls.some(([action]) => action.type === 'chatState/streamCompleted'),
    ).toBe(true);
    run.task.cancel();
    await run.task.toPromise();
  });

  it.each([
    ['error', streamCompleted(AGENT, { lastAttemptedMessage: null, modelUnavailable: null })],
    ['timeout', streamTimedOut(AGENT)],
  ] as const)('finalizes an existing message on %s', async (eventType, expectedAction) => {
    // Seed an UNFLAGGED in-flight row so the assertion below proves the
    // error/timeout setter adds `provisional` itself.
    const partial = [{ type: 'text' as const, text: 'partial' }];
    const run = harness({
      messages: [
        {
          id: `msg-${eventType}`,
          role: 'assistant',
          contentBlocks: partial,
          timestamp: '2026-01-01T00:00:01.000Z',
          isStreaming: true,
          streamingComplete: false,
        },
      ],
    });
    expect(run.messages()[0]?.provisional).toBeUndefined();
    run.channel.put(
      agentStreamUpdateReceived({
        agentId: AGENT,
        workspaceId: WS,
        handlerSessionId: AGENT,
        source: 'restored',
        eventType,
        assistantMessageId: `msg-${eventType}`,
        error: eventType === 'error' ? 'failed' : undefined,
      }),
    );
    await settle();

    expect(run.messages()[0]).toEqual(
      expect.objectContaining({
        id: `msg-${eventType}`,
        isStreaming: false,
        streamingComplete: true,
        provisional: true,
        contentBlocks: partial,
      }),
    );
    expect(run.dispatch).toHaveBeenCalledWith(expectedAction);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('drains a terminal event already buffered when cancellation starts', () => {
    const generator = agentStreamSaga();
    generator.next();
    const bufferedChannel = createChannel();
    generator.next(bufferedChannel as never);
    const started = agentStreamUpdateReceived({
      agentId: AGENT,
      workspaceId: WS,
      handlerSessionId: AGENT,
      source: 'restored',
      eventType: 'started',
      assistantMessageId: 'msg-cancelled',
      contentBlocks: [{ type: 'text', text: 'partial' }],
    });
    generator.next(started);
    const terminal = agentStreamUpdateReceived({
      agentId: AGENT,
      workspaceId: WS,
      handlerSessionId: AGENT,
      source: 'restored',
      eventType: 'complete',
      assistantMessageId: 'msg-cancelled',
      contentBlocks: [{ type: 'text', text: 'terminal' }],
    });
    bufferedChannel.put(terminal);

    const cleanup = generator.return(undefined);
    expect(cleanup.value).toMatchObject({
      type: 'FLUSH',
      payload: bufferedChannel,
    });
    let buffered: unknown[] = [];
    bufferedChannel.flush((items) => {
      buffered = items;
    });
    const drained = generator.next(buffered as never);
    expect(drained.value).toMatchObject({
      type: 'CALL',
      payload: { args: [terminal.payload[0]] },
    });
  });
});
