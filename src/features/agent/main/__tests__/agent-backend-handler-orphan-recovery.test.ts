import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mockPersistence = {
  loadAgent: vi.fn(),
  saveAgent: vi.fn(),
};

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/test-intent'),
    getName: vi.fn().mockReturnValue('Intent'),
    getVersion: vi.fn().mockReturnValue('1.0.0'),
    isReady: vi.fn(() => true),
    on: vi.fn(),
    once: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    fromWebContents: vi.fn(() => null),
  },
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}));

vi.mock('../../../workspace/main/workspace.service', () => ({
  workspaceService: {},
}));

vi.mock('../agent-persistence', () => ({
  agentPersistence: mockPersistence,
  UnifiedPersistence: { getInstance: () => mockPersistence },
}));

vi.mock('../../../../store/main/redux-store-bridge', () => ({
  getMainState: vi.fn(() => ({ agentSubscriptions: { byWorkspaceId: {} } })),
}));
vi.mock('../../../../store/main/slices/agent-subscriptions/agent-subscriptions-selectors', () => ({
  selectAgentSubscriptions: { select: vi.fn(() => []) },
}));

// messageAccumulator is a namespace import used by the extracted
// `persistStreamingSessionState` method; stub the single function we need
// (`getPartialContent`) so tests can drive deterministic content blocks.
const mockGetPartialContent = vi.fn(() => ({ contentBlocks: [] as any[] }));
vi.mock('../../../../store/main/slices/message-accumulator/message-accumulator-api', () => ({
  getPartialContent: mockGetPartialContent,
  clear: vi.fn(),
}));

// Minimal stubs for the dependencies `handleSendMessage` pulls in when
// driven end-to-end. The T8 closure-capture test below calls the real
// `handleSendMessage` — which requires these modules to be present — but
// the other tests in this file do not, so the stubs are permissive no-ops.
vi.mock('$shared/main/memory-event-logger', () => ({
  memEvents: {
    agentTurnStart: vi.fn(),
    agentTurnComplete: vi.fn(),
    cleanupStart: vi.fn(),
    cleanupComplete: vi.fn(),
    custom: vi.fn(),
  },
}));
vi.mock('../../system/main/system.ipc', () => ({
  getWindowIdForWorkspace: vi.fn(() => undefined),
  getWindowIdsForWorkspace: vi.fn(() => []),
}));
vi.mock('../../events/main/agent-subscription-ops', () => ({
  updateAgentStatus: vi.fn(),
}));

let AgentBackendHandlerClass: typeof import('../agent-backend-handler.service').AgentBackendHandler;

function makeHandler() {
  const handler = Object.create(AgentBackendHandlerClass.prototype) as any;
  handler.providers = new Map();
  handler.providerLastUsed = new Map();
  handler.streamStartTimes = new Map();
  handler.streamSessionIds = new Map();
  handler.streamWorkspaceIds = new Map();
  handler.streamAssistantMessageIds = new Map();
  handler.streamAssistantAppMessageIds = new Map();
  handler.streamWindowIds = new Map();
  handler.streamGenerations = new Map();
  handler.streamHealthChecks = new Map();
  handler.completedStreams = new Map();
  handler.lastPongTimes = new Map();
  handler.lastPingSentTimes = new Map();
  handler.repairedOrphanedAgents = new Map<string, string>();
  handler.interruptedAgents = new Set();
  handler.interruptedAgentTimeouts = new Map();
  handler.terminatingAgents = new Map<string, number>();
  handler.queueAgentWorkspaceIds = new Map();
  handler.emptyResponseRetries = new Map();
  handler.activeSessions = new Map();
  handler.messageQueues = new Map();
  handler.sendStreamToRenderer = vi.fn();
  handler.getBackend = vi.fn(async () => ({
    backendStop: vi.fn(async () => ({ success: true })),
  }));
  handler.startInterruptedAgentSafetyTimeout = vi.fn();
  return handler;
}

