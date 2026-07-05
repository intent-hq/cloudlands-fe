/**
 * Tests for pendingBackendDeliveries safety timeout behavior.
 *
 * Verifies that:
 * 1. cleanupAllAgentTrackingMaps clears pendingBackendDeliveries and its timeout
 * 2. The safety timeout force-clears pendingBackendDeliveries after 5 minutes
 */

import {
  beforeAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from 'vitest';

const { getWindowIdsForWorkspaceMock } = vi.hoisted(() => ({
  getWindowIdsForWorkspaceMock: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/test'),
    getName: vi.fn().mockReturnValue('Intent'),
    getVersion: vi.fn().mockReturnValue('1.0.0'),
    on: vi.fn(),
    once: vi.fn(),
    isReady: vi.fn(() => true),
    whenReady: vi.fn(() => Promise.resolve()),
    isPackaged: false,
  },
  ipcMain: { on: vi.fn(), handle: vi.fn(), removeHandler: vi.fn() },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    fromWebContents: vi.fn(() => null),
  },
}));

vi.mock('../../../workspace/main/workspace.service', () => ({
  workspaceService: {},
}));

vi.mock('../agent-persistence', () => ({
  agentPersistence: {},
}));

vi.mock('../daemon-agent-bridge', () => ({
  daemonAgentBridge: {},
}));

vi.mock('../../../system/main/system.ipc', () => ({
  getWindowIdForWorkspace: vi.fn(),
  getWindowIdsForWorkspace: getWindowIdsForWorkspaceMock,
}));

let HandlerClass: any;

