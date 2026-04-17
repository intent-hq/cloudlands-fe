import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

let AgentBackendHandlerClass: typeof import('../agent-backend-handler.service').AgentBackendHandler;

function makeHandler() {
  const handler = Object.create(AgentBackendHandlerClass.prototype) as any;
  handler.providers = new Map();
  handler.providerLastUsed = new Map();
  handler.streamStartTimes = new Map();
  handler.streamSessionIds = new Map();
  handler.streamWorkspaceIds = new Map();
  handler.streamWindowIds = new Map();
  handler.streamGenerations = new Map();
  handler.streamHealthChecks = new Map();
  handler.completedStreams = new Map();
  handler.lastPongTimes = new Map();
  handler.lastPingSentTimes = new Map();
  handler.repairedOrphanedAgents = new Set();
  handler.interruptedAgents = new Set();
  handler.interruptedAgentTimeouts = new Map();
  handler.terminatingAgents = new Set();
  handler.queueAgentWorkspaceIds = new Map();
  handler.emptyResponseRetries = new Map();
  handler.activeSessions = new Map();
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
    expect(first.agentData.messages.some((m: any) =>
      m.contentBlocks?.[0]?.text ===
        'Previous response was interrupted before it could complete. Please retry.',
    )).toBe(true);

    mockPersistence.saveAgent.mockClear();
    // Simulate the already-repaired persisted state coming back.
    mockPersistence.loadAgent.mockResolvedValue({
      success: true,
      data: { ...baseAgent, isStreaming: false, isProcessing: false, status: 'Idle' },
    });
    const second = await handler.getAgentResumability(agentId, workspaceId);
    expect(second.status).toBe('resumable');
    expect(mockPersistence.saveAgent).not.toHaveBeenCalled();
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
});
