/**
 * Cross-file integration for the httpBridgeUnrecoverable hook.
 *
 * Verifies the producer (src/main/http-mcp-bridge.ts) and consumer
 * (AgentBackendHandler) agree on a single mechanism. Fully instantiating
 * both HttpMcpBridge and AgentBackendHandler in one test is too heavy for
 * the existing test infra (both have sizeable dependency graphs), so per
 * the task note's explicit fallback we split the wiring check:
 *
 *   1. The consumer's subscribe path calls the real exported
 *      `onHttpBridgeUnrecoverable` function (verified via vi.mock).
 *   2. Invoking the captured handler with a producer-shaped
 *      `HttpBridgeUnrecoverableInfo` payload triggers
 *      `handleHttpBridgeUnrecoverable` side effects
 *      (agentPersistence.saveAgent + stream-error IPC send).
 *
 * Combined with the existing test in
 * `src/main/__tests__/http-mcp-bridge.test.ts`
 * (`ensureHealthy() emits httpBridgeUnrecoverable when restart fails`) that
 * asserts the producer actually invokes every subscriber registered via
 * `onHttpBridgeUnrecoverable`, this covers producer → consumer end to end.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPersistence = {
  loadAgent: vi.fn(),
  saveAgent: vi.fn(),
};

const { mockOnHttpBridgeUnrecoverable } = vi.hoisted(() => {
  const registered: Array<(info: unknown) => void> = [];
  const fn = vi.fn((handler: (info: unknown) => void) => {
    registered.push(handler);
    return () => {
      const idx = registered.indexOf(handler);
      if (idx >= 0) registered.splice(idx, 1);
    };
  });
  return {
    mockOnHttpBridgeUnrecoverable: Object.assign(fn, {
      __registered: registered,
    }),
  };
});

vi.mock('../../../../main/http-mcp-bridge', () => ({
  onHttpBridgeUnrecoverable: mockOnHttpBridgeUnrecoverable,
}));

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

describe('AgentBackendHandler httpBridgeUnrecoverable integration', () => {
  beforeAll(async () => {
    ({ AgentBackendHandler: AgentBackendHandlerClass } = await vi.importActual(
      '../agent-backend-handler.service',
    ));
  });

  beforeEach(() => {
    mockOnHttpBridgeUnrecoverable.mockClear();
    mockOnHttpBridgeUnrecoverable.__registered.length = 0;
    mockPersistence.loadAgent.mockReset();
    mockPersistence.saveAgent.mockReset();
    mockPersistence.saveAgent.mockResolvedValue({ success: true });
  });

  it('subscribes via onHttpBridgeUnrecoverable and the registered handler fires side effects on emit', async () => {
    const handler = Object.create(AgentBackendHandlerClass.prototype) as any;
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
    handler.terminatingAgents = new Set<string>();
    handler.providers = new Map();
    handler.providerLastUsed = new Map();
    handler.sendStreamToRenderer = vi.fn();

    // Run the real subscribe path used by the constructor.
    AgentBackendHandlerClass.prototype[
      'subscribeToHttpBridgeUnrecoverable' as keyof AgentBackendHandler
    ].call(handler);

    // Check 1: consumer wired through the exported producer API.
    expect(mockOnHttpBridgeUnrecoverable).toHaveBeenCalledTimes(1);
    const registered = mockOnHttpBridgeUnrecoverable.mock.calls[0][0];
    expect(typeof registered).toBe('function');

    // Seed one streaming agent so handleHttpBridgeUnrecoverable has work.
    handler.streamStartTimes.set('agent-x', Date.now());
    handler.streamWorkspaceIds.set('agent-x', 'ws-x');
    handler.streamSessionIds.set('agent-x', 'sess-x');
    mockPersistence.loadAgent.mockResolvedValue({
      success: true,
      data: {
        id: 'agent-x',
        workspaceId: 'ws-x',
        messages: [],
        isStreaming: true,
        status: 'active',
      },
    });

    // Check 2: invoking with a producer-shaped payload fires side effects.
    registered({
      reason: 'still-unhealthy-after-restart',
      port: 5179,
      timestamp: Date.now(),
    });
    // handleHttpBridgeUnrecoverable is async; wait one microtask tick.
    await new Promise((r) => setImmediate(r));
    expect(mockPersistence.saveAgent).toHaveBeenCalledTimes(1);
    expect(handler.sendStreamToRenderer).toHaveBeenCalledWith(
      'agent-x',
      'agent:stream:agent-x',
      expect.objectContaining({ type: 'error' }),
    );
  });

  it('manages terminatingAgents across handleHttpBridgeUnrecoverable: populated during repair, cleared after', async () => {
    const handler = Object.create(AgentBackendHandlerClass.prototype) as any;
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
    handler.terminatingAgents = new Set<string>();
    handler.providers = new Map();
    handler.providerLastUsed = new Map();
    handler.sendStreamToRenderer = vi.fn();

    // Seed streaming state so the handler iterates this agent.
    handler.streamStartTimes.set('agent-x', Date.now());
    handler.streamWorkspaceIds.set('agent-x', 'ws-x');
    handler.streamSessionIds.set('agent-x', 'sess-x');

    // Observe terminatingAgents while the repair is mid-flight — loadAgent
    // is awaited before repairOrphanedStreamingState, so the set must already
    // contain the agentId by this point.
    let wasTerminatingDuringLoad = false;
    mockPersistence.loadAgent.mockImplementation(async () => {
      wasTerminatingDuringLoad = handler.terminatingAgents.has('agent-x');
      return {
        success: true,
        data: {
          id: 'agent-x',
          workspaceId: 'ws-x',
          messages: [],
          isStreaming: true,
          status: 'active',
        },
      };
    });

    // Drive the same entry point as the producer would.
    AgentBackendHandlerClass.prototype[
      'subscribeToHttpBridgeUnrecoverable' as keyof AgentBackendHandler
    ].call(handler);
    const registered = mockOnHttpBridgeUnrecoverable.mock.calls[0][0];
    registered({ reason: 'still-unhealthy-after-restart', port: 5179, timestamp: Date.now() });
    await new Promise((r) => setImmediate(r));

    // Set was populated before loadAgent (i.e. before the repair save).
    expect(wasTerminatingDuringLoad).toBe(true);
    // Finally block cleared it so a later restart of this agent can persist.
    expect(handler.terminatingAgents.has('agent-x')).toBe(false);
  });
});

type AgentBackendHandler = import('../agent-backend-handler.service').AgentBackendHandler;
