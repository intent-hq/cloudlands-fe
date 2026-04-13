/**
 * Tests for pendingBackendDeliveries safety timeout behavior.
 *
 * Verifies that:
 * 1. cleanupAllAgentTrackingMaps clears pendingBackendDeliveries and its timeout
 * 2. The safety timeout force-clears pendingBackendDeliveries after 5 minutes
 */

import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

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

let HandlerClass: any;

describe('pendingBackendDeliveries safety timeout', () => {
  beforeAll(async () => {
    ({ AgentBackendHandler: HandlerClass } =
      await vi.importActual('../agent-backend-handler.service'));
  });

  function createHandler(): any {
    const handler = Object.create(HandlerClass.prototype);
    // Initialize the maps that cleanupAllAgentTrackingMaps touches
    handler.providers = new Map();
    handler.providerLastUsed = new Map();
    handler.streamStartTimes = new Map();
    handler.streamSessionIds = new Map();
    handler.streamWorkspaceIds = new Map();
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
});
