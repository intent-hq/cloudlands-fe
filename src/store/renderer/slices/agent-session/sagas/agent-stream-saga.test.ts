/**
 * Tests for handleStreamingSafetyCheck.
 *
 * Regression (Task B): the saga must NOT fall back to selectActiveWorkspaceId
 * when session.workspaceId is missing. Falling back would land stale flags
 * in a workspace the agent doesn't belong to.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { runSaga } from 'redux-saga';
import * as sagaEffects from 'redux-saga/effects';
import type { AgentSession, AgentMessage, ContentBlock } from '$shared/types';

const { invokeMock, loadSessionMock, ensureStreamHandlerMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async () => ({ success: true, data: [] })),
  loadSessionMock: vi.fn(async () => null),
  ensureStreamHandlerMock: vi.fn(),
}));

vi.stubGlobal('window', {
  dispatchEvent: vi.fn(),
  CustomEvent: class CustomEvent {
    constructor(public type: string) {}
  },
});

vi.mock('typed-redux-saga', () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  delay: function* (ms: any) {
    return yield sagaEffects.delay(ms);
  },
  takeLatest: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeLatest(pattern, worker);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: invokeMock,
}));

vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('$lib/logging/logger.svelte', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
  LogCategory: { AGENT: 'AGENT' },
}));

vi.mock('$features/agent/agent-stream-lifecycle', () => ({
  ensureStreamHandler: ensureStreamHandlerMock,
}));

vi.mock('$features/agent/browser', () => ({
  persistenceService: { loadSession: loadSessionMock },
}));

vi.mock('$features/agent/utils/pick-placeholder-id', () => ({
  pickPlaceholderId: (_id: string | undefined, _messages: any[]) => 'msg_fallback',
}));

vi.mock('$shared/utils/app-message-id', () => ({
  createAppMessageId: () => 'app_fallback',
}));

vi.mock('../../workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: { select: () => 'ws-B-active' },
}));

// Import after mocks
import {
  agentStreamSaga,
  handleAgentStreamResetStreamingMessages,
  handleAgentStreamUpdate,
  handleBackendStreamsReconnectResult,
  handleStreamingSafetyCheck,
} from './agent-stream-saga';
import {
  agentStreamResetStreamingMessagesRequested,
  agentStreamUpdateReceived,
  backendStreamsReconnectResultReceived,
  reconnectStreamHandlersForWorkspaceRequested,
  triggerStreamingSafetyCheck,
} from '../../workspace-agents/workspace-agents-slice';
import {
  addMessage as addAgentSessionMessage,
  replaceMessages,
  setAgentStreaming,
  updateSession as updateAgentSessionAction,
  updateMessage,
  upsertSession,
} from '../agent-session-slice';
import { newAssistantMessage } from '../../unread-tracking/unread-tracking-slice';

type State = {
  agentSessions: { byAgentId: Record<string, AgentSession> };
  workspaceAgents: { byWorkspaceId: Record<string, { agentIds: string[] }> };
};

function expectNoDuplicateNonEmptyAppMessageIds(messages: AgentMessage[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const message of messages) {
    if (!message.appMessageId) continue;
    if (seen.has(message.appMessageId)) duplicates.add(message.appMessageId);
    seen.add(message.appMessageId);
  }
  expect([...duplicates]).toEqual([]);
}

function makeState(
  session: AgentSession,
  wsHolding: string = session.workspaceId || 'ws-A',
): State {
  return {
    agentSessions: { byAgentId: { [session.id as string]: session } },
    workspaceAgents: { byWorkspaceId: { [wsHolding]: { agentIds: [session.id as string] } } },
  };
}

const triggerAction = triggerStreamingSafetyCheck(['agent-1']);

describe('handleStreamingSafetyCheck — Task B regression', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockClear();
    invokeMock.mockImplementation(async () => ({ success: true, data: [] }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes to session.workspaceId (A), never to active workspace (B)', async () => {
    const session: AgentSession = {
      id: 'agent-1',
      name: 'Agent',
      workspaceId: 'ws-A' as any,
      messages: [],
      isStreaming: true,
      isProcessing: true,
    } as AgentSession;
    const state = makeState(session, 'ws-A');

    const dispatched: any[] = [];
    const task = runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => state },
      handleStreamingSafetyCheck,
      triggerAction,
    );
    await vi.advanceTimersByTimeAsync(11_000);
    await task.toPromise();

    const streamingActions = dispatched.filter((a) => a.type === setAgentStreaming.type);
    expect(streamingActions).toHaveLength(1);
    expect(streamingActions[0].payload).toEqual(['agent-1', false]);
    expect(streamingActions[0].payload).not.toContain('ws-B-active');

    const wsUpserts = dispatched.filter((a) => a.type === upsertSession.type);
    expect(wsUpserts).toHaveLength(1);
    expect(wsUpserts.every((a) => a.payload[0].workspaceId === 'ws-A')).toBe(true);
    expect(wsUpserts.every((a) => a.payload[0].workspaceId !== 'ws-B-active')).toBe(true);
  });

  it('skips when session.workspaceId is missing — no state change lands on workspace B', async () => {
    const session: AgentSession = {
      id: 'agent-1',
      name: 'Agent',
      workspaceId: '' as any,
      messages: [],
      isStreaming: true,
      isProcessing: true,
    } as AgentSession;
    // The session lives under "ws-A" in workspaceAgents.byWorkspaceId but its
    // session.workspaceId is empty. Active workspace is "ws-B-active".
    const state = makeState(session, 'ws-A');

    const dispatched: any[] = [];
    const task = runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => state },
      handleStreamingSafetyCheck,
      triggerAction,
    );
    await vi.advanceTimersByTimeAsync(11_000);
    await task.toPromise();

    // No setAgentStreaming / session upsert dispatches at all
    expect(dispatched.filter((a) => a.type === setAgentStreaming.type)).toHaveLength(0);
    expect(dispatched.filter((a) => a.type === upsertSession.type)).toHaveLength(0);
    // And definitely nothing touched workspace B
    expect(dispatched.some((a) => JSON.stringify(a.payload ?? '').includes('ws-B-active'))).toBe(
      false,
    );
  });

  it('only considers confirmed active agent IDs from the safety-check action', async () => {
    const session: AgentSession = {
      id: 'agent-1',
      name: 'Agent',
      workspaceId: 'ws-A' as any,
      messages: [],
      isStreaming: true,
      isProcessing: true,
    } as AgentSession;
    const unrelatedSession: AgentSession = {
      id: 'agent-unrelated',
      name: 'Unrelated Agent',
      workspaceId: 'ws-A' as any,
      messages: [],
      isStreaming: true,
      isProcessing: true,
    } as AgentSession;
    const state = {
      agentSessions: {
        byAgentId: {
          'agent-1': session,
          'agent-unrelated': unrelatedSession,
        },
      },
      workspaceAgents: { byWorkspaceId: { 'ws-A': { agentIds: ['agent-1', 'agent-unrelated'] } } },
    };

    const dispatched: any[] = [];
    const task = runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => state },
      handleStreamingSafetyCheck,
      triggerStreamingSafetyCheck(['agent-1']),
    );
    await vi.advanceTimersByTimeAsync(11_000);
    await task.toPromise();

    expect(dispatched.filter((a) => a.type === setAgentStreaming.type)).toEqual([
      setAgentStreaming('agent-1', false),
    ]);
    expect(dispatched.some((a) => JSON.stringify(a.payload ?? '').includes('agent-unrelated'))).toBe(
      false,
    );
  });
});

describe('handleAgentStreamUpdate — content-hash fallback target matching', () => {
  beforeEach(() => {
    loadSessionMock.mockClear();
    loadSessionMock.mockResolvedValue(null);
  });

  it('complete event matches existing message via content-hash when IDs diverge', async () => {
    // Simulates the race: local placeholder has a UUID id, streaming flag already
    // cleared, but the content matches the complete event's payload.
    const existingMessage: AgentMessage = {
      id: 'local-uuid-placeholder',
      appMessageId: 'app_local',
      role: 'assistant',
      timestamp: '2026-05-08T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'Hello world' }],
      isStreaming: false,
      streamingComplete: false,
    } as AgentMessage;
    const session: AgentSession = {
      id: 'agent-content-hash',
      name: 'Agent',
      workspaceId: 'ws-A' as any,
      messages: [existingMessage],
      isStreaming: false,
    } as AgentSession;
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => makeState(session, 'ws-A') },
      handleAgentStreamUpdate,
      agentStreamUpdateReceived({
        workspaceId: 'ws-A',
        agentId: 'agent-content-hash',
        handlerSessionId: 'agent-content-hash',
        source: 'restored',
        eventType: 'complete',
        assistantMessageId: 'msg_canonical',
        assistantAppMessageId: 'app_canonical',
        contentBlocks: [{ type: 'text', text: 'Hello world' }],
        completeMessage: {
          id: 'msg_canonical',
          role: 'assistant',
          appMessageId: 'app_canonical',
          timestamp: '2026-05-08T00:00:01.000Z',
          contentBlocks: [{ type: 'text', text: 'Hello world' }],
        },
      }),
    ).toPromise();

    // Should complete via the content-hash match — no disk refresh needed
    expect(loadSessionMock).not.toHaveBeenCalled();
    // The message list should be replaced (id changed from placeholder to canonical)
    const replaceActions = dispatched.filter((a) => a.type === replaceMessages.type);
    expect(replaceActions).toHaveLength(1);
    // Streaming should be cleared
    expect(dispatched.some((a) => a.type === setAgentStreaming.type && a.payload[1] === false)).toBe(true);
  });
});

describe('handleAgentStreamUpdate — saga-owned missing target reconciliation', () => {
  beforeEach(() => {
    loadSessionMock.mockClear();
    loadSessionMock.mockResolvedValue(null);
  });

  it('sendMessage missing target refreshes bypassing cache before saga fallback', async () => {
    const session: AgentSession = {
      id: 'agent-send-missing',
      name: 'Agent',
      workspaceId: 'ws-A' as any,
      messages: [],
      isStreaming: true,
    } as AgentSession;
    const state = makeState(session, 'ws-A');
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => state },
      handleAgentStreamUpdate,
      agentStreamUpdateReceived({
        workspaceId: 'ws-A',
        agentId: 'agent-send-missing',
        handlerSessionId: 'agent-send-missing',
        source: 'sendMessage',
        eventType: 'chunk',
        assistantMessageId: 'msg_missing',
        assistantAppMessageId: 'app_missing',
        contentBlocks: [{ type: 'text', text: 'hello' }],
      }),
    ).toPromise();

    expect(loadSessionMock).toHaveBeenCalledWith('agent-send-missing', 'ws-A', {
      bypassCache: true,
    });
    const fallback = dispatched.find((a) => a.type === replaceMessages.type);
    expect(fallback?.payload[0]).toBe('agent-send-missing');
    expect(fallback?.payload[1]).toMatchObject([
      {
        id: 'msg_fallback',
        appMessageId: 'app_missing',
        role: 'assistant',
        isStreaming: true,
        contentBlocks: [{ type: 'text', text: 'hello' }],
      },
    ]);
  });

  it('updates an existing target for normal sendMessage chunks', async () => {
    const streamingMessage: AgentMessage = {
      id: 'msg_streaming',
      appMessageId: 'app_streaming',
      role: 'assistant',
      timestamp: '2026-05-08T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'h' }],
      isStreaming: true,
    } as AgentMessage;
    const session: AgentSession = {
      id: 'agent-normal-chunk',
      name: 'Agent',
      workspaceId: 'ws-A' as any,
      messages: [
        streamingMessage,
      ],
      isStreaming: true,
    } as AgentSession;
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => makeState(session, 'ws-A') },
      handleAgentStreamUpdate,
      agentStreamUpdateReceived({
        workspaceId: 'ws-A',
        agentId: 'agent-normal-chunk',
        handlerSessionId: 'agent-normal-chunk',
        source: 'sendMessage',
        eventType: 'chunk',
        assistantMessageId: 'msg_streaming',
        assistantAppMessageId: 'app_streaming',
        contentBlocks: [{ type: 'text', text: 'hello' }],
      }),
    ).toPromise();

    expect(dispatched.filter((a) => a.type === updateMessage.type)).toEqual([
      expect.objectContaining({
        payload: [
          'agent-normal-chunk',
          'msg_streaming',
          expect.objectContaining({
            appMessageId: 'app_streaming',
            contentBlocks: [{ type: 'text', text: 'hello' }],
            isStreaming: true,
            streamingComplete: false,
          }),
        ],
      }),
    ]);
    expect(dispatched.filter((a) => a.type === replaceMessages.type)).toHaveLength(0);
    expect(loadSessionMock).not.toHaveBeenCalled();
  });

  it('prefers an exact assistant message ID over an earlier streaming fallback target', async () => {
    const staleStreamingMessage: AgentMessage = {
      id: 'msg_stale_streaming',
      appMessageId: 'app_stale_streaming',
      role: 'assistant',
      timestamp: '2026-05-08T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'stale' }],
      isStreaming: true,
    } as AgentMessage;
    const exactMessage: AgentMessage = {
      id: 'msg_exact_target',
      appMessageId: 'app_exact_target',
      role: 'assistant',
      timestamp: '2026-05-08T00:00:01.000Z',
      contentBlocks: [{ type: 'text', text: 'old' }],
      isStreaming: false,
    } as AgentMessage;
    const session: AgentSession = {
      id: 'agent-exact-message-target',
      name: 'Agent',
      workspaceId: 'ws-A' as any,
      messages: [
        staleStreamingMessage,
        exactMessage,
      ],
      isStreaming: true,
    } as AgentSession;
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => makeState(session, 'ws-A') },
      handleAgentStreamUpdate,
      agentStreamUpdateReceived({
        workspaceId: 'ws-A',
        agentId: 'agent-exact-message-target',
        handlerSessionId: 'agent-exact-message-target',
        source: 'sendMessage',
        eventType: 'chunk',
        assistantMessageId: 'msg_exact_target',
        contentBlocks: [{ type: 'text', text: 'new exact' }],
      }),
    ).toPromise();

    expect(dispatched.find((a) => a.type === updateMessage.type)?.payload[1]).toBe(
      'msg_exact_target',
    );
    expect(loadSessionMock).not.toHaveBeenCalled();
  });

  it('prefers an exact assistant appMessageId over an earlier streaming fallback target', async () => {
    const staleStreamingMessage: AgentMessage = {
      id: 'msg_stale_app_streaming',
      appMessageId: 'app_stale_app_streaming',
      role: 'assistant',
      timestamp: '2026-05-08T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'stale' }],
      isStreaming: true,
    } as AgentMessage;
    const exactAppMessage: AgentMessage = {
      id: 'msg_app_target',
      appMessageId: 'app_exact_target',
      role: 'assistant',
      timestamp: '2026-05-08T00:00:01.000Z',
      contentBlocks: [{ type: 'text', text: 'old' }],
      isStreaming: false,
    } as AgentMessage;
    const session: AgentSession = {
      id: 'agent-exact-app-target',
      name: 'Agent',
      workspaceId: 'ws-A' as any,
      messages: [
        staleStreamingMessage,
        exactAppMessage,
      ],
      isStreaming: true,
    } as AgentSession;
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => makeState(session, 'ws-A') },
      handleAgentStreamUpdate,
      agentStreamUpdateReceived({
        workspaceId: 'ws-A',
        agentId: 'agent-exact-app-target',
        handlerSessionId: 'agent-exact-app-target',
        source: 'sendMessage',
        eventType: 'chunk',
        assistantAppMessageId: 'app_exact_target',
        contentBlocks: [{ type: 'text', text: 'new app exact' }],
      }),
    ).toPromise();

    expect(dispatched.find((a) => a.type === updateMessage.type)?.payload[1]).toBe(
      'msg_app_target',
    );
    expect(loadSessionMock).not.toHaveBeenCalled();
  });

  it('keeps restored chunk recovery updates saga-owned', async () => {
    const streamingMessage: AgentMessage = {
      id: 'msg_restored_streaming',
      appMessageId: 'app_restored_streaming',
      role: 'assistant',
      timestamp: '2026-05-08T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'h' }],
      isStreaming: true,
    } as AgentMessage;
    const session: AgentSession = {
      id: 'agent-restored-chunk',
      name: 'Agent',
      workspaceId: 'ws-A' as any,
      messages: [
        streamingMessage,
      ],
      isStreaming: true,
    } as AgentSession;
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => makeState(session, 'ws-A') },
      handleAgentStreamUpdate,
      agentStreamUpdateReceived({
        workspaceId: 'ws-A',
        agentId: 'agent-restored-chunk',
        handlerSessionId: 'agent-restored-chunk',
        source: 'restored',
        eventType: 'chunk',
        assistantMessageId: 'msg_restored_streaming',
        assistantAppMessageId: 'app_restored_streaming',
        contentBlocks: [{ type: 'text', text: 'hello' }],
      }),
    ).toPromise();

    const updates = dispatched.filter((a) => a.type === updateMessage.type);
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toEqual([
      'agent-restored-chunk',
      'msg_restored_streaming',
      expect.objectContaining({ contentBlocks: [{ type: 'text', text: 'hello' }] }),
    ]);
  });

  it('updates an existing target for content-blocks events', async () => {
    const streamingMessage: AgentMessage = {
      id: 'msg_content_blocks',
      appMessageId: 'app_content_blocks',
      role: 'assistant',
      timestamp: '2026-05-08T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'old' }],
      isStreaming: true,
    } as AgentMessage;
    const session: AgentSession = {
      id: 'agent-content-blocks',
      name: 'Agent',
      workspaceId: 'ws-A' as any,
      messages: [
        streamingMessage,
      ],
      isStreaming: true,
    } as AgentSession;
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => makeState(session, 'ws-A') },
      handleAgentStreamUpdate,
      agentStreamUpdateReceived({
        workspaceId: 'ws-A',
        agentId: 'agent-content-blocks',
        handlerSessionId: 'agent-content-blocks',
        source: 'sendMessage',
        eventType: 'content-blocks',
        assistantMessageId: 'msg_content_blocks',
        assistantAppMessageId: 'app_content_blocks',
        contentBlocks: [{ type: 'text', text: 'new' }],
      }),
    ).toPromise();

    expect(dispatched.filter((a) => a.type === updateMessage.type)).toEqual([
      expect.objectContaining({
        payload: [
          'agent-content-blocks',
          'msg_content_blocks',
          expect.objectContaining({
            appMessageId: 'app_content_blocks',
            contentBlocks: [{ type: 'text', text: 'new' }],
            isStreaming: true,
            streamingComplete: false,
          }),
        ],
      }),
    ]);
    expect(loadSessionMock).not.toHaveBeenCalled();
  });

  it('preserves ordered text and tool blocks from saga stream updates', async () => {
    const streamingMessage: AgentMessage = {
      id: 'msg_ordered_blocks',
      appMessageId: 'app_ordered_blocks',
      role: 'assistant',
      timestamp: '2026-05-08T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'Before' }],
      isStreaming: true,
    } as AgentMessage;
    const session: AgentSession = {
      id: 'agent-ordered-blocks',
      name: 'Agent',
      workspaceId: 'ws-A' as any,
      messages: [
        streamingMessage,
      ],
      isStreaming: true,
    } as AgentSession;
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => makeState(session, 'ws-A') },
      handleAgentStreamUpdate,
      agentStreamUpdateReceived({
        workspaceId: 'ws-A',
        agentId: 'agent-ordered-blocks',
        handlerSessionId: 'agent-ordered-blocks',
        source: 'sendMessage',
        eventType: 'content-blocks',
        assistantMessageId: 'msg_ordered_blocks',
        assistantAppMessageId: 'app_ordered_blocks',
        contentBlocks: [
          { type: 'text', text: 'Before' },
          { type: 'tool_use', id: 'tool-1', name: 'search', input: { q: 'x' } },
          { type: 'tool_result', tool_use_id: 'tool-1', output: 'found' },
          { type: 'text', text: 'After' },
        ],
      }),
    ).toPromise();

    expect(
      dispatched.find((a) => a.type === updateMessage.type)?.payload[2].contentBlocks,
    ).toEqual([
      { type: 'text', text: 'Before' },
      { type: 'tool_use', id: 'tool-1', name: 'search', input: { q: 'x' } },
      { type: 'tool_result', tool_use_id: 'tool-1', output: 'found' },
      { type: 'text', text: 'After' },
    ]);
  });

  it('prevents active streaming content-block regressions', async () => {
    const existingBlocks: ContentBlock[] = [
      { type: 'text', text: 'Before' },
      { type: 'tool_use', id: 'tool-1', name: 'search' },
      { type: 'text', text: 'After' },
    ];
    const streamingMessage: AgentMessage = {
      id: 'msg_monotonic_blocks',
      appMessageId: 'app_monotonic_blocks',
      role: 'assistant',
      timestamp: '2026-05-08T00:00:00.000Z',
      contentBlocks: existingBlocks,
      isStreaming: true,
    } as AgentMessage;
    const session: AgentSession = {
      id: 'agent-monotonic-blocks',
      name: 'Agent',
      workspaceId: 'ws-A' as any,
      messages: [
        streamingMessage,
      ],
      isStreaming: true,
    } as AgentSession;
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => makeState(session, 'ws-A') },
      handleAgentStreamUpdate,
      agentStreamUpdateReceived({
        workspaceId: 'ws-A',
        agentId: 'agent-monotonic-blocks',
        handlerSessionId: 'agent-monotonic-blocks',
        source: 'sendMessage',
        eventType: 'chunk',
        assistantMessageId: 'msg_monotonic_blocks',
        assistantAppMessageId: 'app_monotonic_blocks',
        contentBlocks: [{ type: 'text', text: 'Before' }],
      }),
    ).toPromise();

    expect(
      dispatched.find((a) => a.type === updateMessage.type)?.payload[2].contentBlocks,
    ).toEqual(existingBlocks);
  });

  it('finalizes an existing target for complete events', async () => {
    const streamingMessage: AgentMessage = {
      id: 'msg_complete',
      appMessageId: 'app_complete',
      role: 'assistant',
      timestamp: '2026-05-08T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'old' }],
      isStreaming: true,
      metadata: { existing: true },
    } as AgentMessage;
    const session: AgentSession = {
      id: 'agent-complete',
      name: 'Agent',
      workspaceId: 'ws-A' as any,
      messages: [
        streamingMessage,
      ],
      isStreaming: true,
      isProcessing: true,
      isResponding: true,
    } as AgentSession;
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => makeState(session, 'ws-A') },
      handleAgentStreamUpdate,
      agentStreamUpdateReceived({
        workspaceId: 'ws-A',
        agentId: 'agent-complete',
        handlerSessionId: 'agent-complete',
        source: 'sendMessage',
        eventType: 'complete',
        assistantMessageId: 'msg_complete',
        assistantAppMessageId: 'app_complete_final',
        completeMessage: {
          id: 'msg_complete',
          appMessageId: 'app_complete_final',
          role: 'assistant',
          timestamp: '2026-05-08T00:00:01.000Z',
          contentBlocks: [{ type: 'text', text: 'done' }],
          metadata: { final: true },
        } as AgentMessage,
      }),
    ).toPromise();

    expect(dispatched.find((a) => a.type === updateMessage.type)?.payload).toEqual([
      'agent-complete',
      'msg_complete',
      expect.objectContaining({
        appMessageId: 'app_complete_final',
        contentBlocks: [{ type: 'text', text: 'done' }],
        isStreaming: false,
        streamingComplete: true,
        metadata: { existing: true, final: true },
      }),
    ]);
    expect(dispatched.find((a) => a.type === setAgentStreaming.type)?.payload).toEqual([
      'agent-complete',
      false,
    ]);
    expect(dispatched.find((a) => a.type === updateAgentSessionAction.type)?.payload).toEqual([
      'agent-complete',
      { isStreaming: false, isProcessing: false, isResponding: false },
    ]);
    expect(dispatched.find((a) => a.type === newAssistantMessage.type)?.payload).toEqual({
      agentId: 'agent-complete',
      workspaceId: 'ws-A',
      isBackground: false,
    });
  });

  it('adopts the backend final message ID by replacing the placeholder in place on complete', async () => {
    const streamingMessage: AgentMessage = {
      id: 'msg_placeholder_complete',
      appMessageId: 'app_placeholder_complete',
      role: 'assistant',
      timestamp: '2026-05-08T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'partial' }],
      isStreaming: true,
    } as AgentMessage;
    const session: AgentSession = {
      id: 'agent-complete-replace',
      name: 'Agent',
      workspaceId: 'ws-A' as any,
      messages: [
        streamingMessage,
      ],
      isStreaming: true,
    } as AgentSession;
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => makeState(session, 'ws-A') },
      handleAgentStreamUpdate,
      agentStreamUpdateReceived({
        workspaceId: 'ws-A',
        agentId: 'agent-complete-replace',
        handlerSessionId: 'agent-complete-replace',
        source: 'sendMessage',
        eventType: 'complete',
        assistantMessageId: 'msg_placeholder_complete',
        assistantAppMessageId: 'app_placeholder_complete',
        completeMessage: {
          id: 'msg_backend_complete',
          appMessageId: 'app_backend_complete',
          role: 'assistant',
          timestamp: '2026-05-08T00:00:01.000Z',
          contentBlocks: [{ type: 'text', text: 'done' }],
          metadata: { final: true },
        } as AgentMessage,
      }),
    ).toPromise();

    expect(dispatched.filter((a) => a.type === updateMessage.type)).toHaveLength(0);
    expect(dispatched.find((a) => a.type === replaceMessages.type)?.payload).toEqual([
      'agent-complete-replace',
      [
        expect.objectContaining({
          id: 'msg_backend_complete',
          appMessageId: 'app_backend_complete',
          isStreaming: false,
          streamingComplete: true,
          contentBlocks: [{ type: 'text', text: 'done' }],
        }),
      ],
    ]);
  });

  it('deduplicates observed same-appMessageId assistant duplicates on live complete', async () => {
    const appMessageId = 'app_observed_duplicate';
    const staleFinalMessage: AgentMessage = {
      id: 'msg_disk_final_observed',
      appMessageId,
      role: 'assistant',
      timestamp: '2026-05-08T00:00:00.000Z',
      contentBlocks: [
        { type: 'text', text: 'I inspected the file and found the issue.' },
        { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'src/foo.ts' } },
        { type: 'tool_result', tool_use_id: 'toolu_1', output: { content: 'file contents' } },
      ],
      isStreaming: false,
    } as AgentMessage;
    const streamingPlaceholder: AgentMessage = {
      id: '550e8400-e29b-41d4-a716-446655440001',
      appMessageId,
      role: 'assistant',
      timestamp: '2026-05-08T00:00:01.000Z',
      contentBlocks: [
        { type: 'text', text: 'I inspected the file and found the issue.' },
        { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'src/foo.ts' } },
      ],
      isStreaming: true,
    } as AgentMessage;
    const session: AgentSession = {
      id: 'agent-live-duplicate-regression',
      name: 'Agent',
      workspaceId: 'ws-A' as any,
      messages: [
        staleFinalMessage,
        streamingPlaceholder,
      ],
      isStreaming: true,
    } as AgentSession;
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => makeState(session, 'ws-A') },
      handleAgentStreamUpdate,
      agentStreamUpdateReceived({
        workspaceId: 'ws-A',
        agentId: 'agent-live-duplicate-regression',
        handlerSessionId: 'agent-live-duplicate-regression',
        source: 'sendMessage',
        eventType: 'complete',
        assistantMessageId: '550e8400-e29b-41d4-a716-446655440001',
        assistantAppMessageId: appMessageId,
        completeMessage: {
          id: 'msg_backend_final_observed',
          appMessageId,
          role: 'assistant',
          timestamp: '2026-05-08T00:00:02.000Z',
          contentBlocks: [
            { type: 'text', text: 'I inspected the file and found the issue.' },
            { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'src/foo.ts' } },
            { type: 'tool_result', tool_use_id: 'toolu_1', output: { content: 'file contents' } },
          ],
          metadata: { stopReason: 'end_turn' },
        } as AgentMessage,
      }),
    ).toPromise();

    const replacement = dispatched.find((a) => a.type === replaceMessages.type);
    const messages = replacement?.payload[1] as AgentMessage[];
    expect(messages.map((message) => message.id)).toEqual(['msg_backend_final_observed']);
    expect(messages[0]).toMatchObject({
      appMessageId,
      isStreaming: false,
      streamingComplete: true,
    });
    expectNoDuplicateNonEmptyAppMessageIds(messages);
  });

  it('creates the started placeholder when requested', async () => {
    const session: AgentSession = {
      id: 'agent-started',
      name: 'Agent',
      workspaceId: 'ws-A' as any,
      messages: [],
      isStreaming: false,
    } as AgentSession;
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => makeState(session, 'ws-A') },
      handleAgentStreamUpdate,
      agentStreamUpdateReceived({
        workspaceId: 'ws-A',
        agentId: 'agent-started',
        handlerSessionId: 'agent-started',
        source: 'restored',
        eventType: 'started',
        assistantMessageId: 'msg_started',
        assistantAppMessageId: 'app_started',
        createInitialPlaceholder: true,
        contentBlocks: [{ type: 'text', text: '' }],
      }),
    ).toPromise();

    expect(dispatched.find((a) => a.type === addAgentSessionMessage.type)?.payload).toEqual([
      'agent-started',
      expect.objectContaining({
        id: 'msg_fallback',
        appMessageId: 'app_started',
        role: 'assistant',
        isStreaming: true,
        streamingComplete: false,
      }),
    ]);
    expect(dispatched.find((a) => a.type === setAgentStreaming.type)?.payload).toEqual([
      'agent-started',
      true,
    ]);
  });

  it.each(['error', 'timeout'] as const)(
    'finalizes the active assistant message and clears session flags for %s events',
    async (eventType) => {
      const streamingMessage: AgentMessage = {
        id: `msg-${eventType}`,
        appMessageId: `app-${eventType}`,
        role: 'assistant',
        timestamp: '2026-05-08T00:00:00.000Z',
        contentBlocks: [{ type: 'text', text: 'partial answer' }],
        isStreaming: true,
        streamingComplete: false,
      } as AgentMessage;
      const session: AgentSession = {
        id: `agent-${eventType}`,
        name: 'Agent',
        workspaceId: 'ws-A' as any,
        messages: [streamingMessage],
        isStreaming: true,
        isProcessing: true,
      } as AgentSession;
      const dispatched: any[] = [];

      await runSaga(
        { dispatch: (a: any) => dispatched.push(a), getState: () => makeState(session, 'ws-A') },
        handleAgentStreamUpdate,
        agentStreamUpdateReceived({
          workspaceId: 'ws-A',
          agentId: `agent-${eventType}`,
          handlerSessionId: `agent-${eventType}`,
          source: 'restored',
          eventType,
          assistantMessageId: `msg-${eventType}`,
          assistantAppMessageId: `app-${eventType}`,
          error: eventType === 'error' ? 'Provider crashed' : undefined,
        }),
      ).toPromise();

      expect(dispatched.find((a) => a.type === updateMessage.type)?.payload).toEqual([
        `agent-${eventType}`,
        `msg-${eventType}`,
        expect.objectContaining({
          isStreaming: false,
          streamingComplete: true,
          metadata: { stopReason: eventType },
          ...(eventType === 'error' ? { error: 'Provider crashed' } : {}),
        }),
      ]);
      expect(dispatched.find((a) => a.type === setAgentStreaming.type)?.payload).toEqual([
        `agent-${eventType}`,
        false,
      ]);
      expect(dispatched.find((a) => a.type === updateAgentSessionAction.type)?.payload).toEqual([
        `agent-${eventType}`,
        { isStreaming: false, isProcessing: false },
      ]);
      expect(loadSessionMock).not.toHaveBeenCalled();
    },
  );

  it('refreshes a loaded missing-target session through the canonical workspace-aware upsert only', async () => {
    const session: AgentSession = {
      id: 'agent-loaded-refresh',
      name: 'Agent',
      workspaceId: 'ws-A' as any,
      messages: [],
      isStreaming: true,
    } as AgentSession;
    const loaded = { ...session, name: 'Loaded Agent', messages: [] };
    loadSessionMock.mockResolvedValueOnce(loaded);
    const state = makeState(session, 'ws-A');
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => state },
      handleAgentStreamUpdate,
      agentStreamUpdateReceived({
        workspaceId: 'ws-A',
        agentId: 'agent-loaded-refresh',
        handlerSessionId: 'agent-loaded-refresh',
        source: 'sendMessage',
        eventType: 'chunk',
        assistantMessageId: 'msg_missing_loaded',
        contentBlocks: [{ type: 'text', text: 'hello' }],
      }),
    ).toPromise();

    const canonicalUpserts = dispatched.filter((a) => a.type === upsertSession.type);
    expect(canonicalUpserts).toHaveLength(1);
    expect(canonicalUpserts[0].payload).toEqual([{ ...loaded, workspaceId: 'ws-A' }]);
  });

  it('restored complete missing target is completed by the saga, not lifecycle state reads', async () => {
    const session: AgentSession = {
      id: 'agent-restored-missing',
      name: 'Agent',
      workspaceId: 'ws-A' as any,
      messages: [],
      isStreaming: true,
      isProcessing: true,
      isResponding: true,
    } as AgentSession;
    const state = makeState(session, 'ws-A');
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => state },
      handleAgentStreamUpdate,
      agentStreamUpdateReceived({
        workspaceId: 'ws-A',
        agentId: 'agent-restored-missing',
        handlerSessionId: 'agent-restored-missing',
        source: 'restored',
        eventType: 'complete',
        assistantMessageId: 'msg_restored_missing',
        assistantAppMessageId: 'app_restored_missing',
        completeMessage: {
          id: 'msg_backend_final',
          appMessageId: 'app_backend_final',
          role: 'assistant',
          timestamp: '2026-05-07T00:00:00.000Z',
          contentBlocks: [{ type: 'text', text: 'done' }],
        },
      }),
    ).toPromise();

    expect(loadSessionMock).toHaveBeenCalledWith('agent-restored-missing', 'ws-A', {
      bypassCache: true,
    });
    const fallback = dispatched.find((a) => a.type === replaceMessages.type);
    expect(fallback?.payload[1]).toMatchObject([
      {
        id: 'msg_backend_final',
        appMessageId: 'app_backend_final',
        role: 'assistant',
        isStreaming: false,
        streamingComplete: true,
        contentBlocks: [{ type: 'text', text: 'done' }],
      },
    ]);
    expect(
      dispatched.some((a) => a.type === setAgentStreaming.type && a.payload[1] === false),
    ).toBe(true);
    expect(dispatched.find((a) => a.type === updateAgentSessionAction.type)?.payload).toEqual([
      'agent-restored-missing',
      { isStreaming: false, isProcessing: false, isResponding: false },
    ]);
  });

  it.each([
    {
      name: 'content block object',
      completeMessage: {
        type: 'tool_use',
        id: 'tool_1',
        name: 'shell',
        input: { command: 'echo hi' },
        metadata: { shouldNotLeak: true },
      },
      expectedBlocks: [
        { type: 'tool_use', id: 'tool_1', name: 'shell', input: { command: 'echo hi' } },
      ],
    },
    {
      name: 'content block array',
      completeMessage: [{ type: 'text', text: 'array text' }],
      expectedBlocks: [{ type: 'text', text: 'array text' }],
    },
  ])(
    'does not spread malformed complete payload $name into fallback message roots',
    async ({ completeMessage, expectedBlocks }) => {
      const session: AgentSession = {
        id: 'agent-malformed-complete',
        name: 'Agent',
        workspaceId: 'ws-A' as any,
        messages: [],
        isStreaming: true,
      } as AgentSession;
      const state = makeState(session, 'ws-A');
      const dispatched: any[] = [];

      await runSaga(
        { dispatch: (a: any) => dispatched.push(a), getState: () => state },
        handleAgentStreamUpdate,
        agentStreamUpdateReceived({
          workspaceId: 'ws-A',
          agentId: 'agent-malformed-complete',
          handlerSessionId: 'agent-malformed-complete',
          source: 'restored',
          eventType: 'complete',
          completeMessage,
        }),
      ).toPromise();

      const fallback = dispatched.find((a) => a.type === replaceMessages.type);
      const message = fallback?.payload[1][0];
      expect(message).toMatchObject({
        id: 'msg_fallback',
        appMessageId: 'app_fallback',
        role: 'assistant',
        isStreaming: false,
        streamingComplete: true,
        contentBlocks: expectedBlocks as ContentBlock[],
      });
      expect(message).not.toHaveProperty('type');
      expect(message).not.toHaveProperty('name');
      expect(message).not.toHaveProperty('input');
      expect(message).not.toHaveProperty('0');
      expect(message.metadata).toBeUndefined();
    },
  );

  it('deduplicates saga fallback replacement messages before reducer dispatch', async () => {
    const session: AgentSession = {
      id: 'agent-fallback-dedup',
      name: 'Agent',
      workspaceId: 'ws-A' as any,
      messages: [
        {
          id: 'msg_existing',
          appMessageId: 'app_existing',
          role: 'assistant',
          timestamp: '2026-05-07T00:00:00.000Z',
          contentBlocks: [{ type: 'text', text: 'done' }],
        },
      ],
      isStreaming: true,
    } as AgentSession;
    const state = makeState(session, 'ws-A');
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => state },
      handleAgentStreamUpdate,
      agentStreamUpdateReceived({
        workspaceId: 'ws-A',
        agentId: 'agent-fallback-dedup',
        handlerSessionId: 'agent-fallback-dedup',
        source: 'restored',
        eventType: 'complete',
        assistantMessageId: 'msg_missing_duplicate',
        assistantAppMessageId: 'app_duplicate',
        completeMessage: {
          id: 'msg_duplicate',
          appMessageId: 'app_duplicate',
          role: 'assistant',
          timestamp: '2026-05-07T00:00:02.000Z',
          contentBlocks: [{ type: 'text', text: 'done' }],
        },
      }),
    ).toPromise();

    const fallback = dispatched.find((a) => a.type === replaceMessages.type);
    expect(fallback?.payload[1]).toHaveLength(1);
    expect(fallback?.payload[1][0]).toMatchObject({
      id: 'msg_duplicate',
      appMessageId: 'app_duplicate',
    });
  });
});

describe('handleAgentStreamResetStreamingMessages', () => {
  it('removes empty streaming placeholders, completes non-empty ones, and clears agent streaming', async () => {
    const session: AgentSession = {
      id: 'agent-reset',
      name: 'Agent',
      workspaceId: 'ws-A' as any,
      messages: [
        {
          id: 'msg-user',
          role: 'user',
          timestamp: '',
          contentBlocks: [],
          isStreaming: true,
        } as any,
        {
          id: 'msg-assistant-empty-streaming',
          role: 'assistant',
          timestamp: '',
          contentBlocks: [],
          isStreaming: true,
        } as any,
        {
          id: 'msg-assistant-streaming',
          role: 'assistant',
          timestamp: '',
          contentBlocks: [{ type: 'text', text: 'partial' }],
          isStreaming: true,
        } as any,
        {
          id: 'msg-assistant-done',
          role: 'assistant',
          timestamp: '',
          contentBlocks: [],
          isStreaming: false,
        } as any,
      ],
      isStreaming: true,
    } as AgentSession;
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => makeState(session, 'ws-A') },
      handleAgentStreamResetStreamingMessages,
      agentStreamResetStreamingMessagesRequested({ workspaceId: 'ws-A', agentId: 'agent-reset' }),
    ).toPromise();

    expect(dispatched.filter((a) => a.type === updateMessage.type)).toHaveLength(0);
    expect(
      dispatched.find((a) => a.type === replaceMessages.type)?.payload[1],
    ).toMatchObject([
      { id: 'msg-user', role: 'user', isStreaming: true },
      {
        id: 'msg-assistant-streaming',
        role: 'assistant',
        isStreaming: false,
        streamingComplete: true,
      },
      { id: 'msg-assistant-done', role: 'assistant', isStreaming: false },
    ]);
    expect(dispatched.find((a) => a.type === setAgentStreaming.type)?.payload).toEqual([
      'agent-reset',
      false,
    ]);
  });
});

describe('handleBackendStreamsReconnectResult — active backend stream rebinding', () => {
  beforeEach(() => {
    ensureStreamHandlerMock.mockClear();
    loadSessionMock.mockClear();
    loadSessionMock.mockResolvedValue(null);
  });

  it('re-registers a renderer stream handler for an active backend stream with existing streaming state', async () => {
    const streamingMessage: AgentMessage = {
      id: 'msg_streaming',
      appMessageId: 'app_streaming',
      role: 'assistant',
      timestamp: '2026-05-08T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'partial' }],
      isStreaming: true,
    } as AgentMessage;
    const session: AgentSession = {
      id: 'agent-active-stream',
      name: 'Agent',
      workspaceId: 'ws-A' as any,
      messages: [
        streamingMessage,
      ],
      isStreaming: true,
    } as AgentSession;

    await runSaga(
      { dispatch: vi.fn(), getState: () => makeState(session, 'ws-A') },
      handleBackendStreamsReconnectResult,
      backendStreamsReconnectResultReceived([
        { agentId: 'agent-active-stream', workspaceId: 'ws-A' },
      ]),
    ).toPromise();

    expect(loadSessionMock).not.toHaveBeenCalled();
    expect(ensureStreamHandlerMock).toHaveBeenCalledWith('agent-active-stream', {
      existingMessage: streamingMessage,
      workspaceId: 'ws-A',
      assistantAppMessageId: 'app_streaming',
    });
  });

  it('uses the backend active stream snapshot as source of truth even when session streaming state is stale', async () => {
    const session: AgentSession = {
      id: 'agent-stale-stream-flag',
      name: 'Agent',
      workspaceId: 'ws-A' as any,
      messages: [],
      isStreaming: false,
    } as AgentSession;

    await runSaga(
      { dispatch: vi.fn(), getState: () => makeState(session, 'ws-A') },
      handleBackendStreamsReconnectResult,
      backendStreamsReconnectResultReceived([
        { agentId: 'agent-stale-stream-flag', workspaceId: 'ws-A' },
      ]),
    ).toPromise();

    expect(ensureStreamHandlerMock).toHaveBeenCalledWith('agent-stale-stream-flag', {
      existingMessage: undefined,
      workspaceId: 'ws-A',
      assistantAppMessageId: undefined,
    });
  });
});

describe('agentStreamSaga registrations', () => {
  it('registers stream update, reset, reconnect, and safety handlers', () => {
    const saga = agentStreamSaga();

    expect(saga.next().value).toEqual(
      sagaEffects.takeEvery(agentStreamUpdateReceived, handleAgentStreamUpdate),
    );
    expect(saga.next().value).toEqual(
      sagaEffects.takeEvery(
        agentStreamResetStreamingMessagesRequested,
        handleAgentStreamResetStreamingMessages,
      ),
    );
    expect(saga.next().value).toEqual(
      sagaEffects.takeLatest(
        backendStreamsReconnectResultReceived,
        handleBackendStreamsReconnectResult,
      ),
    );
    const reconnectEffect: any = saga.next().value;
    expect(reconnectEffect.payload.args[0]).toBe(reconnectStreamHandlersForWorkspaceRequested);
    expect(typeof reconnectEffect.payload.args[1]).toBe('function');
    expect(saga.next().value).toEqual(
      sagaEffects.takeLatest(triggerStreamingSafetyCheck, handleStreamingSafetyCheck),
    );
    expect(saga.next().done).toBe(true);
  });
});
