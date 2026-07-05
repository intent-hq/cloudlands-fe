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

const handlerState = vi.hoisted(() => ({ current: undefined as any }));

vi.mock('../agent-backend-handler.service', () => ({
  AgentBackendHandler: {
    getInstance: vi.fn(() => handlerState.current),
  },
}));

vi.mock('$shared/logger', () => ({
  Logger: vi.fn(function () {
    return {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
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

vi.mock('$shared/main/config.js', () => ({
  WorkspaceConfig: {
    paths: {
      workspace: vi.fn((workspaceId: string) => `/tmp/${workspaceId}`),
    },
  },
}));

let AgentBackendHandlerClass: typeof import('../agent-backend-handler.service').AgentBackendHandler;

async function getAdapterWithHandler(handler: any) {
  handlerState.current = handler;
  vi.resetModules();
  const { getAgentBackendAdapter } = await import('../agent-backend-adapter');
  return getAgentBackendAdapter();
}

function createHandler(backendSession: any): any {
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

describe('AgentBackendAdapter createAgent forwarding', () => {
  beforeAll(async () => {
    ({ AgentBackendHandler: AgentBackendHandlerClass } = await vi.importActual(
      '../agent-backend-handler.service',
    ));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockPersistence.saveAgent.mockResolvedValue({ success: true });
  });

  it('preserves skipInitialPrompt through the real handler so frontend sessions do not auto-send', async () => {
    const backendSession = {
      id: 'agent-adapter-skip',
      workspaceId: 'ws-adapter-skip',
      name: 'Adapter Skip Agent',
      backendSessionId: 'backend-session-adapter-skip',
      messages: [],
    };
    const handler = createHandler(backendSession);
    const sendMessageSpy = vi.spyOn(handler, 'handleSendMessage');
    const adapter = await getAdapterWithHandler(handler);

    const result = await adapter.createAgent({
      workspaceId: 'ws-adapter-skip' as any,
      workspacePath: '/tmp/workspace',
      name: 'Adapter Skip Agent',
      initialMessage: 'Start adapter work',
      skipInitialPrompt: true,
    });

    expect(result).toEqual({ agent: backendSession, sessionId: backendSession.backendSessionId });
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it('forwards image blocks and workspace context fields from the IPC contract', async () => {
    const backendSession = {
      id: 'agent-adapter-images',
      workspaceId: 'ws-adapter-images',
      name: 'Adapter Image Agent',
      backendSessionId: 'backend-session-adapter-images',
      messages: [],
    };
    const mockHandler = {
      handleCreateAgent: vi.fn().mockResolvedValue({ success: true, agent: backendSession }),
    };
    const adapter = await getAdapterWithHandler(mockHandler);
    const imageBlocks = [{ type: 'image' as const, data: 'base64-image', mimeType: 'image/png' }];
    const workspaceContext = {
      openPanels: [{ type: 'file', title: 'adapter.ts', path: 'src/adapter.ts' }],
      linkedReferences: [{ type: 'note', title: 'Spec', identifier: 'spec' }],
    };

    await adapter.createAgent({
      workspaceId: 'ws-adapter-images' as any,
      workspacePath: '/tmp/workspace',
      name: 'Adapter Image Agent',
      initialMessage: 'Describe this image',
      imageBlocks,
      workspaceContext,
    });

    expect(mockHandler.handleCreateAgent).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        imageBlocks,
        workspaceContext,
      }),
    );
    const forwardedRequest = mockHandler.handleCreateAgent.mock.calls[0][1];
    expect(forwardedRequest).not.toHaveProperty('specialistName');
    expect(forwardedRequest).not.toHaveProperty('roleReminder');
  });

  it('returns benign duplicate in-flight prompt results from streamMessage', async () => {
    const duplicateResult = {
      success: false,
      error: 'Agent already has an in-flight prompt. Message was not delivered.',
    };
    const mockHandler = {
      handleBackendStreamMessage: vi.fn().mockResolvedValue(duplicateResult),
    };
    const adapter = await getAdapterWithHandler(mockHandler);

    await expect(adapter.streamMessage({ agentId: 'agent-duplicate' })).resolves.toBe(
      duplicateResult,
    );
  });

  it('still throws genuine streamMessage failures', async () => {
    const mockHandler = {
      handleBackendStreamMessage: vi.fn().mockResolvedValue({
        success: false,
        error: 'Provider stream failed',
      }),
    };
    const adapter = await getAdapterWithHandler(mockHandler);

    await expect(adapter.streamMessage({ agentId: 'agent-failed' })).rejects.toThrow(
      'Provider stream failed',
    );
  });
});
