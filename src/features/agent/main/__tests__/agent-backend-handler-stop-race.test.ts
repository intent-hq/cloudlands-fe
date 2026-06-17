import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { BrowserWindow } from 'electron';

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
  handler.streamLastActivityTimes = new Map();
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

// Zombie-session fix: a stream timeout must cancel the underlying provider
// session, otherwise the agent process keeps executing its in-flight prompt
// (running tools, editing files) after the agent has been marked failed.
describe('AgentBackendHandler stream-timeout provider cancellation', () => {
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

  afterEach(() => {
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
    vi.useRealTimers();
  });

  it('cancelProviderSessionAfterTimeout interrupts the provider and guards against late-completion side effects', async () => {
    const handler = makeHandler();
    const agentId = 'agent-zombie';
    const mockProvider = { interrupt: vi.fn(async () => undefined) };
    handler.providers.set(agentId, mockProvider);
    handler.inFlightSessionPrompts = new Set(['backend-session-1']);
    handler.inFlightSessionPromptKeysByAgent = new Map([[agentId, 'backend-session-1']]);
    handler.inFlightSessionPromptStreamIds = new Map([['backend-session-1', 'stream-1']]);

    handler.cancelProviderSessionAfterTimeout(agentId, 'stream-1');
    await Promise.resolve();

    // The provider session is actually cancelled
    expect(mockProvider.interrupt).toHaveBeenCalledTimes(1);
    // Late onComplete from the interrupt is dropped by the idempotency guard
    expect(handler.completedStreams.get(agentId)?.has('stream-1')).toBe(true);
    // agent:idle suppression + queue-race protection (mirrors stopAgent)
    expect(handler.interruptedAgents.has(agentId)).toBe(true);
    expect(handler.startInterruptedAgentSafetyTimeout).toHaveBeenCalledWith(agentId);
    // In-flight prompt guard is released so the agent stays reachable
    expect(handler.inFlightSessionPrompts.has('backend-session-1')).toBe(false);
    expect(handler.inFlightSessionPromptKeysByAgent.has(agentId)).toBe(false);
  });

  it('cancelProviderSessionAfterTimeout does not throw when no provider exists and still releases guards', () => {
    const handler = makeHandler();
    const agentId = 'agent-no-provider-timeout';
    handler.inFlightSessionPrompts = new Set(['backend-session-2']);
    handler.inFlightSessionPromptKeysByAgent = new Map([[agentId, 'backend-session-2']]);
    handler.inFlightSessionPromptStreamIds = new Map([['backend-session-2', 'stream-2']]);

    expect(() => handler.cancelProviderSessionAfterTimeout(agentId, 'stream-2')).not.toThrow();

    expect(handler.interruptedAgents.has(agentId)).toBe(true);
    expect(handler.inFlightSessionPrompts.has('backend-session-2')).toBe(false);
  });

  it('cancelProviderSessionAfterTimeout swallows interrupt() rejection', async () => {
    const handler = makeHandler();
    const agentId = 'agent-interrupt-fails';
    const mockProvider = {
      interrupt: vi.fn(async () => {
        throw new Error('cancel failed');
      }),
    };
    handler.providers.set(agentId, mockProvider);

    expect(() => handler.cancelProviderSessionAfterTimeout(agentId, 'stream-3')).not.toThrow();
    // Flush the rejected interrupt promise — must not surface as unhandled
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockProvider.interrupt).toHaveBeenCalledTimes(1);
    expect(handler.interruptedAgents.has(agentId)).toBe(true);
  });

  it('stream timeout in the health check interrupts the provider session', async () => {
    vi.useFakeTimers();
    const fakeWindow = {
      isDestroyed: () => false,
      webContents: { send: vi.fn() },
    };
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([fakeWindow] as any);

    const handler = makeHandler();
    const agentId = 'agent-timeout';
    const mockProvider = { interrupt: vi.fn(async () => undefined) };
    handler.providers.set(agentId, mockProvider);

    // Stream started 31 minutes ago — past the 30-minute maxStreamDuration cap
    handler.streamStartTimes.set(agentId, Date.now() - 31 * 60 * 1000);
    handler.streamWorkspaceIds.set(agentId, 'ws-1');

    handler.startStreamHealthCheck(agentId, 'stream-timeout-1');
    // Provider has also been silent past stalledStreamDetection (2 min) — both
    // old AND stalled, so the activity-aware timeout must fire
    handler.streamLastActivityTimes.set(agentId, Date.now() - 31 * 60 * 1000);

    // First health-check tick (5s) detects the timeout
    await vi.advanceTimersByTimeAsync(5000);

    expect(mockProvider.interrupt).toHaveBeenCalledTimes(1);
    // The active stream's ID is pre-marked completed so the interrupt-triggered
    // late onComplete is dropped by the idempotency guard
    expect(handler.completedStreams.get(agentId)?.has('stream-timeout-1')).toBe(true);
    expect(handler.interruptedAgents.has(agentId)).toBe(true);
    // Stream bookkeeping was finalized (health check cleared — no repeat interrupts)
    expect(handler.streamHealthChecks.has(agentId)).toBe(false);
    expect(handler.streamStartTimes.has(agentId)).toBe(false);

    // Subsequent ticks must not interrupt again
    await vi.advanceTimersByTimeAsync(10000);
    expect(mockProvider.interrupt).toHaveBeenCalledTimes(1);
  });

  it('stream past maxStreamDuration with recent provider activity is NOT timed out', async () => {
    vi.useFakeTimers();
    const fakeWindow = {
      isDestroyed: () => false,
      webContents: { send: vi.fn() },
    };
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([fakeWindow] as any);

    const handler = makeHandler();
    const agentId = 'agent-active-long-turn';
    const mockProvider = { interrupt: vi.fn(async () => undefined) };
    handler.providers.set(agentId, mockProvider);

    // Stream started 31 minutes ago — past the cap — but the provider is active
    handler.streamStartTimes.set(agentId, Date.now() - 31 * 60 * 1000);
    handler.streamWorkspaceIds.set(agentId, 'ws-1');

    handler.startStreamHealthCheck(agentId, 'stream-active-1');
    // startStreamHealthCheck initializes activity to "now"; simulate ongoing
    // provider output by touching activity on every tick
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(5000);
      handler.touchStreamActivity(agentId);
    }

    // Healthy long turn: no interrupt, no teardown
    expect(mockProvider.interrupt).not.toHaveBeenCalled();
    expect(handler.streamHealthChecks.has(agentId)).toBe(true);
    expect(handler.streamStartTimes.has(agentId)).toBe(true);
    expect(handler.interruptedAgents.has(agentId)).toBe(false);

    // Provider goes silent: after stalledStreamDetection (2 min) the timeout fires
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000);

    expect(mockProvider.interrupt).toHaveBeenCalledTimes(1);
    expect(handler.interruptedAgents.has(agentId)).toBe(true);
    expect(handler.streamHealthChecks.has(agentId)).toBe(false);
  });
});
