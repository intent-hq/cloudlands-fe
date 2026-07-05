import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

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
  BrowserWindow: { getAllWindows: vi.fn(() => []), fromWebContents: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), handle: vi.fn(), removeHandler: vi.fn() },
}));

vi.mock('node-pty', () => ({ spawn: vi.fn() }));

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('$shared/logger', () => ({
  Logger: vi.fn(function () {
    return loggerMock;
  }),
}));

vi.mock('../../../workspace/main/workspace.service', () => ({
  workspaceService: {
    getWorkspace: vi.fn(async () => ({ ok: true, data: { title: 'Named Workspace' } })),
  },
}));

vi.mock('../instruction-service', () => ({
  InstructionService: {
    getInstance: () => ({
      buildSystemPrompt: vi.fn(async () => 'test system prompt'),
    }),
  },
}));

vi.mock('../../../workspace/main/workspace-settings.service', () => ({
  isAutoCommitEnabled: vi.fn(() => true),
}));

const mockPersistence = { loadAgent: vi.fn(), saveAgent: vi.fn() };
vi.mock('../agent-persistence', () => ({
  agentPersistence: mockPersistence,
  UnifiedPersistence: { getInstance: () => mockPersistence },
}));
vi.mock('../daemon-agent-bridge', () => ({
  daemonAgentBridge: mockPersistence,
}));

vi.mock('../../../system/main/system.ipc', () => ({
  getWindowIdForWorkspace: vi.fn(() => undefined),
  getWindowIdsForWorkspace: vi.fn(() => []),
}));

vi.mock('$shared/main/memory-event-logger', () => ({
  memEvents: {
    agentTurnStart: vi.fn(),
    agentTurnComplete: vi.fn(),
    cleanupStart: vi.fn(),
    cleanupComplete: vi.fn(),
    custom: vi.fn(),
  },
}));

vi.mock('$lib/services/analytics/main', () => ({ trackMain: vi.fn() }));

vi.mock('../../../events/main/agent-subscription-ops', () => ({
  updateAgentStatus: vi.fn(),
}));

let AgentBackendHandlerClass: typeof import('../agent-backend-handler.service').AgentBackendHandler;

function createHandler(backendSession: any, provider: any): any {
  const handler = Object.create(AgentBackendHandlerClass.prototype) as any;
  handler.providers = new Map([[backendSession.id, provider]]);
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
  handler.interruptedAgents = new Set();
  handler.interruptedAgentTimeouts = new Map();
  handler.pendingStopAgents = new Set();
  handler.pendingStopAgentTimeouts = new Map();
  handler.activeSessions = new Map();
  handler.emptyResponseRetries = new Map();
  handler.messageQueues = new Map();
  handler.processingQueue = new Set();
  handler.pendingQueueProcessing = new Set();
  handler.queueAgentWorkspaceIds = new Map();
  handler.pendingBackendDeliveries = new Set();
  handler.pendingBackendDeliveryTimeouts = new Map();
  handler.pendingHandlerReady = new Map();
  handler.inFlightSessionPrompts = new Set();
  handler.inFlightSessionPromptKeysByAgent = new Map();
  handler.inFlightSessionPromptStreamIds = new Map();
  handler.sendToRenderer = vi.fn(() => true);
  handler.sendStreamToRenderer = vi.fn(() => true);
  handler.startStreamHealthCheck = vi.fn();
  handler.emitAgentStartedEvent = vi.fn();
  handler.emitAgentIdleEvent = vi.fn();
  handler.emitAgentFailedEvent = vi.fn();
  handler.emitAgentCreatedEvent = vi.fn();
  handler.finalizeStream = vi.fn();
  handler.invalidatePersistenceListCache = vi.fn();
  const backend = {
    createAgent: vi.fn(async () => ({ success: true, agent: backendSession })),
    emit: vi.fn(),
    getSession: vi.fn(() => backendSession),
    resumeSession: vi.fn(async () => ({ success: true })),
  };
  handler.getBackend = vi.fn(async () => backend);
  handler.unifiedBackend = backend;
  return handler;
}