describe('AgentBackendHandler orphan recovery', () => {
  beforeAll(async () => {
    ({ AgentBackendHandler: AgentBackendHandlerClass } = await vi.importActual(
      '../agent-backend-handler.service',
    ));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockPersistence.saveAgent.mockResolvedValue({ success: true });
    mockGetPartialContent.mockReturnValue({ contentBlocks: [] });
  });

  it('handleStopSession repairs orphaned streaming state when no provider and emits stream-error', async () => {
    const handler = makeHandler();
    const agentId = 'agent-orphan-1';
    const workspaceId = 'ws-1';
    handler.streamWorkspaceIds.set(agentId, workspaceId);
    handler.streamSessionIds.set(agentId, 'sess-1');
    handler.streamStartTimes.set(agentId, Date.now());
    mockPersistence.loadAgent.mockResolvedValue({
      success: true,
      data: {
        id: agentId,
        workspaceId,
        messages: [],
        isStreaming: true,
        isProcessing: true,
        status: 'active',
      },
    });

    const res = await handler.handleStopSession(null, { agentId, workspaceId });
    expect(res).toEqual({ success: true });
    expect(mockPersistence.saveAgent).toHaveBeenCalledTimes(1);
    const saved = mockPersistence.saveAgent.mock.calls[0][0];
    expect(saved.isStreaming).toBe(false);
    expect(saved.isProcessing).toBe(false);
    expect(saved.status).toBe('Idle');
    expect(saved.messages.length).toBe(1);
    expect(saved.messages[0].role).toBe('assistant');
    expect(handler.sendStreamToRenderer).toHaveBeenCalledWith(
      agentId,
      `agent:stream:${agentId}`,
      expect.objectContaining({ type: 'error' }),
    );
    expect(handler.repairedOrphanedAgents.has(agentId)).toBe(true);
  });

  it('getAgentResumability repairs orphan once, second call is a no-op', async () => {
    const handler = makeHandler();
    const agentId = 'agent-orphan-2';
    const workspaceId = 'ws-2';
    const baseAgent = {
      id: agentId,
      workspaceId,
      messages: [],
      isStreaming: true,
      isProcessing: false,
      status: 'active',
    };
    mockPersistence.loadAgent.mockResolvedValue({ success: true, data: { ...baseAgent } });

    const first = await handler.getAgentResumability(agentId, workspaceId);
    expect(first.status).toBe('resumable');
    expect(mockPersistence.saveAgent).toHaveBeenCalledTimes(1);
    expect(first.agentData.isStreaming).toBe(false);
    expect(first.agentData.status).toBe('Idle');
    // T11: assert exactly one saved message carries the recovery text after first repair.
    const savedAfterFirst = mockPersistence.saveAgent.mock.calls[0][0];
    const recoveryBannersFirst = savedAfterFirst.messages.filter(
      (m: any) =>
        m.contentBlocks?.[0]?.text ===
        'Previous response was interrupted before it could complete. Please retry.',
    );
    expect(recoveryBannersFirst).toHaveLength(1);
    expect(first.agentData.messages.some((m: any) =>
      m.contentBlocks?.[0]?.text ===
        'Previous response was interrupted before it could complete. Please retry.',
    )).toBe(true);

    mockPersistence.saveAgent.mockClear();
    // Simulate the already-repaired persisted state coming back: session flags
    // are idle AND the recovery banner is already the last message.
    mockPersistence.loadAgent.mockResolvedValue({
      success: true,
      data: {
        ...baseAgent,
        isStreaming: false,
        isProcessing: false,
        status: 'Idle',
        messages: savedAfterFirst.messages,
      },
    });
    const second = await handler.getAgentResumability(agentId, workspaceId);
    expect(second.status).toBe('resumable');
    // T11: second load must NOT trigger a save AND must still have exactly one banner.
    expect(mockPersistence.saveAgent).not.toHaveBeenCalled();
    const bannersSecond = (second.agentData?.messages || []).filter(
      (m: any) =>
        m.contentBlocks?.[0]?.text ===
        'Previous response was interrupted before it could complete. Please retry.',
    );
    expect(bannersSecond).toHaveLength(1);
  });

  it('persistShutdownState flushes streaming agents without appending any message', async () => {
    const handler = makeHandler();
    const agentId = 'agent-shutdown-1';
    const workspaceId = 'ws-shutdown';
    handler.streamStartTimes.set(agentId, Date.now());
    handler.streamWorkspaceIds.set(agentId, workspaceId);
    mockPersistence.loadAgent.mockResolvedValue({
      success: true,
      data: {
        id: agentId,
        workspaceId,
        messages: [],
        isStreaming: true,
        isProcessing: true,
        status: 'active',
      },
    });

    const result = await handler.persistShutdownState();

    expect(mockPersistence.saveAgent).toHaveBeenCalledTimes(1);
    const saved = mockPersistence.saveAgent.mock.calls[0][0];
    expect(saved.isStreaming).toBe(false);
    expect(saved.isProcessing).toBe(false);
    expect(saved.status).toBe('Idle');
    // Clean quit path must NOT append an assistant message.
    expect(saved.messages.length).toBe(0);
    expect(result).toEqual({
      persisted: [agentId],
      skipped: [],
      failed: [],
    });
  });

  it('persistShutdownState is a no-op when there are no streaming agents', async () => {
    const handler = makeHandler();
    const result = await handler.persistShutdownState();
    expect(mockPersistence.loadAgent).not.toHaveBeenCalled();
    expect(mockPersistence.saveAgent).not.toHaveBeenCalled();
    expect(result).toEqual({ persisted: [], skipped: [], failed: [] });
  });

  it('persistShutdownState reports failed agents when saveAgent fails', async () => {
    const handler = makeHandler();
    const okId = 'agent-ok';
    const badId = 'agent-bad';
    handler.streamStartTimes.set(okId, Date.now());
    handler.streamStartTimes.set(badId, Date.now());
    handler.streamWorkspaceIds.set(okId, 'ws');
    handler.streamWorkspaceIds.set(badId, 'ws');
    mockPersistence.loadAgent.mockImplementation(async (id: string) => ({
      success: true,
      data: { id, workspaceId: 'ws', messages: [], isStreaming: true, status: 'active' },
    }));
    mockPersistence.saveAgent.mockImplementation(async (agent: any) => {
      if (agent.id === badId) return { success: false, error: 'disk full' };
      return { success: true };
    });

    const result = await handler.persistShutdownState();
    expect(result.persisted).toEqual([okId]);
    expect(result.failed).toEqual([badId]);
    expect(result.skipped).toEqual([]);
  });

  it('repairOrphanedStreamingState does NOT mark agent as repaired when save fails', async () => {
    const handler = makeHandler();
    const agentId = 'agent-repair-fail';
    const workspaceId = 'ws-fail';
    // Resumability path: hasProvider=false, persisted isStreaming=true, not yet repaired.
    mockPersistence.loadAgent.mockResolvedValue({
      success: true,
      data: {
        id: agentId,
        workspaceId,
        messages: [],
        isStreaming: true,
        isProcessing: false,
        status: 'active',
      },
    });
    mockPersistence.saveAgent.mockResolvedValue({ success: false, error: 'io error' });

    const res = await handler.getAgentResumability(agentId, workspaceId);
    expect(res.status).toBe('resumable');
    // Critical: save failed → agent must NOT be marked repaired, so a retry can happen.
    expect(handler.repairedOrphanedAgents.has(agentId)).toBe(false);
  });

  it('handleHttpBridgeUnrecoverable clears every streaming agent and emits errors', async () => {
    const handler = makeHandler();
    handler.streamStartTimes.set('a1', Date.now());
    handler.streamStartTimes.set('a2', Date.now());
    handler.streamWorkspaceIds.set('a1', 'ws-a');
    handler.streamWorkspaceIds.set('a2', 'ws-b');
    mockPersistence.loadAgent.mockImplementation(async (id: string) => ({
      success: true,
      data: { id, workspaceId: 'ws', messages: [], isStreaming: true, status: 'active' },
    }));

    await handler.handleHttpBridgeUnrecoverable();
    expect(mockPersistence.saveAgent).toHaveBeenCalledTimes(2);
    expect(handler.sendStreamToRenderer).toHaveBeenCalledTimes(2);
    expect(handler.streamStartTimes.size).toBe(0);
  });

  it('handleHttpBridgeUnrecoverable stops live providers and removes them from the map', async () => {
    const handler = makeHandler();
    const agentId = 'agent-with-provider';
    handler.streamStartTimes.set(agentId, Date.now());
    handler.streamWorkspaceIds.set(agentId, 'ws-1');
    handler.streamSessionIds.set(agentId, 'sess-1');

    const provider = {
      stop: vi.fn(async () => {}),
      cleanup: vi.fn(),
    };
    handler.providers.set(agentId, provider);
    handler.providerLastUsed.set(agentId, Date.now());

    mockPersistence.loadAgent.mockResolvedValue({
      success: true,
      data: {
        id: agentId,
        workspaceId: 'ws-1',
        messages: [],
        isStreaming: true,
        status: 'active',
      },
    });

    await handler.handleHttpBridgeUnrecoverable();

    // Provider was stopped with forceCleanup and removed from the map.
    expect(provider.stop).toHaveBeenCalledWith({ forceCleanup: true });
    expect(handler.providers.has(agentId)).toBe(false);
    expect(handler.providerLastUsed.has(agentId)).toBe(false);
  });

  it('handleHttpBridgeUnrecoverable does not throw when provider.stop fails', async () => {
    const handler = makeHandler();
    const agentId = 'agent-provider-throws';
    handler.streamStartTimes.set(agentId, Date.now());
    handler.streamWorkspaceIds.set(agentId, 'ws-1');

    const provider = {
      stop: vi.fn(async () => {
        throw new Error('stop failed');
      }),
    };
    handler.providers.set(agentId, provider);
    mockPersistence.loadAgent.mockResolvedValue({
      success: true,
      data: { id: agentId, workspaceId: 'ws-1', messages: [], isStreaming: true, status: 'active' },
    });

    await expect(handler.handleHttpBridgeUnrecoverable()).resolves.toBeUndefined();
    // Even though stop threw, the provider was still removed from the map.
    expect(handler.providers.has(agentId)).toBe(false);
  });

  // T3 (P1): persistShutdownState uses per-agent timeouts and reports still-
  // pending agents as failed when the timeout fires.
  it('T3: persistShutdownState reports failed on per-agent timeout when saveAgent never settles', async () => {
    vi.useFakeTimers();
    try {
      const handler = makeHandler();
      const agentId = 'agent-timeout';
      handler.streamStartTimes.set(agentId, Date.now());
      handler.streamWorkspaceIds.set(agentId, 'ws-timeout');
      mockPersistence.loadAgent.mockResolvedValue({
        success: true,
        data: {
          id: agentId,
          workspaceId: 'ws-timeout',
          messages: [],
          isStreaming: true,
          status: 'active',
        },
      });
      // Never-settling saveAgent.
      mockPersistence.saveAgent.mockImplementation(() => new Promise(() => {}));

      const resultPromise = handler.persistShutdownState(25);
      await vi.advanceTimersByTimeAsync(25);
      const result = await resultPromise;

      expect(result).toEqual({ persisted: [], skipped: [], failed: [agentId] });
    } finally {
      vi.useRealTimers();
    }
  });

  // T4 (P1): handleStopSession must NOT mark an agent as repaired when the
  // orphan repair save fails, so a retry on the next user action can run.
  it('T4: handleStopSession does not mark repaired when orphan repair save fails', async () => {
    const handler = makeHandler();
    const agentId = 'agent-stop-repair-fail';
    const workspaceId = 'ws-stop-fail';
    // No provider registered → handleStopSession falls into the orphan-repair branch.
    handler.streamWorkspaceIds.set(agentId, workspaceId);
    handler.streamSessionIds.set(agentId, 'sess-stop-fail');
    handler.streamStartTimes.set(agentId, Date.now());
    mockPersistence.loadAgent.mockResolvedValue({
      success: true,
      data: {
        id: agentId,
        workspaceId,
        messages: [],
        isStreaming: true,
        isProcessing: true,
        status: 'active',
      },
    });
    mockPersistence.saveAgent.mockResolvedValue({ success: false, error: 'io error' });

    const res = await handler.handleStopSession(null, { agentId, workspaceId });
    expect(res).toEqual({ success: true });
    // Critical: save failed → agent must NOT be marked repaired.
    expect(handler.repairedOrphanedAgents.has(agentId)).toBe(false);
  });

  // T7 (P2): handleHttpBridgeUnrecoverable continues teardown even when the
  // repair save fails and the terminatingAgents guard is cleared afterwards.
  it('T7: handleHttpBridgeUnrecoverable continues teardown and clears guards when repair save fails', async () => {
    const handler = makeHandler();
    const agentId = 'agent-teardown-fail';
    handler.streamStartTimes.set(agentId, Date.now());
    handler.streamWorkspaceIds.set(agentId, 'ws-teardown');
    handler.streamSessionIds.set(agentId, 'sess-teardown');

    const provider = { stop: vi.fn(async () => {}) };
    handler.providers.set(agentId, provider);
    handler.providerLastUsed.set(agentId, Date.now());

    mockPersistence.loadAgent.mockResolvedValue({
      success: true,
      data: {
        id: agentId,
        workspaceId: 'ws-teardown',
        messages: [],
        isStreaming: true,
        status: 'active',
      },
    });
    mockPersistence.saveAgent.mockResolvedValue({ success: false, error: 'disk full' });

    await handler.handleHttpBridgeUnrecoverable();

    expect(provider.stop).toHaveBeenCalledWith({ forceCleanup: true });
    expect(handler.providers.has(agentId)).toBe(false);
    expect(handler.providerLastUsed.has(agentId)).toBe(false);
    expect(handler.sendStreamToRenderer).toHaveBeenCalledWith(
      agentId,
      `agent:stream:${agentId}`,
      expect.objectContaining({ type: 'error' }),
    );
    // Stream tracking cleared.
    expect(handler.streamStartTimes.has(agentId)).toBe(false);
    // Guard cleared so future restarts of this agent can persist.
    expect(handler.terminatingAgents.has(agentId)).toBe(false);
  });

  // T8 (P1): persistShutdownState populates `terminatingAgents` BEFORE the
  // first persistence await, so any concurrent streaming-callback path (which
  // reads the same set) short-circuits before re-dirtying disk. This locks
  // in the ordering contract that the in-closure `persistStreamingState`
  // guard relies on — any reshuffle that flips the order is a regression.
  it('T8: persistShutdownState populates terminatingAgents before any persistence I/O', async () => {
    const handler = makeHandler();
    const agentId = 'agent-guarded';
    handler.streamStartTimes.set(agentId, Date.now());
    handler.streamWorkspaceIds.set(agentId, 'ws-guarded');

    let wasTerminatingAtLoad = false;
    let wasTerminatingAtSave = false;
    mockPersistence.loadAgent.mockImplementation(async () => {
      wasTerminatingAtLoad = handler.terminatingAgents.has(agentId);
      return {
        success: true,
        data: {
          id: agentId,
          workspaceId: 'ws-guarded',
          messages: [],
          isStreaming: true,
          status: 'active',
        },
      };
    });
    mockPersistence.saveAgent.mockImplementation(async () => {
      wasTerminatingAtSave = handler.terminatingAgents.has(agentId);
      return { success: true };
    });

    const result = await handler.persistShutdownState(1000);
    expect(result).toEqual({ persisted: [agentId], skipped: [], failed: [] });
    expect(wasTerminatingAtLoad).toBe(true);
    expect(wasTerminatingAtSave).toBe(true);
    // Guard is intentionally NOT cleared by persistShutdownState — the app
    // is quitting, so late callbacks must stay suppressed until process exit.
    expect(handler.terminatingAgents.has(agentId)).toBe(true);
  });

  // T8 completion (P1): drive the REAL in-closure `persistStreamingState`
  // wrapper that `handleSendMessage` creates for every streaming turn.
  // That closure owns the per-turn `persistInProgress` mutex AND delegates
  // to the extracted `persistStreamingSessionState` method — the fix under
  // test hinges on both pieces running as a unit, not on the extracted
  // method alone.
  //
  // Approach: per the task note's explicit fallback (driving the full
  // streamMessage pipeline via a real ACP subprocess is not feasible in
  // unit tests), we stub the provider so `handleSendMessage` reaches the
  // point where it calls `provider.streamMessage(messages, options)` and
  // captures `options.onContentBlocks`. That captured callback is the
  // ACTUAL closure reference — invoking it runs the same code path that
  // fires on every real content-block event, exercising the mutex, the
  // entry guard, AND the save guard in one shot.
  it('T8: in-closure persistStreamingState short-circuits while guard is set and saves after it clears', async () => {
    const handler = makeHandler();
    const agentId = 'agent-closure-guarded';
    const workspaceId = 'ws-closure-guarded';

    // Capture the streamMessage options so we can grab the real in-closure
    // `persistStreamingState` reference via options.onContentBlocks. Resolve
    // the returned promise immediately — we don't exercise the completion
    // path, only the content-block callback.
    let capturedOptions: any = null;
    const mockProvider: any = {
      isHealthy: vi.fn(() => true),
      sessionId: 'sess-closure-guarded',
      on: vi.fn(),
      streamMessage: vi.fn(async (_messages: any, options: any) => {
        capturedOptions = options;
      }),
    };
    handler.providers.set(agentId, mockProvider);
    handler.providerLastUsed.set(agentId, Date.now());

    // Backend session the extracted method will find and (re-)save. The
    // outer `handleSendMessage` also calls getSession for metrics and the
    // `userMessage` path — we only go through metrics here because the
    // request below passes no content/attachments, so no userMessage is
    // synthesized.
    const backendSession: any = {
      id: agentId,
      workspaceId,
      messages: [],
      updatedAt: new Date(0),
    };
    handler.getBackend = vi.fn(async () => ({
      getSession: vi.fn(() => backendSession),
    }));
    handler.sendToRenderer = vi.fn();
    handler.sendStreamToRenderer = vi.fn();
    handler.emitAgentStartedEvent = vi.fn();
    handler.startStreamHealthCheck = vi.fn();
    handler.touchProvider = vi.fn();
    handler.estimateSessionSizeKB = vi.fn(() => 0);

    // Seed the stream maps the way an in-flight turn would.
    handler.streamStartTimes.set(agentId, Date.now());
    handler.streamSessionIds.set(agentId, 'sess-closure-guarded');
    handler.streamWorkspaceIds.set(agentId, workspaceId);

    // Frontend-passed messages ending in a user turn keeps `handleSendMessage`
    // on the fast path (no persistence load, no naming instructions since the
    // default agent name 'Agent' is not a random Adjective-Animal pattern,
    // and no user-message synthesis since request.content is empty).
    await handler.handleSendMessage(null, {
      agentId,
      sessionId: 'sess-closure-guarded',
      streamId: 'stream-1',
      workspaceId,
      messages: [
        {
          id: 'u-1',
          role: 'user',
          contentBlocks: [{ type: 'text', text: 'hello' }],
        },
      ],
    });

    // streamMessage must have been reached; onContentBlocks IS the closure.
    expect(mockProvider.streamMessage).toHaveBeenCalledTimes(1);
    expect(capturedOptions).toBeTruthy();
    expect(typeof capturedOptions.onContentBlocks).toBe('function');

    mockGetPartialContent.mockReturnValue({
      contentBlocks: [{ type: 'text', text: 'streamed chunk' }],
    });

    // Seed the guard as persistShutdownState would just before a racing
    // content-block fires.
    handler.terminatingAgents.set(agentId, 1);

    // Fire a content-block through the captured real closure. The closure
    // calls `persistStreamingState('content-block')` which awaits
    // `this.persistStreamingSessionState(agentId, 'content-block')` — its
    // entry guard must short-circuit and saveAgent must NOT fire.
    capturedOptions.onContentBlocks([{ type: 'text', text: 'streamed chunk' }]);
    // The closure is invoked fire-and-forget from onContentBlocks; wait for
    // the microtask chain (persistStreamingState → persistStreamingSessionState
    // → getBackend) to settle.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(mockPersistence.saveAgent).not.toHaveBeenCalled();

    // Release the guard and fire another content-block through the SAME
    // captured closure. saveAgent must fire this time.
    handler.terminatingAgents.delete(agentId);
    capturedOptions.onContentBlocks([{ type: 'text', text: 'streamed chunk' }]);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(mockPersistence.saveAgent).toHaveBeenCalledTimes(1);
    const saved = mockPersistence.saveAgent.mock.calls[0][0];
    expect(saved.id).toBe(agentId);
    const streamingMsg = saved.messages.find(
      (m: any) => m.role === 'assistant' && m.isStreaming,
    );
    expect(streamingMsg).toBeDefined();
    expect(streamingMsg.contentBlocks).toEqual([
      { type: 'text', text: 'streamed chunk' },
    ]);
  });

  // Regression for proposal-block persistence race:
  // emitProposalToChat adds a block to the message accumulator and fires the
  // same content-block callback the LLM stream uses, but inside the
  // synchronous tail of a fast tool execution. The previous closure dropped
  // the second persist request entirely if the first persist's saveAgent was
  // still in flight, so the proposal block was never written to disk and was
  // missing from history after reload. The closure must queue a single
  // follow-up persist so the latest accumulator state always reaches disk.
  it('queues a follow-up persist when a content-block fires while an earlier save is still flushing', async () => {
    const handler = makeHandler();
    const agentId = 'agent-followup-persist';
    const workspaceId = 'ws-followup-persist';

    let capturedOptions: any = null;
    const mockProvider: any = {
      isHealthy: vi.fn(() => true),
      sessionId: 'sess-followup',
      on: vi.fn(),
      streamMessage: vi.fn(async (_messages: any, options: any) => {
        capturedOptions = options;
      }),
    };
    handler.providers.set(agentId, mockProvider);
    handler.providerLastUsed.set(agentId, Date.now());

    const backendSession: any = {
      id: agentId,
      workspaceId,
      messages: [],
      updatedAt: new Date(0),
    };
    handler.getBackend = vi.fn(async () => ({
      getSession: vi.fn(() => backendSession),
    }));
    handler.sendToRenderer = vi.fn();
    handler.sendStreamToRenderer = vi.fn();
    handler.emitAgentStartedEvent = vi.fn();
    handler.startStreamHealthCheck = vi.fn();
    handler.touchProvider = vi.fn();
    handler.estimateSessionSizeKB = vi.fn(() => 0);

    handler.streamStartTimes.set(agentId, Date.now());
    handler.streamSessionIds.set(agentId, 'sess-followup');
    handler.streamWorkspaceIds.set(agentId, workspaceId);

    await handler.handleSendMessage(null, {
      agentId,
      sessionId: 'sess-followup',
      streamId: 'stream-followup',
      workspaceId,
      messages: [
        {
          id: 'u-1',
          role: 'user',
          contentBlocks: [{ type: 'text', text: 'archive ability-add' }],
        },
      ],
    });
    expect(typeof capturedOptions?.onContentBlocks).toBe('function');

    // Gate the first saveAgent: it will hang until we resolve `releaseFirst`,
    // simulating the disk-write delay during which the proposal's persist
    // request arrives.
    let releaseFirst!: () => void;
    const firstSavePending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    mockPersistence.saveAgent.mockReset();
    mockPersistence.saveAgent
      .mockImplementationOnce(async () => {
        await firstSavePending;
        return { success: true };
      })
      .mockImplementation(async () => ({ success: true }));

    // First content-block: tool_use streamed by the LLM. getPartialContent
    // returns just the tool_use because that's all the accumulator has so far.
    const toolUseBlock = {
      type: 'tool_use' as const,
      id: 'tool-1',
      name: 'Propose archive of ability-add',
      input: { code: 'return await ws.app.workspaces.archive("ability-add")' },
    };
    mockGetPartialContent.mockReturnValue({ contentBlocks: [toolUseBlock] });
    capturedOptions.onContentBlocks([toolUseBlock]);

    // Let the closure start the first save and hit `await saveAgent`.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(mockPersistence.saveAgent).toHaveBeenCalledTimes(1);

    // Second content-block fires while the first save is still pending —
    // this is the proposal block emitProposalToChat would add. The
    // accumulator now contains both blocks.
    const proposalBlock = {
      type: 'proposal' as const,
      kind: 'bulk-op',
      payload: { operation: 'workspace.bulkArchive', ids: ['ability-add'] },
      preview: { title: 'Archive 1 workspace' },
      applyToolCallId: 'tool-1',
      proposal: {
        kind: 'bulk-op',
        payload: { operation: 'workspace.bulkArchive', ids: ['ability-add'] },
        preview: { title: 'Archive 1 workspace' },
        applyToolCallId: 'tool-1',
      },
    };
    mockGetPartialContent.mockReturnValue({
      contentBlocks: [toolUseBlock, proposalBlock],
    });
    capturedOptions.onContentBlocks([proposalBlock]);

    // The second persist must NOT have started yet — the guard is still set.
    await new Promise((r) => setImmediate(r));
    expect(mockPersistence.saveAgent).toHaveBeenCalledTimes(1);

    // Release the first save. The follow-up persist must then run with the
    // latest accumulator state (both blocks).
    releaseFirst();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(mockPersistence.saveAgent).toHaveBeenCalledTimes(2);
    const secondSaved = mockPersistence.saveAgent.mock.calls[1][0];
    const streamingMsg = secondSaved.messages.find(
      (m: any) => m.role === 'assistant' && m.isStreaming,
    );
    expect(streamingMsg).toBeDefined();
    expect(streamingMsg.contentBlocks).toEqual([toolUseBlock, proposalBlock]);
  });

  it('persists interrupted active-provider streams as non-streaming before completion emission', async () => {
    const handler = makeHandler();
    const agentId = 'agent-active-interrupted';
    const workspaceId = 'ws-active-interrupted';
    const assistantMessageId = 'assistant-streaming';
    const assistantAppMessageId = 'app-assistant-streaming';

    const backendSession: any = {
      id: agentId,
      workspaceId,
      messages: [
        { id: 'u-1', role: 'user', contentBlocks: [{ type: 'text', text: 'hello' }] },
        {
          id: assistantMessageId,
          appMessageId: assistantAppMessageId,
          role: 'assistant',
          isStreaming: true,
          streamingComplete: false,
          contentBlocks: [{ type: 'text', text: 'partial' }],
          timestamp: new Date(0).toISOString(),
        },
      ],
      isStreaming: true,
      isProcessing: true,
      status: 'active',
      updatedAt: new Date(0),
    };
    handler.getBackend = vi.fn(async () => ({
      getSession: vi.fn(() => backendSession),
    }));
    handler.emitAgentStartedEvent = vi.fn();
    handler.startStreamHealthCheck = vi.fn();
    handler.sendToRenderer = vi.fn();
    handler.sendStreamToRenderer = vi.fn();

    const mockProvider: any = {
      isHealthy: vi.fn(() => true),
      streamMessage: vi.fn(async (_messages: any, options: any) => {
        await options.onError(new Error('Agent interrupted'));
      }),
    };
    handler.providers.set(agentId, mockProvider);
    handler.providerLastUsed.set(agentId, Date.now());
    mockGetPartialContent.mockReturnValue({
      contentBlocks: [{ type: 'text', text: 'interrupted partial' }],
    });

    const result = await handler.handleSendMessage(null, {
      agentId,
      sessionId: agentId,
      streamId: 'stream-interrupted',
      workspaceId,
      assistantMessageId,
      assistantAppMessageId,
      messages: [
        {
          id: 'u-1',
          role: 'user',
          contentBlocks: [{ type: 'text', text: 'hello' }],
        },
      ],
    });

    expect(result).toEqual({ success: true });
    expect(mockPersistence.saveAgent).toHaveBeenCalledTimes(1);
    const saved = mockPersistence.saveAgent.mock.calls[0][0];
    expect(saved.isStreaming).toBe(false);
    expect(saved.isProcessing).toBe(false);
    expect(saved.status).toBe('Idle');
    const savedAssistant = saved.messages.find((m: any) => m.id === assistantMessageId);
    expect(savedAssistant.isStreaming).toBe(false);
    expect(savedAssistant.streamingComplete).toBe(true);
    expect(savedAssistant.contentBlocks).toEqual([
      { type: 'text', text: 'interrupted partial' },
    ]);
    expect(savedAssistant.metadata).toEqual(
      expect.objectContaining({ interrupted: true, stopReason: 'cancelled' }),
    );
    expect(handler.sendStreamToRenderer).toHaveBeenCalledWith(
      agentId,
      `agent:stream:${agentId}`,
      expect.objectContaining({ type: 'complete', streamId: 'stream-interrupted' }),
    );
  });

  it('final persistence replaces a stale same-app assistant placeholder instead of appending', async () => {
    const handler = makeHandler();
    const agentId = 'agent-final-dedup';
    const workspaceId = 'ws-final-dedup';
    const assistantMessageId = 'assistant-active-final';
    const assistantAppMessageId = 'app-assistant-active-final';
    const finalBlocks = [{ type: 'text', text: 'final answer' }];

    const backendSession: any = {
      id: agentId,
      workspaceId,
      messages: [
        { id: 'u-1', role: 'user', contentBlocks: [{ type: 'text', text: 'hello' }] },
        {
          id: 'assistant-stale-placeholder',
          appMessageId: assistantAppMessageId,
          role: 'assistant',
          isStreaming: false,
          contentBlocks: [{ type: 'text', text: 'placeholder' }],
        },
      ],
      updatedAt: new Date(0),
    };
    handler.getBackend = vi.fn(async () => ({ getSession: vi.fn(() => backendSession) }));
    handler.emitAgentStartedEvent = vi.fn();
    handler.startStreamHealthCheck = vi.fn();
    handler.sendToRenderer = vi.fn();
    handler.finalizeStream = vi.fn();
    handler.emitAgentIdleEvent = vi.fn();
    handler.estimateSessionSizeKB = vi.fn(() => 0);
    handler.estimateContentSizeKB = vi.fn(() => 0);

    const mockProvider: any = {
      isHealthy: vi.fn(() => true),
      getConfig: vi.fn(() => ({ model: 'test-model' })),
      streamMessage: vi.fn(async (_messages: any, options: any) => {
        await options.onComplete({
          id: 'provider-final-id',
          contentBlocks: finalBlocks,
          metadata: { stopReason: 'provider_stopped' },
        });
      }),
    };
    handler.providers.set(agentId, mockProvider);
    handler.providerLastUsed.set(agentId, Date.now());

    await handler.handleSendMessage(null, {
      agentId,
      sessionId: agentId,
      streamId: 'stream-final-dedup',
      workspaceId,
      assistantMessageId,
      assistantAppMessageId,
      messages: [{ id: 'u-1', role: 'user', contentBlocks: [{ type: 'text', text: 'hello' }] }],
    });

    expect(mockPersistence.saveAgent).toHaveBeenCalledTimes(1);
    const saved = mockPersistence.saveAgent.mock.calls[0][0];
    expect(saved.messages).toHaveLength(2);
    const savedAssistant = saved.messages.find((m: any) => m.role === 'assistant');
    expect(savedAssistant.id).toBe(assistantMessageId);
    expect(savedAssistant.appMessageId).toBe(assistantAppMessageId);
    expect(savedAssistant.contentBlocks).toEqual(finalBlocks);
    expect(saved.messages.filter((m: any) => m.appMessageId === assistantAppMessageId)).toHaveLength(1);
  });

  it('end_turn with only a proposal block does NOT trigger auto-continue retry', async () => {
    // Regression: the empty-end_turn detector treats `proposal` (and `nav-link`)
    // as meaningful non-text content. Without this, an MCP tool that emits only
    // a proposal block (e.g. ws.app.workspaces.archive) would be mistaken for an
    // empty response and the agent would be re-prompted ("please continue"),
    // duplicating the proposal.
    const handler = makeHandler();
    const agentId = 'agent-proposal-end-turn';
    const workspaceId = 'ws-proposal-end-turn';
    const assistantMessageId = 'assistant-proposal-active';
    const assistantAppMessageId = 'app-assistant-proposal-active';
    const proposalBlock = {
      type: 'proposal' as const,
      kind: 'bulk-op',
      proposal: {
        id: 'proposal-archive-1',
        kind: 'workspace.archive',
        items: [{ id: 'ws-target', title: 'ability-add' }],
      },
      previewTitle: 'Archive 1 workspace',
    };
    const finalBlocks = [proposalBlock];

    const backendSession: any = {
      id: agentId,
      workspaceId,
      messages: [
        { id: 'u-1', role: 'user', contentBlocks: [{ type: 'text', text: 'archive ability-add' }] },
        {
          id: 'assistant-stale-placeholder',
          appMessageId: assistantAppMessageId,
          role: 'assistant',
          isStreaming: false,
          contentBlocks: [],
        },
      ],
      updatedAt: new Date(0),
    };
    handler.getBackend = vi.fn(async () => ({ getSession: vi.fn(() => backendSession) }));
    handler.emitAgentStartedEvent = vi.fn();
    handler.startStreamHealthCheck = vi.fn();
    handler.sendToRenderer = vi.fn();
    handler.finalizeStream = vi.fn();
    handler.emitAgentIdleEvent = vi.fn();
    handler.estimateSessionSizeKB = vi.fn(() => 0);
    handler.estimateContentSizeKB = vi.fn(() => 0);

    const mockProvider: any = {
      isHealthy: vi.fn(() => true),
      getConfig: vi.fn(() => ({ model: 'test-model' })),
      streamMessage: vi.fn(async (_messages: any, options: any) => {
        await options.onComplete({
          id: 'provider-proposal-id',
          contentBlocks: finalBlocks,
          // stopReason: 'end_turn' is the trigger condition for the empty-response
          // detector. With the fix, the proposal block satisfies `hasNonTextContent`
          // and auto-continue is skipped.
          metadata: { stopReason: 'end_turn' },
        });
      }),
    };
    handler.providers.set(agentId, mockProvider);
    handler.providerLastUsed.set(agentId, Date.now());

    await handler.handleSendMessage(null, {
      agentId,
      sessionId: agentId,
      streamId: 'stream-proposal-end-turn',
      workspaceId,
      assistantMessageId,
      assistantAppMessageId,
      messages: [
        { id: 'u-1', role: 'user', contentBlocks: [{ type: 'text', text: 'archive ability-add' }] },
      ],
    });

    // Persistence should complete normally with the proposal preserved.
    expect(mockPersistence.saveAgent).toHaveBeenCalledTimes(1);
    const saved = mockPersistence.saveAgent.mock.calls[0][0];
    const savedAssistant = saved.messages.find((m: any) => m.role === 'assistant');
    expect(savedAssistant.contentBlocks).toEqual(finalBlocks);

    // Auto-continue must NOT have been triggered: the retry counter stays at 0
    // (or absent) and the provider's streamMessage was called exactly once.
    expect(handler.emptyResponseRetries.get(agentId) || 0).toBe(0);
    expect(mockProvider.streamMessage).toHaveBeenCalledTimes(1);
  });

  it('streaming persistence adopts the active request app ID from a stale streaming placeholder', async () => {
    const handler = makeHandler();
    const agentId = 'agent-streaming-adopts-id';
    const workspaceId = 'ws-streaming-adopts-id';
    const backendSession: any = {
      id: agentId,
      workspaceId,
      messages: [
        { id: 'u-1', role: 'user', contentBlocks: [{ type: 'text', text: 'hello' }] },
        {
          id: 'assistant-stale-stream',
          appMessageId: 'app-stale-stream',
          role: 'assistant',
          isStreaming: true,
          contentBlocks: [{ type: 'text', text: 'old partial' }],
        },
      ],
      updatedAt: new Date(0),
    };
    handler.getBackend = vi.fn(async () => ({ getSession: vi.fn(() => backendSession) }));
    mockGetPartialContent.mockReturnValue({
      contentBlocks: [{ type: 'text', text: 'new partial' }],
    });

    await handler.persistStreamingSessionState(
      agentId,
      'content-block',
      'assistant-active-stream',
      'app-active-stream',
    );

    expect(mockPersistence.saveAgent).toHaveBeenCalledTimes(1);
    const saved = mockPersistence.saveAgent.mock.calls[0][0];
    expect(saved.messages).toHaveLength(2);
    const savedAssistant = saved.messages.find((m: any) => m.role === 'assistant');
    expect(savedAssistant.id).toBe('assistant-active-stream');
    expect(savedAssistant.appMessageId).toBe('app-active-stream');
    expect(savedAssistant.isStreaming).toBe(true);
    expect(savedAssistant.contentBlocks).toEqual([{ type: 'text', text: 'new partial' }]);
  });

  it('interrupted persistence replaces a same-app non-streaming placeholder instead of appending', async () => {
    const handler = makeHandler();
    const agentId = 'agent-interrupted-dedup';
    const workspaceId = 'ws-interrupted-dedup';
    const backendSession: any = {
      id: agentId,
      workspaceId,
      messages: [
        { id: 'u-1', role: 'user', contentBlocks: [{ type: 'text', text: 'hello' }] },
        {
          id: 'assistant-placeholder',
          appMessageId: 'app-interrupted-active',
          role: 'assistant',
          isStreaming: false,
          contentBlocks: [{ type: 'text', text: 'placeholder' }],
        },
      ],
      updatedAt: new Date(0),
    };
    handler.getBackend = vi.fn(async () => ({ getSession: vi.fn(() => backendSession) }));
    mockGetPartialContent.mockReturnValue({
      contentBlocks: [{ type: 'text', text: 'interrupted partial' }],
    });

    await handler.persistInterruptedStreamingSessionState(
      agentId,
      'interruption',
      'assistant-interrupted-active',
      'app-interrupted-active',
    );

    expect(mockPersistence.saveAgent).toHaveBeenCalledTimes(1);
    const saved = mockPersistence.saveAgent.mock.calls[0][0];
    expect(saved.messages).toHaveLength(2);
    const savedAssistant = saved.messages.find((m: any) => m.role === 'assistant');
    expect(savedAssistant.id).toBe('assistant-interrupted-active');
    expect(savedAssistant.appMessageId).toBe('app-interrupted-active');
    expect(savedAssistant.isStreaming).toBe(false);
    expect(savedAssistant.streamingComplete).toBe(true);
    expect(savedAssistant.metadata).toEqual(
      expect.objectContaining({ interrupted: true, stopReason: 'cancelled' }),
    );
  });

  it('timeout persistence finalizes the current streaming assistant without adding a duplicate', async () => {
    const handler = makeHandler();
    const agentId = 'agent-timeout-dedup';
    const workspaceId = 'ws-timeout-dedup';
    const backendSession: any = {
      id: agentId,
      workspaceId,
      messages: [
        { id: 'u-1', role: 'user', contentBlocks: [{ type: 'text', text: 'hello' }] },
        {
          id: 'assistant-timeout-stream',
          appMessageId: 'app-timeout-stream',
          role: 'assistant',
          isStreaming: true,
          contentBlocks: [{ type: 'text', text: 'old partial' }],
        },
      ],
      updatedAt: new Date(0),
    };
    handler.getBackend = vi.fn(async () => ({ getSession: vi.fn(() => backendSession) }));

    const timeoutMessage = await handler.persistTimedOutStreamingSessionState(
      agentId,
      [{ type: 'text', text: 'timeout partial' }],
      1234,
    );

    expect(mockPersistence.saveAgent).toHaveBeenCalledTimes(1);
    const saved = mockPersistence.saveAgent.mock.calls[0][0];
    expect(saved.messages).toHaveLength(2);
    const savedAssistant = saved.messages.find((m: any) => m.role === 'assistant');
    expect(savedAssistant.id).toBe('assistant-timeout-stream');
    expect(savedAssistant.appMessageId).toBe('app-timeout-stream');
    expect(savedAssistant.isStreaming).toBe(false);
    expect(savedAssistant.streamingComplete).toBe(true);
    expect(savedAssistant.metadata).toEqual(expect.objectContaining({ timedOut: true, duration: 1234 }));
    expect(timeoutMessage.id).toBe(savedAssistant.id);
  });

  it('timeout persistence uses active request logical IDs when no streaming placeholder exists', async () => {
    const handler = makeHandler();
    const agentId = 'agent-timeout-active-id';
    const workspaceId = 'ws-timeout-active-id';
    const assistantMessageId = 'assistant-timeout-active';
    const assistantAppMessageId = 'app-timeout-active';
    const backendSession: any = {
      id: agentId,
      workspaceId,
      messages: [{ id: 'u-1', role: 'user', contentBlocks: [{ type: 'text', text: 'hello' }] }],
      updatedAt: new Date(0),
    };
    handler.getBackend = vi.fn(async () => ({ getSession: vi.fn(() => backendSession) }));

    const timeoutMessage = await handler.persistTimedOutStreamingSessionState(
      agentId,
      [{ type: 'text', text: 'timeout partial without placeholder' }],
      4321,
      assistantMessageId,
      assistantAppMessageId,
    );

    expect(mockPersistence.saveAgent).toHaveBeenCalledTimes(1);
    const saved = mockPersistence.saveAgent.mock.calls[0][0];
    expect(saved.messages).toHaveLength(2);
    const savedAssistant = saved.messages.find((m: any) => m.role === 'assistant');
    expect(savedAssistant.id).toBe(assistantMessageId);
    expect(savedAssistant.appMessageId).toBe(assistantAppMessageId);
    expect(savedAssistant.isStreaming).toBe(false);
    expect(savedAssistant.streamingComplete).toBe(true);
    expect(savedAssistant.metadata).toEqual(expect.objectContaining({ timedOut: true, duration: 4321 }));
    expect(saved.messages.filter((m: any) => m.appMessageId === assistantAppMessageId)).toHaveLength(1);
    expect(timeoutMessage.id).toBe(assistantMessageId);
    expect(timeoutMessage.appMessageId).toBe(assistantAppMessageId);
  });

  // T8 completion second guard (P1): the extracted method must re-check the
  // guard IMMEDIATELY BEFORE `saveAgent` so a concurrent shutdown/bridge
  // event that flips the guard during the `getBackend()` await does not
  // get its repair save overwritten by a stale streaming save.
  it('T8: persistStreamingSessionState re-checks guard after await and skips save if flipped', async () => {
    const handler = makeHandler();
    const agentId = 'agent-race-guarded';

    const backendSession: any = {
      id: agentId,
      workspaceId: 'ws-race-guarded',
      messages: [],
      updatedAt: new Date(0),
    };
    // getBackend resolves asynchronously — we flip the guard mid-await.
    handler.getBackend = vi.fn(async () => {
      // Simulate a bridge-unrecoverable / shutdown that acquires the guard
      // after the method started but before the save runs.
      handler.terminatingAgents.set(agentId, 1);
      return { getSession: vi.fn(() => backendSession) };
    });

    mockGetPartialContent.mockReturnValue({
      contentBlocks: [{ type: 'text', text: 'stale chunk' }],
    });

    await handler.persistStreamingSessionState(agentId, 'content-block');
    // Inner guard tripped — no save.
    expect(mockPersistence.saveAgent).not.toHaveBeenCalled();
  });

  // T8 shutdown-save overwrite (P1): a raced streaming callback must not
  // mutate the in-memory backend session returned by `backend.getSession`.
  // That session is shared by reference with
  // `ConsolidatedBackendService`'s `sessions` Map — any `isStreaming: true`
  // mutation left behind would be picked up by the subsequent
  // `ConsolidatedBackendService.shutdown()` `saveAgent` pass and silently
  // overwrite the repaired idle state that `persistShutdownState()` just
  // committed to disk.
  it('T8: persistStreamingSessionState does not mutate in-memory backend session when guard flips mid-await', async () => {
    const handler = makeHandler();
    const agentId = 'agent-shutdown-overwrite';

    const originalUpdatedAt = new Date(0);
    const backendSession: any = {
      id: agentId,
      workspaceId: 'ws-shutdown-overwrite',
      messages: [],
      updatedAt: originalUpdatedAt,
    };
    // Flip the guard mid-`getBackend()` await (the same race window a
    // concurrent `persistShutdownState` / `handleHttpBridgeUnrecoverable`
    // opens between the method's entry guard and its save).
    handler.getBackend = vi.fn(async () => {
      handler.terminatingAgents.set(agentId, 1);
      return { getSession: vi.fn(() => backendSession) };
    });

    mockGetPartialContent.mockReturnValue({
      contentBlocks: [{ type: 'text', text: 'stale chunk' }],
    });

    await handler.persistStreamingSessionState(agentId, 'content-block');

    // No disk write.
    expect(mockPersistence.saveAgent).not.toHaveBeenCalled();
    // AND the in-memory session must be untouched so a later
    // ConsolidatedBackendService.shutdown() saveAgent call cannot write a
    // stale `isStreaming: true` snapshot over the repaired idle state.
    expect(backendSession.messages).toEqual([]);
    expect(backendSession.updatedAt).toBe(originalUpdatedAt);
  });

  // C4 (P1): orphan repair must clear pre-existing `message.isStreaming`
  // flags on individual messages AND session-level `isStreaming` /
  // `isProcessing` flags. Leaving per-message flags set causes the renderer
  // to re-register stale stream handlers / show stuck spinners even after
  // the session flags say idle.
  it('C4: clears pre-existing message.isStreaming flags during orphan repair', async () => {
    const handler = makeHandler();
    const agentId = 'agent-stale-msg-flags';
    const workspaceId = 'ws-stale-msg-flags';

    mockPersistence.loadAgent.mockResolvedValue({
      success: true,
      data: {
        id: agentId,
        workspaceId,
        messages: [
          {
            id: 'm1',
            role: 'assistant',
            isStreaming: true,
            contentBlocks: [{ type: 'text', text: 'partial' }],
            timestamp: new Date(0).toISOString(),
          },
          {
            id: 'm2',
            role: 'user',
            isStreaming: false,
            contentBlocks: [{ type: 'text', text: 'prompt' }],
            timestamp: new Date(0).toISOString(),
          },
        ],
        isStreaming: true,
        isProcessing: true,
        status: 'active',
      },
    });

    const first = await handler.getAgentResumability(agentId, workspaceId);
    expect(first.status).toBe('resumable');
    expect(mockPersistence.saveAgent).toHaveBeenCalledTimes(1);
    const saved = mockPersistence.saveAgent.mock.calls[0][0];
    expect(saved.isStreaming).toBe(false);
    expect(saved.isProcessing).toBe(false);
    expect(saved.status).toBe('Idle');
    // No message must have isStreaming === true after repair. The pre-existing
    // streaming assistant message (`m1`) must have been explicitly flipped
    // to false; messages added by repair (e.g. the recovery banner) simply
    // don't carry the flag.
    const m1 = saved.messages.find((m: any) => m.id === 'm1');
    expect(m1).toBeDefined();
    expect(m1.isStreaming).toBe(false);
    expect(m1.streamingComplete).toBe(true);
    for (const msg of saved.messages) {
      expect(msg.isStreaming).not.toBe(true);
    }
    // And the returned agent data exposes the same cleared flags.
    expect(first.agentData.isStreaming).toBe(false);
    const m1Returned = first.agentData.messages.find((m: any) => m.id === 'm1');
    expect(m1Returned.isStreaming).toBe(false);
    expect(m1Returned.streamingComplete).toBe(true);
    for (const msg of first.agentData.messages) {
      expect(msg.isStreaming).not.toBe(true);
    }
  });

  // Wave 5 (P1): orphan-repair idempotency is per-orphan-event, not per-
  // agent-for-process-lifetime. Loading the SAME stale orphan state twice
  // must short-circuit (no duplicate banner) — the T11 invariant. But if
  // the same agent later becomes orphaned AGAIN in the same process (new
  // stream → crash → new stale state with different updatedAt / last
  // message), repair must run again and emit a fresh banner.
  it('repairs a same-agent reorphan in the same process', async () => {
    const handler = makeHandler();
    const agentId = 'agent-reorphan';
    const workspaceId = 'ws-reorphan';
    const banner = 'Previous response was interrupted before it could complete. Please retry.';

    // --- First orphan: isStreaming=true, single user message ---
    const firstOrphanMessages = [
      { id: 'u-1', role: 'user', contentBlocks: [{ type: 'text', text: 'hello' }] },
    ];
    mockPersistence.loadAgent.mockResolvedValueOnce({
      success: true,
      data: {
        id: agentId,
        workspaceId,
        messages: [...firstOrphanMessages],
        isStreaming: true,
        isProcessing: false,
        status: 'active',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    });

    const first = await handler.getAgentResumability(agentId, workspaceId);
    expect(first.status).toBe('resumable');
    expect(mockPersistence.saveAgent).toHaveBeenCalledTimes(1);
    const savedFirst = mockPersistence.saveAgent.mock.calls[0][0];
    const bannersFirst = savedFirst.messages.filter(
      (m: any) => m.contentBlocks?.[0]?.text === banner,
    );
    expect(bannersFirst).toHaveLength(1);

    // --- Same orphan loaded again (T11 invariant): short-circuit. ---
    // Identical disk state → identical signature → skip repair entirely.
    mockPersistence.saveAgent.mockClear();
    mockPersistence.loadAgent.mockResolvedValueOnce({
      success: true,
      data: {
        id: agentId,
        workspaceId,
        messages: [...firstOrphanMessages],
        isStreaming: true,
        isProcessing: false,
        status: 'active',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
    const second = await handler.getAgentResumability(agentId, workspaceId);
    expect(second.status).toBe('resumable');
    // Same orphan signature → no duplicate banner, no extra save.
    expect(mockPersistence.saveAgent).not.toHaveBeenCalled();

    // --- NEW orphan for SAME agent: later updatedAt + new last message ---
    // A real reorphan after a fresh stream would bump updatedAt and append
    // new messages. Any of those changes is enough to alter the signature.
    mockPersistence.saveAgent.mockClear();
    const reorphanMessages = [
      { id: 'u-1', role: 'user', contentBlocks: [{ type: 'text', text: 'hello' }] },
      { id: 'a-1', role: 'assistant', contentBlocks: [{ type: 'text', text: 'first reply' }] },
      { id: 'u-2', role: 'user', contentBlocks: [{ type: 'text', text: 'again please' }] },
    ];
    mockPersistence.loadAgent.mockResolvedValueOnce({
      success: true,
      data: {
        id: agentId,
        workspaceId,
        messages: [...reorphanMessages],
        isStreaming: true,
        isProcessing: false,
        status: 'active',
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      },
    });
    const third = await handler.getAgentResumability(agentId, workspaceId);
    expect(third.status).toBe('resumable');
    // New orphan signature → repair runs again.
    expect(mockPersistence.saveAgent).toHaveBeenCalledTimes(1);
    const savedThird = mockPersistence.saveAgent.mock.calls[0][0];
    // The reorphan input had no prior banner, so exactly ONE banner must
    // have been appended by this repair — no more, no less.
    const bannersThird = savedThird.messages.filter(
      (m: any) => m.contentBlocks?.[0]?.text === banner,
    );
    expect(bannersThird).toHaveLength(1);
    // And the new signature is now the stored one, so an immediate re-load
    // of the same reorphan would again short-circuit.
    expect(third.agentData.isStreaming).toBe(false);
    expect(third.agentData.status).toBe('Idle');
  });

  // PR review fix: `persistStreamingSessionState` can write an assistant
  // message with `message.isStreaming: true` onto disk without setting
  // session-level `isStreaming`/`isProcessing`. A crash/orphan in that
  // narrow window leaves disk with session flags idle but a per-message
  // streaming flag set. Orphan recovery on `getAgentResumability` must
  // still detect and repair that state; otherwise the renderer re-registers
  // a stream handler for the stale per-message flag and shows a stuck
  // spinner forever.
  it('repairs a message-only orphan (session flags idle, message.isStreaming=true)', async () => {
    const handler = makeHandler();
    const agentId = 'agent-message-only-orphan';
    const workspaceId = 'ws-message-only-orphan';

    mockPersistence.loadAgent.mockResolvedValue({
      success: true,
      data: {
        id: agentId,
        workspaceId,
        messages: [
          {
            id: 'u-1',
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'hello' }],
            timestamp: new Date(0).toISOString(),
          },
          {
            id: 'a-1',
            role: 'assistant',
            isStreaming: true,
            contentBlocks: [{ type: 'text', text: 'partial reply' }],
            timestamp: new Date(0).toISOString(),
          },
        ],
        // Session-level flags are idle / absent — only the per-message flag
        // is set. Without the message-level detection, repair skips entirely.
        isStreaming: false,
        isProcessing: false,
        status: 'Idle',
        updatedAt: new Date('2026-02-01T00:00:00Z'),
      },
    });

    const result = await handler.getAgentResumability(agentId, workspaceId);
    expect(result.status).toBe('resumable');
    // Repair must have fired and saved exactly once.
    expect(mockPersistence.saveAgent).toHaveBeenCalledTimes(1);
    const saved = mockPersistence.saveAgent.mock.calls[0][0];
    expect(saved.isStreaming).toBe(false);
    expect(saved.isProcessing).toBe(false);
    expect(saved.status).toBe('Idle');
    // The stale per-message flag must have been cleared.
    const aMsg = saved.messages.find((m: any) => m.id === 'a-1');
    expect(aMsg).toBeDefined();
    expect(aMsg.isStreaming).toBe(false);
    expect(aMsg.streamingComplete).toBe(true);
    for (const msg of saved.messages) {
      expect(msg.isStreaming).not.toBe(true);
    }
    // And a recovery banner must have been appended so the UI explains what
    // happened.
    const banners = saved.messages.filter(
      (m: any) =>
        m.contentBlocks?.[0]?.text ===
        'Previous response was interrupted before it could complete. Please retry.',
    );
    expect(banners).toHaveLength(1);
    // Returned agent data exposes the same repaired state.
    expect(result.agentData.isStreaming).toBe(false);
    const aReturned = result.agentData.messages.find((m: any) => m.id === 'a-1');
    expect(aReturned.isStreaming).toBe(false);
    expect(aReturned.streamingComplete).toBe(true);
  });
});
