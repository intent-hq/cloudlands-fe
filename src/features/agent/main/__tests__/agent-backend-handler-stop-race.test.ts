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
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    fromWebContents: vi.fn(() => null),
  },
  ipcMain: { on: vi.fn(), handle: vi.fn(), removeHandler: vi.fn() },
}));

const mockPersistence = {
  loadAgent: vi.fn(),
  saveAgent: vi.fn(),
};
vi.mock('../agent-persistence', () => ({
  agentPersistence: mockPersistence,
  UnifiedPersistence: { getInstance: () => mockPersistence },
}));
vi.mock('../../../workspace/main/workspace.service', () => ({
  workspaceService: {},
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
  handler.pendingStopAgents = new Set();
  handler.pendingStopAgentTimeouts = new Map();
  handler.activeSessions = new Map();
  handler.emptyResponseRetries = new Map();
  handler.messageQueues = new Map();
  handler.processingQueue = new Map();
  handler.pendingQueueProcessing = new Set();
  handler.queueAgentWorkspaceIds = new Map();
  handler.pendingBackendDeliveries = new Map();
  handler.pendingBackendDeliveryTimeouts = new Map();
  handler.pendingHandlerReady = new Map();
  handler.sendStreamToRenderer = vi.fn();
  handler.sendToRenderer = vi.fn();
  handler.startInterruptedAgentSafetyTimeout = vi.fn();
  handler.cancelInterruptedAgentSafetyTimeout = vi.fn();
  handler.stopQueueWatchdogIfEmpty = vi.fn();
  handler.getBackend = vi.fn(async () => ({
    backendStop: vi.fn(async () => ({ success: true })),
  }));
  return handler;
}

describe('AgentBackendHandler stop-click race during provider creation', () => {
  beforeAll(async () => {
    ({ AgentBackendHandler: AgentBackendHandlerClass } = await vi.importActual(
      '../agent-backend-handler.service',
    ));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockPersistence.loadAgent.mockResolvedValue({ success: false });
    mockPersistence.saveAgent.mockResolvedValue({ success: true });
  });

  it('handleStopSession marks agent as pending-stop when no provider is registered', async () => {
    const handler = makeHandler();
    const agentId = 'agent-no-provider';

    const res = await handler.handleStopSession(null, { agentId });

    expect(res).toEqual({ success: true });
    expect(handler.pendingStopAgents.has(agentId)).toBe(true);
    expect(handler.pendingStopAgentTimeouts.has(agentId)).toBe(true);
  });

  it('handleStopSession does NOT add pending-stop flag when provider exists and is interrupted', async () => {
    const handler = makeHandler();
    const agentId = 'agent-has-provider';
    const mockProvider = { interrupt: vi.fn(async () => undefined) };
    handler.providers.set(agentId, mockProvider);

    await handler.handleStopSession(null, { agentId });

    expect(mockProvider.interrupt).toHaveBeenCalledTimes(1);
    expect(handler.pendingStopAgents.has(agentId)).toBe(false);
  });

  it('consumePendingStopAfterProviderCreation tears down provider and clears flag', async () => {
    const handler = makeHandler();
    const agentId = 'agent-consume';
    const mockProvider = {
      stop: vi.fn(async () => undefined),
      cleanup: vi.fn(async () => undefined),
    };
    handler.providers.set(agentId, mockProvider);
    handler.providerLastUsed.set(agentId, Date.now());
    handler.pendingStopAgents.add(agentId);
    handler.startPendingStopSafetyTimeout(agentId);
    expect(handler.pendingStopAgentTimeouts.has(agentId)).toBe(true);

    const cleanupSpy = vi
      .spyOn(handler, 'cleanupStreamResources')
      .mockImplementation(() => undefined);

    const consumed = await handler.consumePendingStopAfterProviderCreation(
      agentId,
      mockProvider,
    );

    expect(consumed).toBe(true);
    expect(mockProvider.stop).toHaveBeenCalledWith({ forceCleanup: true });
    expect(mockProvider.cleanup).not.toHaveBeenCalled();
    expect(handler.providers.has(agentId)).toBe(false);
    expect(handler.providerLastUsed.has(agentId)).toBe(false);
    expect(handler.pendingStopAgents.has(agentId)).toBe(false);
    expect(handler.pendingStopAgentTimeouts.has(agentId)).toBe(false);
    expect(cleanupSpy).toHaveBeenCalledWith(agentId);
  });

  it('consumePendingStopAfterProviderCreation returns false when no pending stop', async () => {
    const handler = makeHandler();
    const mockProvider = { stop: vi.fn(), streamMessage: vi.fn() };

    const consumed = await handler.consumePendingStopAfterProviderCreation(
      'agent-no-pending',
      mockProvider,
    );

    expect(consumed).toBe(false);
    expect(mockProvider.stop).not.toHaveBeenCalled();
  });

  // End-to-end race: Stop click arrives while provider creation is in-flight,
  // handleSendMessage later sees the flag and aborts before dispatching a prompt.
  it('race: handleStopSession → consume cancels the in-flight send', async () => {
    const handler = makeHandler();
    const agentId = 'agent-race';
    const mockProvider = {
      stop: vi.fn(async () => undefined),
      streamMessage: vi.fn(async () => undefined),
    };
    vi.spyOn(handler, 'cleanupStreamResources').mockImplementation(() => undefined);

    // 1. Stop click arrives BEFORE any provider exists (mid registry.create).
    await handler.handleStopSession(null, { agentId });
    expect(handler.pendingStopAgents.has(agentId)).toBe(true);

    // 2. registry.create() finally resolves and handleSendMessage stores the provider.
    handler.providers.set(agentId, mockProvider);
    handler.providerLastUsed.set(agentId, Date.now());

    // 3. handleSendMessage invokes the consume helper immediately after.
    const consumed = await handler.consumePendingStopAfterProviderCreation(
      agentId,
      mockProvider,
    );

    expect(consumed).toBe(true);
    expect(mockProvider.stop).toHaveBeenCalledWith({ forceCleanup: true });
    expect(mockProvider.streamMessage).not.toHaveBeenCalled();
    expect(handler.providers.has(agentId)).toBe(false);
    expect(handler.pendingStopAgents.has(agentId)).toBe(false);
  });
});
