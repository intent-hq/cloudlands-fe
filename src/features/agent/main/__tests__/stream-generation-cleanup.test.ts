/**
 * Regression tests for stream generation-aware cleanup.
 *
 * Verifies that when a new stream starts for an agent (e.g., after interruption),
 * the old stream's deferred cleanup does NOT erase the new stream's tracking state.
 * This prevents the race condition where:
 *   1. Agent is interrupted → old stream's onError fires cleanup
 *   2. New stream starts → sets streamWorkspaceIds, streamStartTimes, etc.
 *   3. Old cleanup runs (deferred) → would delete the new stream's entries
 *
 * The fix: each stream captures a generation token; cleanup skips if generation is stale.
 */

import {
  beforeAll,
  describe,
  it,
  expect,
  vi,
} from 'vitest';

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

let HandlerClass: any;

describe('stream generation-aware cleanup', () => {
  beforeAll(async () => {
    ({ AgentBackendHandler: HandlerClass } =
      await vi.importActual('../agent-backend-handler.service'));
  });

  function createHandler(): any {
    const handler = Object.create(HandlerClass.prototype);
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
    handler.completedStreams = new Map();
    handler.pendingHandlerReady = new Map();
    handler.emptyResponseRetries = new Map();
    return handler;
  }

  it('cleanupStreamResources proceeds when generation matches current', () => {
    const handler = createHandler();
    const agentId = 'agent-gen-match';

    // Simulate stream gen 1 setup
    handler.streamGenerations.set(agentId, 1);
    handler.streamStartTimes.set(agentId, Date.now());
    handler.streamWorkspaceIds.set(agentId, 'ws-1');
    handler.streamSessionIds.set(agentId, 'session-1');
    handler.streamWindowIds.set(agentId, 42);

    // Cleanup with matching generation → should proceed
    handler.cleanupStreamResources(agentId, 1);

    expect(handler.streamStartTimes.has(agentId)).toBe(false);
    expect(handler.streamWorkspaceIds.has(agentId)).toBe(false);
    expect(handler.streamSessionIds.has(agentId)).toBe(false);
    expect(handler.streamWindowIds.has(agentId)).toBe(false);
  });

  it('cleanupStreamResources skips when generation is stale (old stream cleanup after new stream started)', () => {
    const handler = createHandler();
    const agentId = 'agent-gen-stale';

    // Simulate: new stream (gen 2) has already started
    handler.streamGenerations.set(agentId, 2);
    handler.streamStartTimes.set(agentId, Date.now());
    handler.streamWorkspaceIds.set(agentId, 'ws-new');
    handler.streamSessionIds.set(agentId, 'session-new');
    handler.streamWindowIds.set(agentId, 99);

    // Old stream (gen 1) cleanup runs late → should be skipped
    handler.cleanupStreamResources(agentId, 1);

    // New stream's tracking must be preserved
    expect(handler.streamStartTimes.has(agentId)).toBe(true);
    expect(handler.streamWorkspaceIds.get(agentId)).toBe('ws-new');
    expect(handler.streamSessionIds.get(agentId)).toBe('session-new');
    expect(handler.streamWindowIds.get(agentId)).toBe(99);
  });

  it('cleanupStreamResources proceeds when no generation is passed (unconditional cleanup)', () => {
    const handler = createHandler();
    const agentId = 'agent-no-gen';

    handler.streamGenerations.set(agentId, 5);
    handler.streamStartTimes.set(agentId, Date.now());
    handler.streamWorkspaceIds.set(agentId, 'ws-x');

    // No generation → unconditional cleanup (e.g., stopAgent, stale entry housekeeping)
    handler.cleanupStreamResources(agentId);

    expect(handler.streamStartTimes.has(agentId)).toBe(false);
    expect(handler.streamWorkspaceIds.has(agentId)).toBe(false);
  });

  it('finalizeStream skips cleanup when generation is stale but still advances queue', () => {
    vi.useFakeTimers();
    const handler = createHandler();
    const agentId = 'agent-finalize-stale';

    // New stream (gen 3) is active
    handler.streamGenerations.set(agentId, 3);
    handler.streamStartTimes.set(agentId, Date.now());
    handler.streamWorkspaceIds.set(agentId, 'ws-active');

    // Old stream (gen 2) finalizes → cleanup should skip, but queue should still advance
    handler.finalizeStream(agentId, 'ws-old', 'complete', 2);

    // New stream's tracking must be preserved (cleanup was skipped)
    expect(handler.streamStartTimes.has(agentId)).toBe(true);
    expect(handler.streamWorkspaceIds.get(agentId)).toBe('ws-active');

    vi.useRealTimers();
  });

  it('simulates full interrupt → re-send race scenario', () => {
    vi.useFakeTimers();
    const handler = createHandler();
    const agentId = 'agent-race';

    // Step 1: First stream starts (gen 1)
    handler.streamGenerations.set(agentId, 1);
    handler.streamStartTimes.set(agentId, 1000);
    handler.streamWorkspaceIds.set(agentId, 'ws-a');
    handler.streamSessionIds.set(agentId, 'sess-1');

    // Step 2: Agent is interrupted, new stream starts immediately (gen 2)
    handler.streamGenerations.set(agentId, 2);
    handler.streamStartTimes.set(agentId, 2000);
    handler.streamWorkspaceIds.set(agentId, 'ws-a');
    handler.streamSessionIds.set(agentId, 'sess-2');

    // Step 3: Old stream's onError cleanup fires (stale gen 1) → must NOT erase gen 2's data
    handler.cleanupStreamResources(agentId, 1);

    expect(handler.streamStartTimes.get(agentId)).toBe(2000);
    expect(handler.streamWorkspaceIds.get(agentId)).toBe('ws-a');
    expect(handler.streamSessionIds.get(agentId)).toBe('sess-2');

    // Step 4: New stream completes normally (gen 2) → cleanup should proceed
    handler.cleanupStreamResources(agentId, 2);

    expect(handler.streamStartTimes.has(agentId)).toBe(false);
    expect(handler.streamWorkspaceIds.has(agentId)).toBe(false);
    expect(handler.streamSessionIds.has(agentId)).toBe(false);

    vi.useRealTimers();
  });
});
