/**
 * ChatService Race Condition Regression Tests
 *
 * Tests for race conditions that cause real bugs:
 * missing messages, stale state, false-positive rate limiting.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { ChatService, MessageGuardError } from '../chat.service';

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const mockDispatch = vi.fn();
const mockGetState = vi.fn();

const mockSelectAgentById = vi.fn();
const mockSelectChatAgentState = vi.fn();
const mockSelectActiveWorkspaceId = vi.fn();
const mockSelectWorkspaceById = vi.fn();
const mockSelectWorkspaceItems = vi.fn();
const mockSelectAgentSession = vi.fn();
const mockSelectAgentMessages = vi.fn();

// ─── Module mocks (must be before imports that resolve them) ─────────────────

vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  getReduxStore: () => ({
    getState: mockGetState,
    dispatch: mockDispatch,
  }),
}));

vi.mock('$lib/store/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAgentById: { select: (...args: any[]) => mockSelectAgentById(...args) },
}));

vi.mock('$lib/store/slices/chat-state/chat-state-selectors', () => ({
  selectChatAgentState: { select: (...args: any[]) => mockSelectChatAgentState(...args) },
}));

vi.mock('$lib/store/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: { select: (...args: any[]) => mockSelectActiveWorkspaceId(...args) },
  selectWorkspaceById: { select: (...args: any[]) => mockSelectWorkspaceById(...args) },
  selectWorkspaceItems: { select: (...args: any[]) => mockSelectWorkspaceItems(...args) },
}));

vi.mock('$lib/store/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: { select: (...args: any[]) => mockSelectAgentSession(...args) },
  selectAgentMessages: { select: (...args: any[]) => mockSelectAgentMessages(...args) },
}));

vi.mock('$lib/store/slices/workspace-agents/workspace-agents-slice', () => ({
  upsertAgentSession: vi.fn((...args: any[]) => ({ type: 'upsertAgentSession', payload: args })),
  setAgentStreaming: vi.fn((...args: any[]) => ({ type: 'setAgentStreaming', payload: args })),
  replaceAgentMessages: vi.fn((...args: any[]) => ({ type: 'replaceAgentMessages', payload: args })),
}));

vi.mock('$lib/store/slices/chat-state/chat-state-slice', () => ({
  chatInitialized: vi.fn((...a: any[]) => ({ type: 'chatInitialized', payload: a })),
  chatInitFailed: vi.fn((...a: any[]) => ({ type: 'chatInitFailed', payload: a })),
  chatSendFailed: vi.fn((...a: any[]) => ({ type: 'chatSendFailed', payload: a })),
  chatInterrupted: vi.fn((...a: any[]) => ({ type: 'chatInterrupted', payload: a })),
  chatModelUnavailableSet: vi.fn((...a: any[]) => ({ type: 'chatModelUnavailableSet', payload: a })),
  chatModelUnavailableCleared: vi.fn((...a: any[]) => ({ type: 'chatModelUnavailableCleared', payload: a })),
  chatErrorCleared: vi.fn((...a: any[]) => ({ type: 'chatErrorCleared', payload: a })),
  chatStopInitiated: vi.fn((...a: any[]) => ({ type: 'chatStopInitiated', payload: a })),
  chatStopCompleted: vi.fn((...a: any[]) => ({ type: 'chatStopCompleted', payload: a })),
  chatReset: vi.fn((...a: any[]) => ({ type: 'chatReset', payload: a })),
  streamStarted: vi.fn((...a: any[]) => ({ type: 'streamStarted', payload: a })),
  streamChunkFlushed: vi.fn((...a: any[]) => ({ type: 'streamChunkFlushed', payload: a })),
  streamChunkReceived: vi.fn((...a: any[]) => ({ type: 'streamChunkReceived', payload: a })),
  streamCompleted: vi.fn((...a: any[]) => ({ type: 'streamCompleted', payload: a })),
  streamErrored: vi.fn((...a: any[]) => ({ type: 'streamErrored', payload: a })),
  streamStatusReceived: vi.fn((...a: any[]) => ({ type: 'streamStatusReceived', payload: a })),
  streamTimedOut: vi.fn((...a: any[]) => ({ type: 'streamTimedOut', payload: a })),
  chatStallDetected: vi.fn((...a: any[]) => ({ type: 'chatStallDetected', payload: a })),
  chatStuckStateCleared: vi.fn((...a: any[]) => ({ type: 'chatStuckStateCleared', payload: a })),
}));

vi.mock('$lib/store/slices/agent-session/agent-session-slice', () => ({
  upsertSession: vi.fn((...a: any[]) => ({ type: 'upsertSession', payload: a })),
  replaceMessages: vi.fn((...a: any[]) => ({ type: 'replaceMessages', payload: a })),
  addMessage: vi.fn((...a: any[]) => ({ type: 'addMessage', payload: a })),
}));

vi.mock('$features/agent/agent-ipc-bridge', () => ({
  agentService: {
    getSession: vi.fn(),
    restoreSession: vi.fn(),
    sendMessage: vi.fn(),
    stopSession: vi.fn(),
    activateAgent: vi.fn(),
    registerDomHandler: vi.fn(),
    unregisterDomHandler: vi.fn(),
    replayPendingEvents: vi.fn(),
    clearPendingEvents: vi.fn(),
    saveSession: vi.fn(),
  },
}));

vi.mock('$features/agent/browser', () => ({
  notifyAgentSubscribers: vi.fn(),
}));

vi.mock('../memory-manager', () => ({
  memoryManager: {
    registerListener: vi.fn(() => vi.fn()),
    registerTimer: vi.fn(() => ({ cleanup: vi.fn() })),
  },
}));

vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('$lib/logging/logger.svelte', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  LogCategory: { AGENT: 'agent' },
}));

vi.mock('$shared/types', () => ({
  normalizeContentBlocks: (blocks: any) => blocks,
}));

vi.mock('$shared/types/branded-ids', () => ({
  createMessageId: (id: string) => id,
}));

vi.mock('$shared/constants/agent-streaming', () => ({
  AGENT_STREAMING_CONFIG: { BACKEND_STREAM_TIMEOUT_MS: 120000 },
}));

vi.mock('$shared/errors/messages', () => ({
  cleanErrorMessage: (msg: string) => msg,
}));

vi.mock('../../../agent/utils/streaming-invariants', () => ({
  assertStreamingInvariant: vi.fn(),
}));

vi.mock('$lib/components/chat/streaming-status-utils', () => ({
  shouldAppendStreamingEvent: vi.fn(() => false),
}));

// ─── Post-mock imports (resolved through mocked modules) ─────────────────────

import { agentService } from '$features/agent/agent-ipc-bridge';
import { memoryManager } from '../memory-manager';
import { streamStarted } from '$lib/store/slices/chat-state/chat-state-slice';
import { replaceAgentMessages } from '$lib/store/slices/workspace-agents/workspace-agents-slice';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const AGENT_ID = 'agent-race-1';
const SESSION_ID = 'agent-race-1';
const WORKSPACE_ID = 'ws-race-1';

function makeChatAgentState(overrides: Record<string, any> = {}) {
  return {
    agentId: AGENT_ID,
    isInterrupting: false,
    streamingContent: '',
    error: null,
    lastChunkTime: null,
    receivedFirstChunk: false,
    isStalled: false,
    streamingStartTime: null,
    lastAttemptedMessage: null,
    modelUnavailable: null,
    statusEvents: [],
    trackedWorkspaceId: null,
    isRebinding: false,
    ...overrides,
  };
}

function makeSession(overrides: Record<string, any> = {}) {
  return {
    id: SESSION_ID,
    backendSessionId: 'backend-1',
    workspaceId: WORKSPACE_ID,
    name: 'Test Agent',
    status: 'active',
    messages: [],
    model: 'claude-3-5-sonnet-latest',
    isStreaming: false,
    isProcessing: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeMessage(id: string, role: 'user' | 'assistant', text: string, extra: Record<string, any> = {}) {
  return {
    id: `msg_${id}`,
    role,
    contentBlocks: [{ type: 'text' as const, text }],
    timestamp: new Date().toISOString(),
    ...extra,
  };
}

const mockWorkspace = {
  id: WORKSPACE_ID,
  name: 'Test WS',
  path: '/test',
  worktreePath: '/test',
  repositoryPath: '/test',
  createdAt: new Date(),
  updatedAt: new Date(),
  lastAccessedAt: new Date(),
  metadata: {},
};

/** Configure all selectors to return consistent base state */
function setupDefaultState(sessionOverrides?: Record<string, any>, chatStateOverrides?: Record<string, any>) {
  const session = makeSession(sessionOverrides);
  const chatState = makeChatAgentState(chatStateOverrides);
  const messages = session.messages;

  mockGetState.mockReturnValue({});
  mockSelectActiveWorkspaceId.mockReturnValue(WORKSPACE_ID);
  mockSelectWorkspaceById.mockReturnValue(mockWorkspace);
  mockSelectWorkspaceItems.mockReturnValue([mockWorkspace]);
  mockSelectAgentById.mockReturnValue(session);
  mockSelectChatAgentState.mockReturnValue(chatState);
  mockSelectAgentSession.mockReturnValue(session);
  mockSelectAgentMessages.mockReturnValue(messages);

  return { session, chatState, messages };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ChatService Race Condition Regressions', () => {
  let service: ChatService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    service = new ChatService();

    // Provide window globals for DOM event handling
    if (typeof globalThis.window === 'undefined') {
      (globalThis as any).window = {};
    }
    (globalThis.window as any).addEventListener = vi.fn();
    (globalThis.window as any).removeEventListener = vi.fn();
    (globalThis.window as any).dispatchEvent = vi.fn();
    (globalThis.window as any).electronAPI = {
      invoke: vi.fn().mockResolvedValue({ success: true, data: [] }),
      on: vi.fn(),
      send: vi.fn(),
    };
    // requestAnimationFrame / cancelAnimationFrame
    (globalThis as any).requestAnimationFrame = (cb: () => void) => { cb(); return 1; };
    (globalThis as any).cancelAnimationFrame = vi.fn();
    // performance.now
    if (typeof globalThis.performance === 'undefined') {
      (globalThis as any).performance = { now: () => Date.now() };
    }
    // localStorage — may already exist in jsdom; spy instead of replacing
    try {
      vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});
    } catch {
      // localStorage not available in environment, skip
    }
    // document (for visibility handler) — use defineProperty for read-only props
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ─── Test 1: Synthetic start event arms reconciliation ────────────────────
  it('dispatches synthetic start event for backend-initiated streams during setupStreaming', () => {
    // Bug: Backend-initiated streams (delegated agents) never fire a 'start' event,
    // so stall detection and reconciliation timers never activate.
    const session = makeSession({ isStreaming: true });
    setupDefaultState({ isStreaming: true });

    // setupStreamingForSession should detect isStreaming and dispatch synthetic start
    service.setupStreamingForSession(AGENT_ID, SESSION_ID);

    // The synthetic start triggers streamStarted dispatch
    expect(streamStarted).toHaveBeenCalledWith(AGENT_ID, expect.objectContaining({
      hasRestoredContent: false,
    }));
  });

  // ─── Test 2: session-updated does not overwrite live streaming state ───────
  it('session-updated with fewer messages does not overwrite during active streaming', () => {
    // Bug: Stale disk data from restoreSessionWithoutBackend arrives via session-updated
    // and overwrites the live streaming messages.
    const liveMessages = [
      makeMessage('1', 'user', 'Hello'),
      makeMessage('2', 'assistant', 'Streaming response...'),
    ];
    const staleMessages = [makeMessage('1', 'user', 'Hello')]; // Missing assistant msg

    // State shows active streaming with 2 messages
    setupDefaultState(
      { isStreaming: true, messages: liveMessages },
      { streamingContent: 'Streaming response...' },
    );
    mockSelectAgentMessages.mockReturnValue(liveMessages);

    service.setupStreamingForSession(AGENT_ID, SESSION_ID);

    // Simulate session-updated arriving with stale data (fewer messages, still streaming)
    const registerCalls = (memoryManager.registerListener as Mock).mock.calls;
    const sessionUpdatedCall = registerCalls.find(
      (c: any[]) => typeof c[1] === 'string' && c[1].includes('session-updated'),
    );
    expect(sessionUpdatedCall).toBeDefined();

    // Now configure stale session data
    const staleSession = makeSession({ isStreaming: true, messages: staleMessages });
    mockSelectAgentById.mockReturnValue(staleSession);

    // Fire the session-updated handler
    const handler = sessionUpdatedCall![2];
    handler();

    // The replaceAgentMessages should NOT have been called with the stale (fewer) messages.
    // Either it was not called, or if called, messages count should be >= liveMessages count.
    const replaceCalls = replaceAgentMessages.mock.calls;
    for (const call of replaceCalls) {
      // Each call is (agentId, messages)
      if (call[0] === AGENT_ID) {
        expect(call[1].length).toBeGreaterThanOrEqual(liveMessages.length);
      }
    }
  });

  // ─── Test 3: Queued message after stopChat re-registers handlers ──────────
  it('re-registers stream handlers when queued message starts after stopChat', async () => {
    // Bug: stopChat removes stream handlers. A queued message from the backend
    // starts streaming, but the sessionUpdatedHandler must re-register the stream.
    const messages = [makeMessage('1', 'user', 'First request')];
    setupDefaultState({ messages, isStreaming: false });
    mockSelectAgentMessages.mockReturnValue(messages);

    service.setupStreamingForSession(AGENT_ID, SESSION_ID);

    // stopChat cleans up handlers
    await service.stopChat(AGENT_ID);

    // Now simulate session-updated with streaming=true (backend queued message started)
    const newMessages = [...messages, makeMessage('2', 'assistant', 'Queued response')];
    const streamingSession = makeSession({ isStreaming: true, messages: newMessages });
    mockSelectAgentById.mockReturnValue(streamingSession);
    mockSelectChatAgentState.mockReturnValue(makeChatAgentState());
    mockSelectAgentSession.mockReturnValue(streamingSession);
    mockSelectAgentMessages.mockReturnValue(newMessages);

    // The sessionUpdatedHandler should detect isStreaming && !streamHandlers.has(sessionId)
    // and call setupStreaming. We verify by checking that registerDomHandler was called again.

    // Get the handler that was registered for session-updated
    const registerCalls = (memoryManager.registerListener as Mock).mock.calls;
    const sessionUpdatedCall = registerCalls.find(
      (c: any[]) => typeof c[1] === 'string' && c[1].includes('session-updated'),
    );

    if (sessionUpdatedCall) {
      const handler = sessionUpdatedCall[2];
      handler();

      // After stopChat cleaned up and session-updated fires with isStreaming=true,
      // setupStreaming should be called again which calls registerDomHandler
      expect(agentService.registerDomHandler).toHaveBeenCalledWith(SESSION_ID);
    }
  });

  // ─── Test 4: Retry not suppressed by idempotency key after failure ────────
  it('clears idempotency key on send failure so retry is not suppressed', async () => {
    // Bug: If sendMessage fails, the idempotency key remains in the set,
    // causing retry attempts within the TTL to be silently dropped.
    const messages = [makeMessage('1', 'user', 'Hello'), makeMessage('2', 'assistant', 'Hi')];
    setupDefaultState({ messages, isStreaming: false });
    mockSelectAgentMessages.mockReturnValue(messages);

    (agentService.sendMessage as Mock).mockRejectedValueOnce(new Error('Activation failed'));
    (agentService.sendMessage as Mock).mockResolvedValueOnce(undefined);

    // First attempt fails
    await expect(
      service.sendMessage('retry me', mockWorkspace as any, AGENT_ID),
    ).rejects.toThrow('Activation failed');

    // Advance a bit (but within the 5s TTL)
    vi.advanceTimersByTime(200);

    // Second attempt should NOT be suppressed by idempotency
    // We need to advance past the rate limit interval (100ms)
    await service.sendMessage('retry me', mockWorkspace as any, AGENT_ID);

    // The second call should have reached agentService.sendMessage
    expect(agentService.sendMessage).toHaveBeenCalledTimes(2);
  });

  // ─── Test 5: Cross-workspace session-updated isolation ────────────────────
  it('session-updated for agent in workspace A does not affect workspace B agent', () => {
    // Bug: session-updated events are scoped by sessionId, but if two agents
    // share a sessionId pattern, one workspace's update could affect the other.
    const AGENT_A = 'agent-ws-a';
    const AGENT_B = 'agent-ws-b';

    // Setup for agent A
    const sessionA = makeSession({ id: AGENT_A, workspaceId: 'ws-a' });
    mockSelectAgentById.mockReturnValue(sessionA);
    mockSelectChatAgentState.mockReturnValue(makeChatAgentState({ agentId: AGENT_A }));
    mockSelectActiveWorkspaceId.mockReturnValue('ws-a');
    mockSelectAgentSession.mockReturnValue(sessionA);
    mockSelectAgentMessages.mockReturnValue([]);
    mockSelectWorkspaceItems.mockReturnValue([
      { ...mockWorkspace, id: 'ws-a' },
      { ...mockWorkspace, id: 'ws-b' },
    ]);
    mockGetState.mockReturnValue({});

    const serviceA = new ChatService();
    serviceA.setupStreamingForSession(AGENT_A, AGENT_A);

    // Setup for agent B (different workspace)
    const serviceB = new ChatService();
    const sessionB = makeSession({ id: AGENT_B, workspaceId: 'ws-b' });
    mockSelectAgentById.mockReturnValue(sessionB);
    mockSelectChatAgentState.mockReturnValue(makeChatAgentState({ agentId: AGENT_B }));
    mockSelectActiveWorkspaceId.mockReturnValue('ws-b');
    mockSelectAgentSession.mockReturnValue(sessionB);
    serviceB.setupStreamingForSession(AGENT_B, AGENT_B);

    // Verify each agent registered its own session-updated handler
    const registerCalls = (memoryManager.registerListener as Mock).mock.calls;
    const sessionUpdatedCalls = registerCalls.filter(
      (c: any[]) => typeof c[1] === 'string' && c[1].includes('session-updated'),
    );

    // Should have separate handlers for each agent's session ID
    const handlerEventNames = sessionUpdatedCalls.map((c: any[]) => c[1]);
    expect(handlerEventNames).toContain(`agent:session-updated:${AGENT_A}`);
    expect(handlerEventNames).toContain(`agent:session-updated:${AGENT_B}`);
  });

  // ─── Test 6: Rate limiter no false-positive on sequential sends ───────────
  it('rate limiter does not block sequential sends spaced > MIN_MESSAGE_SEND_INTERVAL', async () => {
    // Bug: Rate limiter false-positives on legitimate sequential sends.
    const messages = [makeMessage('1', 'user', 'Hello'), makeMessage('2', 'assistant', 'Hi')];
    setupDefaultState({ messages });
    mockSelectAgentMessages.mockReturnValue(messages);

    (agentService.sendMessage as Mock).mockResolvedValue(undefined);

    // Send first message
    await service.sendMessage('message one', mockWorkspace as any, AGENT_ID);

    // Advance past the rate limit interval (100ms) and the idempotency window (>1s)
    vi.advanceTimersByTime(1100);

    // Send second (different) message — should NOT be rate-limited
    await service.sendMessage('message two', mockWorkspace as any, AGENT_ID);

    // Both sends should have reached the backend
    expect(agentService.sendMessage).toHaveBeenCalledTimes(2);
  });

  // ─── Test 7: Concurrent sendMessage queuing ───────────────────────────────
  it('concurrent sendMessage calls for same agent — second is rate-limited within interval', async () => {
    // The rate limiter (MIN_MESSAGE_SEND_INTERVAL=100ms) should prevent
    // overlapping rapid sends from reaching the backend simultaneously.
    // After the bug fix, the rate limiter throws MessageGuardError instead of
    // silently returning, so the saga can dispatch chatSendFailed to clean up.
    const messages = [makeMessage('1', 'user', 'Hello'), makeMessage('2', 'assistant', 'Hi')];
    setupDefaultState({ messages });
    mockSelectAgentMessages.mockReturnValue(messages);

    (agentService.sendMessage as Mock).mockResolvedValue(undefined);

    // Fire two sends concurrently (same tick, different messages)
    const send1 = service.sendMessage('rapid fire 1', mockWorkspace as any, AGENT_ID);
    const send2 = service.sendMessage('rapid fire 2', mockWorkspace as any, AGENT_ID);
    const results = await Promise.allSettled([send1, send2]);

    // Only the first should have reached the backend (second rate-limited)
    expect(agentService.sendMessage).toHaveBeenCalledTimes(1);
    // The second send should have thrown MessageGuardError
    expect(results[1].status).toBe('rejected');
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(
      MessageGuardError,
    );
  });
});