describe('pendingBackendDeliveries safety timeout', () => {
  beforeAll(async () => {
    ({ AgentBackendHandler: HandlerClass } =
      await vi.importActual('../agent-backend-handler.service'));
  });

  beforeEach(() => {
    getWindowIdsForWorkspaceMock.mockReset();
    getWindowIdsForWorkspaceMock.mockReturnValue([]);
  });

  function createHandler(): any {
    const handler = Object.create(HandlerClass.prototype);
    // Initialize the maps that cleanupAllAgentTrackingMaps touches
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
    handler.lastPongTimes = new Map();
    handler.lastPingSentTimes = new Map();
    handler.messageQueues = new Map();
    handler.processingQueue = new Set();
    handler.pendingQueueProcessing = new Set();
    handler.pendingBackendDeliveries = new Set();
    handler.pendingBackendDeliveryTimeouts = new Map();
    handler.activeSessions = new Map();
    handler.interruptedAgents = new Set();
    handler.interruptedAgentTimeouts = new Map();
    handler.completedStreams = new Map();
    handler.pendingHandlerReady = new Map();
    handler.emptyResponseRetries = new Map();
    handler.queueAgentWorkspaceIds = new Map();
    handler.queueWatchdogInterval = null;
    handler.inactivePersistenceListCacheWorkspaces = new Set();
    handler.openWorkspaceIdsForAgentHydration = null;
    handler.sendToRenderer = vi.fn();
    handler.emitQueueWorkspaceEvent = vi.fn();
    handler.getWorkspaceWindowsForAgent = vi.fn(() => []);
    return handler;
  }

  it('cleanupAllAgentTrackingMaps clears pendingBackendDeliveries and its timeout', () => {
    const handler = createHandler();
    const agentId = 'test-agent-cleanup';

    handler.pendingBackendDeliveries.add(agentId);
    const timeout = setTimeout(() => {}, 999999);
    handler.pendingBackendDeliveryTimeouts.set(agentId, timeout);

    handler.cleanupAllAgentTrackingMaps(agentId);

    expect(handler.pendingBackendDeliveries.has(agentId)).toBe(false);
    expect(handler.pendingBackendDeliveryTimeouts.has(agentId)).toBe(false);

    clearTimeout(timeout);
  });

  it('safety timeout force-clears pendingBackendDeliveries after 5 minutes', () => {
    vi.useFakeTimers();
    const handler = createHandler();
    const agentId = 'test-agent-timeout';
    const TIMEOUT_MS = 5 * 60 * 1000;

    // Simulate what sendBackendInitiatedMessage does
    handler.pendingBackendDeliveries.add(agentId);
    const deliveryTimeout = setTimeout(() => {
      if (handler.pendingBackendDeliveries.has(agentId)) {
        handler.pendingBackendDeliveries.delete(agentId);
        handler.pendingBackendDeliveryTimeouts.delete(agentId);
      }
    }, TIMEOUT_MS);
    handler.pendingBackendDeliveryTimeouts.set(agentId, deliveryTimeout);

    expect(handler.pendingBackendDeliveries.has(agentId)).toBe(true);

    // Before timeout: still pending
    vi.advanceTimersByTime(TIMEOUT_MS - 1000);
    expect(handler.pendingBackendDeliveries.has(agentId)).toBe(true);

    // After timeout: force-cleared
    vi.advanceTimersByTime(2000);
    expect(handler.pendingBackendDeliveries.has(agentId)).toBe(false);
    expect(handler.pendingBackendDeliveryTimeouts.has(agentId)).toBe(false);

    vi.useRealTimers();
  });

  it('cleanup clears pending backend delivery and pending stop timers', () => {
    vi.useFakeTimers();
    const handler = createHandler();
    const deliveryAgentId = 'test-agent-delivery';
    const stopAgentId = 'test-agent-stop';
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    handler.cleanupAllListeners = vi.fn();
    handler.httpBridgeUnrecoverableDisposer = null;
    handler.pendingStopAgents = new Set();
    handler.pendingStopAgentTimeouts = new Map();
    handler.unifiedBackend = null;
    handler.providerCleanupInterval = null;

    const deliveryTimeout = setTimeout(() => {}, 999999);
    const stopTimeout = setTimeout(() => {}, 999999);
    handler.pendingBackendDeliveries.add(deliveryAgentId);
    handler.pendingBackendDeliveryTimeouts.set(deliveryAgentId, deliveryTimeout);
    handler.pendingStopAgents.add(stopAgentId);
    handler.pendingStopAgentTimeouts.set(stopAgentId, stopTimeout);

    handler.cleanup();

    expect(handler.pendingBackendDeliveries.size).toBe(0);
    expect(handler.pendingBackendDeliveryTimeouts.size).toBe(0);
    expect(handler.pendingStopAgents.size).toBe(0);
    expect(handler.pendingStopAgentTimeouts.size).toBe(0);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(deliveryTimeout);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(stopTimeout);

    clearTimeoutSpy.mockRestore();
    vi.useRealTimers();
  });

  it('stores queued workspaceId from request and watchdog recovers backend-idle queues', async () => {
    vi.useFakeTimers();
    const handler = createHandler();
    const agentId = 'test-agent-queued-workspace';
    const workspaceId = 'ws-queued';
    const processNextQueuedMessage = vi.fn().mockResolvedValue(undefined);
    handler.processNextQueuedMessage = processNextQueuedMessage;

    const result = await handler.handleQueueMessage(null, {
      agentId,
      content: 'Follow-up',
      workspaceId,
    });

    expect(result.success).toBe(true);
    expect(handler.queueAgentWorkspaceIds.get(agentId)).toBe(workspaceId);
    expect(getWindowIdsForWorkspaceMock).toHaveBeenCalledWith(workspaceId);
    expect(handler.sendToRenderer).toHaveBeenCalledWith(
      'agent:queue:updated',
      { agentId, queue: expect.any(Array) },
      [],
      workspaceId,
    );

    await vi.advanceTimersByTimeAsync(30_000);

    expect(processNextQueuedMessage).toHaveBeenCalledWith(agentId, workspaceId);

    if (handler.queueWatchdogInterval) {
      clearInterval(handler.queueWatchdogInterval);
      handler.queueWatchdogInterval = null;
    }
    vi.useRealTimers();
  });

  it('falls back to active stream workspaceId when queue request omits workspaceId', async () => {
    const handler = createHandler();
    handler.startQueueWatchdog = vi.fn();
    const agentId = 'test-agent-stream-workspace';

    handler.streamWorkspaceIds.set(agentId, 'ws-stream');

    const result = await handler.handleQueueMessage(null, {
      agentId,
      content: 'Follow-up',
    });

    expect(result.success).toBe(true);
    expect(handler.queueAgentWorkspaceIds.get(agentId)).toBe('ws-stream');
  });

  it('notifies queued workspace windows when no active stream mapping exists', async () => {
    const handler = createHandler();
    handler.startQueueWatchdog = vi.fn();
    handler.getWorkspaceWindowsForAgent = vi.fn(() => [999]);
    getWindowIdsForWorkspaceMock.mockReturnValue([101, 102]);
    const agentId = 'test-agent-stale-renderer-busy';
    const workspaceId = 'ws-stale-renderer';

    const result = await handler.handleQueueMessage(null, {
      agentId,
      content: 'Follow-up from stale renderer busy state',
      workspaceId,
    });

    expect(result.success).toBe(true);
    expect(handler.streamWorkspaceIds.has(agentId)).toBe(false);
    expect(getWindowIdsForWorkspaceMock).toHaveBeenCalledWith(workspaceId);
    expect(handler.getWorkspaceWindowsForAgent).not.toHaveBeenCalled();
    expect(handler.sendToRenderer).toHaveBeenCalledWith(
      'agent:queue:updated',
      { agentId, queue: expect.any(Array) },
      [101, 102],
      workspaceId,
    );
  });

  it('deletes empty per-agent queue state when the last queued message is removed', async () => {
    vi.useFakeTimers();
    const handler = createHandler();
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const agentId = 'test-agent-remove-drain';
    const workspaceId = 'ws-remove-drain';
    const queuedMessage = {
      id: 'msg_remove_drain',
      appMessageId: 'app_remove_drain',
      content: 'remove me',
      queuedAt: new Date().toISOString(),
      position: 0,
    };
    handler.streamWorkspaceIds.set(agentId, workspaceId);
    handler.queueAgentWorkspaceIds.set(agentId, workspaceId);
    handler.messageQueues.set(agentId, [queuedMessage]);
    handler.queueWatchdogInterval = setInterval(() => {}, 30_000);

    const result = await handler.handleRemoveQueuedMessage(null, {
      agentId,
      messageId: queuedMessage.id,
    });

    expect(result.success).toBe(true);
    expect(handler.messageQueues.has(agentId)).toBe(false);
    expect(handler.queueAgentWorkspaceIds.has(agentId)).toBe(false);
    expect(handler.queueWatchdogInterval).toBeNull();
    expect(clearIntervalSpy).toHaveBeenCalled();

    clearIntervalSpy.mockRestore();
    vi.useRealTimers();
  });

  it('deletes empty per-agent queue state after a queued message sends successfully', async () => {
    const handler = createHandler();
    const agentId = 'test-agent-process-drain';
    const workspaceId = 'ws-process-drain';
    const queuedMessage = {
      id: 'msg_process_drain',
      appMessageId: 'app_process_drain',
      content: 'send me',
      queuedAt: new Date().toISOString(),
      position: 0,
    };
    handler.queueAgentWorkspaceIds.set(agentId, workspaceId);
    handler.messageQueues.set(agentId, [queuedMessage]);
    handler.handleBackendStreamMessage = vi.fn().mockResolvedValue({ success: true });

    await handler.processNextQueuedMessage(agentId, workspaceId);

    expect(handler.handleBackendStreamMessage).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        agentId,
        content: queuedMessage.content,
        queuedMessageId: queuedMessage.id,
      }),
    );
    expect(handler.messageQueues.has(agentId)).toBe(false);
    expect(handler.queueAgentWorkspaceIds.has(agentId)).toBe(false);
    expect(handler.processingQueue.has(agentId)).toBe(false);
  });

  it('rejects queued messages when the per-agent queue is full', async () => {
    const handler = createHandler();
    handler.startQueueWatchdog = vi.fn();
    const agentId = 'test-agent-full-queue';
    const maxQueuedMessages = (HandlerClass as any).MAX_QUEUED_MESSAGES_PER_AGENT;
    handler.messageQueues.set(
      agentId,
      Array.from({ length: maxQueuedMessages }, (_, index) => ({
        id: `msg_full_${index}`,
        appMessageId: `app_full_${index}`,
        content: 'queued',
        queuedAt: new Date().toISOString(),
        position: index,
      })),
    );

    const result = await handler.handleQueueMessage(null, {
      agentId,
      content: 'one too many',
      workspaceId: 'ws-full-queue',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Agent queue is full');
    expect(handler.messageQueues.get(agentId)).toHaveLength(maxQueuedMessages);
    expect(handler.startQueueWatchdog).not.toHaveBeenCalled();
  });

  it('rejects oversized queued message payloads before retaining them', async () => {
    const handler = createHandler();
    handler.startQueueWatchdog = vi.fn();
    const agentId = 'test-agent-oversized-queue';
    const originalMaxBytes = (HandlerClass as any).MAX_QUEUED_MESSAGE_BYTES;
    (HandlerClass as any).MAX_QUEUED_MESSAGE_BYTES = 16;

    try {
      const result = await handler.handleQueueMessage(null, {
        agentId,
        content: 'small',
        workspaceId: 'ws-oversized-queue',
        imageBlocks: [{ type: 'image', data: 'x'.repeat(32), mimeType: 'image/png' }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Queued message payload is too large');
      expect(handler.messageQueues.has(agentId)).toBe(false);
      expect(handler.queueAgentWorkspaceIds.has(agentId)).toBe(false);
      expect(handler.startQueueWatchdog).not.toHaveBeenCalled();
    } finally {
      (HandlerClass as any).MAX_QUEUED_MESSAGE_BYTES = originalMaxBytes;
    }
  });
});
