import { describe, expect, it, vi } from 'vitest';
import { channel as createChannel, runSaga, stdChannel } from 'redux-saga';

const { reportStreamLifecycleSpy } = vi.hoisted(() => ({ reportStreamLifecycleSpy: vi.fn() }));

vi.mock('$lib/utils/stream-lifecycle-telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/utils/stream-lifecycle-telemetry')>()),
  reportStreamLifecycle: reportStreamLifecycleSpy,
}));

import type { AgentSession } from '$shared/types';
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

function session(): AgentSession {
  return {
    id: AGENT,
    workspaceId: WS,
    backendSessionId: AGENT,
    name: 'Agent',
    status: AgentStatus.Active,
    messages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as AgentSession;
}

function harness() {
  const channel = stdChannel();
  let agentSessions = agentSessionReducer(sessionInitialState, bulkUpsertSessions([session()]));
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
  };
}

describe('agentStreamSaga', () => {
  it('updates rich tool blocks in place, preserves order, and finalizes interrupted streams', async () => {
    reportStreamLifecycleSpy.mockClear();
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
    expect(run.messages()[0]?.contentBlocks).toEqual([
      { type: 'text', text: 'hello world' },
      {
        type: 'tool_use',
        id: 'tool-1',
        name: 'read',
        input: { path: 'second' },
        toolCallId: 'call-1',
      },
      { type: 'tool_result', tool_use_id: 'tool-1', output: 'done' },
    ]);
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
    expect(messageUpdates.map((action) => action.payload.slice(0, 2))).toEqual([
      [AGENT, 'msg-1'],
      [AGENT, 'msg-1'],
      [AGENT, 'msg-1'],
    ]);
    expect(reportStreamLifecycleSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stage: 'store',
        event: 'update-applied',
        callbackResult: 'observed',
        storeStreamState: 'idle',
        blockCount: 3,
      }),
    );
    run.task.cancel();
    await run.task.toPromise();
  });

  it('stamps interruptReason + interruptedBy (PROTOCOL §7.2) on a user preemption so the live row mirrors the persisted one', async () => {
    const run = harness();
    run.channel.put(agentStreamUpdateReceived({
      agentId: AGENT, workspaceId: WS, handlerSessionId: AGENT, source: 'sendMessage',
      eventType: 'started', assistantMessageId: 'msg-pu', assistantAppMessageId: 'app-pu',
      timestamp: 1, contentBlocks: [{ type: 'text', text: '' }],
    }));
    run.channel.put(agentStreamUpdateReceived({
      agentId: AGENT, workspaceId: WS, handlerSessionId: AGENT, source: 'sendMessage',
      eventType: 'complete', assistantMessageId: 'msg-pu', assistantAppMessageId: 'app-pu',
      stopReason: 'interrupted', interruptReason: 'preempted_by_message',
      interruptedBy: { kind: 'user' }, contentBlocks: [{ type: 'text', text: 'partial' }],
    }));
    await settle();

    expect(run.messages()[0]).toEqual(expect.objectContaining({
      id: 'msg-pu', isStreaming: false, streamingComplete: true,
      metadata: {
        interrupted: true, stopReason: 'interrupted',
        interruptReason: 'preempted_by_message', interruptedBy: { kind: 'user' },
      },
    }));
    run.task.cancel();
    await run.task.toPromise();
  });

  it('stamps interruptedBy agent attribution (PROTOCOL §7.2) on an agent preemption', async () => {
    const run = harness();
    run.channel.put(agentStreamUpdateReceived({
      agentId: AGENT, workspaceId: WS, handlerSessionId: AGENT, source: 'sendMessage',
      eventType: 'started', assistantMessageId: 'msg-pa', assistantAppMessageId: 'app-pa',
      timestamp: 1, contentBlocks: [{ type: 'text', text: '' }],
    }));
    run.channel.put(agentStreamUpdateReceived({
      agentId: AGENT, workspaceId: WS, handlerSessionId: AGENT, source: 'sendMessage',
      eventType: 'complete', assistantMessageId: 'msg-pa', assistantAppMessageId: 'app-pa',
      stopReason: 'interrupted', interruptReason: 'preempted_by_message',
      interruptedBy: { kind: 'agent', agentId: 'agent-child', name: 'Child' },
      contentBlocks: [{ type: 'text', text: 'partial' }],
    }));
    await settle();

    expect(run.messages()[0]).toEqual(expect.objectContaining({
      id: 'msg-pa', isStreaming: false, streamingComplete: true,
      metadata: {
        interrupted: true, stopReason: 'interrupted',
        interruptReason: 'preempted_by_message',
        interruptedBy: { kind: 'agent', agentId: 'agent-child', name: 'Child' },
      },
    }));
    run.task.cancel();
    await run.task.toPromise();
  });

  it('does not stamp interruptReason/interruptedBy on a normal completion', async () => {
    const run = harness();
    run.channel.put(agentStreamUpdateReceived({
      agentId: AGENT, workspaceId: WS, handlerSessionId: AGENT, source: 'sendMessage',
      eventType: 'started', assistantMessageId: 'msg-ok', assistantAppMessageId: 'app-ok',
      timestamp: 1, contentBlocks: [{ type: 'text', text: '' }],
    }));
    run.channel.put(agentStreamUpdateReceived({
      agentId: AGENT, workspaceId: WS, handlerSessionId: AGENT, source: 'sendMessage',
      eventType: 'complete', assistantMessageId: 'msg-ok', assistantAppMessageId: 'app-ok',
      contentBlocks: [{ type: 'text', text: 'done' }],
    }));
    await settle();

    const message = run.messages()[0];
    expect(message).toEqual(expect.objectContaining({
      id: 'msg-ok', isStreaming: false, streamingComplete: true,
    }));
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
    expect(run.messages()[0]).toMatchObject({
      id: 'good',
      isStreaming: false,
      streamingComplete: true,
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
    const run = harness();
    run.channel.put(
      agentStreamUpdateReceived({
        agentId: AGENT,
        workspaceId: WS,
        handlerSessionId: AGENT,
        source: 'restored',
        eventType: 'started',
        assistantMessageId: `msg-${eventType}`,
        contentBlocks: [{ type: 'text', text: 'partial' }],
      }),
    );
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
        contentBlocks: [{ type: 'text', text: 'partial' }],
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