describe('AgentBackendHandler initial prompt deduplication', () => {
  beforeAll(async () => {
    ({ AgentBackendHandler: AgentBackendHandlerClass } = await vi.importActual(
      '../agent-backend-handler.service',
    ));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockPersistence.saveAgent.mockResolvedValue({ success: true });
  });

  it('drops duplicate in-flight initial prompts for the same backend session', async () => {
    const agentId = 'agent-initial';
    const workspaceId = 'ws-1';
    const backendSession = {
      id: agentId,
      workspaceId,
      name: 'Agent',
      model: 'default',
      backendSessionId: 'backend-session-1',
      metadata: {},
      messages: [
        {
          id: 'msg-user-1',
          role: 'user',
          contentBlocks: [{ type: 'text', text: 'Hello' }],
          timestamp: '2026-04-30T00:00:00.000Z',
        },
      ],
    };
    let releasePrompt!: () => void;
    const stopReasons: string[] = [];
    const provider = {
      isHealthy: vi.fn(() => true),
      getConfig: vi.fn(() => ({ model: 'default' })),
      streamMessage: vi.fn(async (_messages: any[], options: any) => {
        await new Promise<void>((resolve) => {
          releasePrompt = resolve;
        });
        const stopReason = 'end_turn';
        stopReasons.push(stopReason);
        await options.onComplete({
          contentBlocks: [{ type: 'text', text: 'Done' }],
          metadata: { stopReason },
        });
      }),
    };
    const handler = createHandler(backendSession, provider);
    const request = {
      agentId,
      sessionId: agentId,
      streamId: 'stream-1',
      content: 'Hello',
      workspaceId,
      agentName: 'Agent',
      messages: [...backendSession.messages],
    };

    const first = handler.handleSendMessage(null, request);
    await vi.waitFor(() => expect(provider.streamMessage).toHaveBeenCalledTimes(1));

    const duplicate = await handler.handleSendMessage(null, {
      ...request,
      streamId: 'stream-duplicate',
    });
    expect(duplicate).toEqual({
      success: false,
      error: 'Agent already has an in-flight prompt. Message was not delivered.',
    });
    expect(provider.streamMessage).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'agent.session-prompt.duplicate.dropped',
      expect.objectContaining({
        backendSessionId: 'backend-session-1',
        inflightStreamId: 'stream-1',
        droppedStreamId: 'stream-duplicate',
      }),
    );

    releasePrompt();
    await expect(first).resolves.toEqual({ success: true });
    expect(provider.streamMessage).toHaveBeenCalledTimes(1);
    expect(stopReasons).toEqual(['end_turn']);
  });

  it('sends one initial prompt for backend-only createAgent callers by default', async () => {
    const agentId = 'agent-backend-only';
    const workspaceId = 'ws-backend-only';
    const backendSession = {
      id: agentId,
      workspaceId,
      name: 'Backend Agent',
      model: 'default',
      provider: 'auggie',
      backendSessionId: 'backend-session-backend-only',
      metadata: {},
      messages: [
        {
          id: 'msg-user-backend-only',
          role: 'user',
          contentBlocks: [{ type: 'text', text: 'Start backend work' }],
          timestamp: '2026-04-30T00:00:00.000Z',
        },
      ],
    };
    const provider = {
      isHealthy: vi.fn(() => true),
      getConfig: vi.fn(() => ({ model: 'default' })),
      streamMessage: vi.fn(async () => {}),
    };
    const handler = createHandler(backendSession, provider);

    const agent = await handler.createAgent(workspaceId, 'Backend Agent', {
      workspacePath: '/tmp/workspace',
      initialMessage: 'Start backend work',
    });

    expect(agent).toBe(backendSession);
    await vi.waitFor(() => expect(provider.streamMessage).toHaveBeenCalledTimes(1));
  });

  it('does not send an initial prompt when skipInitialPrompt is true', async () => {
    const agentId = 'agent-frontend';
    const workspaceId = 'ws-frontend';
    const backendSession = {
      id: agentId,
      workspaceId,
      name: 'Frontend Agent',
      model: 'default',
      provider: 'auggie',
      backendSessionId: 'backend-session-frontend',
      metadata: {},
      messages: [
        {
          id: 'msg-user-frontend',
          role: 'user',
          contentBlocks: [{ type: 'text', text: 'Start frontend work' }],
          timestamp: '2026-04-30T00:00:00.000Z',
        },
      ],
    };
    const provider = {
      isHealthy: vi.fn(() => true),
      getConfig: vi.fn(() => ({ model: 'default' })),
      streamMessage: vi.fn(async () => {}),
    };
    const handler = createHandler(backendSession, provider);

    const result = await handler.handleCreateAgent(null, {
      workspaceId,
      workspacePath: '/tmp/workspace',
      name: 'Frontend Agent',
      initialMessage: 'Start frontend work',
      skipInitialPrompt: true,
    });

    expect(result).toEqual({ success: true, agent: backendSession });
    expect(provider.streamMessage).not.toHaveBeenCalled();
  });
});
