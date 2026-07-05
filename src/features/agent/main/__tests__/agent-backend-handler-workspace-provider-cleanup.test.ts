import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getOrphanedProviderCleanupPlan } from '../orphaned-provider-cleanup';

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

vi.mock('../daemon-agent-bridge', () => ({
  daemonAgentBridge: {},
}));

// Mock the Redux store bridge so hasActiveAgentsInWorkspace can check subscriptions
vi.mock('../../../../store/main/redux-store-bridge', () => ({
  getMainState: vi.fn(() => ({
    agentSubscriptions: {
      byWorkspaceId: {},
    },
  })),
}));

// Mock the agent subscriptions selector
vi.mock('../../../../store/main/slices/agent-subscriptions/agent-subscriptions-selectors', () => ({
  selectAgentSubscriptions: {
    select: vi.fn(() => []),
  },
}));

let AgentBackendHandlerClass: typeof import('../agent-backend-handler.service').AgentBackendHandler;

describe('AgentBackendHandler getWorkspaceIdsWithProviders', () => {
  beforeAll(async () => {
    ({ AgentBackendHandler: AgentBackendHandlerClass } = await vi.importActual(
      '../agent-backend-handler.service',
    ));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createHandler() {
    const handler = Object.create(AgentBackendHandlerClass.prototype) as any;
    handler.streamWorkspaceIds = new Map<string, string>();
    handler.providers = new Map<string, unknown>();
    return handler;
  }

  it('returns workspace IDs tracked by active streams', () => {
    const handler = createHandler();
    handler.streamWorkspaceIds.set('agent-1', 'ws-stream-1');
    handler.streamWorkspaceIds.set('agent-2', 'ws-stream-2');

    expect([...handler.getWorkspaceIdsWithProviders()].sort()).toEqual([
      'ws-stream-1',
      'ws-stream-2',
    ]);
  });

  it('includes providers that exist before any stream is tracked', () => {
    const handler = createHandler();
    handler.providers.set('agent-fallback', {
      config: { workspaceId: 'ws-provider-only' },
    });

    expect([...handler.getWorkspaceIdsWithProviders()]).toEqual(['ws-provider-only']);
  });

  it('deduplicates workspace IDs and skips invalid provider config values', () => {
    const handler = createHandler();
    handler.streamWorkspaceIds.set('agent-stream', 'ws-shared');
    handler.providers.set('agent-duplicate', {
      config: { workspaceId: 'ws-shared' },
    });
    handler.providers.set('agent-empty', {
      config: { workspaceId: '' },
    });
    handler.providers.set('agent-non-string', {
      config: { workspaceId: 123 },
    });
    handler.providers.set('agent-missing', {});

    expect([...handler.getWorkspaceIdsWithProviders()]).toEqual(['ws-shared']);
  });
});

describe('AgentBackendHandler hasActiveAgentsInWorkspace', () => {
  beforeAll(async () => {
    ({ AgentBackendHandler: AgentBackendHandlerClass } = await vi.importActual(
      '../agent-backend-handler.service',
    ));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createHandler() {
    const handler = Object.create(AgentBackendHandlerClass.prototype) as any;
    handler.streamWorkspaceIds = new Map<string, string>();
    handler.providers = new Map<string, unknown>();
    handler.streamStartTimes = new Map<string, number>();
    return handler;
  }

  it('returns false when workspace has no agents', () => {
    const handler = createHandler();
    expect(handler.hasActiveAgentsInWorkspace('ws-empty')).toBe(false);
  });

  it('returns false when agents have no active streams or pending requests', () => {
    const handler = createHandler();
    handler.streamWorkspaceIds.set('agent-1', 'ws-1');
    handler.providers.set('agent-1', {
      config: { workspaceId: 'ws-1' },
      streamingCallbacks: new Map(),
      pendingRequests: new Map(),
    });

    expect(handler.hasActiveAgentsInWorkspace('ws-1')).toBe(false);
  });

  it('returns true when agent has active streaming callbacks', () => {
    const handler = createHandler();
    handler.streamWorkspaceIds.set('agent-1', 'ws-1');
    const streamingCallbacks = new Map();
    streamingCallbacks.set('session-1', { onChunk: () => {} });
    handler.providers.set('agent-1', {
      config: { workspaceId: 'ws-1' },
      streamingCallbacks,
      pendingRequests: new Map(),
    });

    expect(handler.hasActiveAgentsInWorkspace('ws-1')).toBe(true);
  });

  it('returns true when agent has pending requests', () => {
    const handler = createHandler();
    handler.streamWorkspaceIds.set('agent-1', 'ws-1');
    const pendingRequests = new Map();
    pendingRequests.set(1, { resolve: () => {}, reject: () => {} });
    handler.providers.set('agent-1', {
      config: { workspaceId: 'ws-1' },
      streamingCallbacks: new Map(),
      pendingRequests,
    });

    expect(handler.hasActiveAgentsInWorkspace('ws-1')).toBe(true);
  });

  it('returns true if any agent in workspace is active', () => {
    const handler = createHandler();
    // Idle agent
    handler.streamWorkspaceIds.set('agent-idle', 'ws-1');
    handler.providers.set('agent-idle', {
      config: { workspaceId: 'ws-1' },
      streamingCallbacks: new Map(),
      pendingRequests: new Map(),
    });
    // Active agent
    const streamingCallbacks = new Map();
    streamingCallbacks.set('session-1', { onChunk: () => {} });
    handler.streamWorkspaceIds.set('agent-active', 'ws-1');
    handler.providers.set('agent-active', {
      config: { workspaceId: 'ws-1' },
      streamingCallbacks,
      pendingRequests: new Map(),
    });

    expect(handler.hasActiveAgentsInWorkspace('ws-1')).toBe(true);
  });

  it('finds agents via provider config.workspaceId fallback', () => {
    const handler = createHandler();
    // Agent not in streamWorkspaceIds but has provider with config.workspaceId
    const streamingCallbacks = new Map();
    streamingCallbacks.set('session-1', { onChunk: () => {} });
    handler.providers.set('agent-fallback', {
      config: { workspaceId: 'ws-fallback' },
      streamingCallbacks,
      pendingRequests: new Map(),
    });

    expect(handler.hasActiveAgentsInWorkspace('ws-fallback')).toBe(true);
  });

  it('ignores agents without provider when checking activity', () => {
    const handler = createHandler();
    // Agent in streamWorkspaceIds but no provider entry
    handler.streamWorkspaceIds.set('agent-no-provider', 'ws-1');

    expect(handler.hasActiveAgentsInWorkspace('ws-1')).toBe(false);
  });

  it('returns true when agent has active subscriptions', async () => {
    // Mock selectAgentSubscriptions to return subscriptions for the specific agent
    const { getMainState } = await import('../../../../store/main/redux-store-bridge');
    const { selectAgentSubscriptions } =
      await import('../../../../store/main/slices/agent-subscriptions/agent-subscriptions-selectors');

    vi.mocked(getMainState).mockReturnValue({
      agentSubscriptions: {
        byWorkspaceId: {
          'ws-subscribed': {
            'agent-coordinator': [{ subscriptionId: 'sub-1', eventType: 'agent:complete' }],
          },
        },
      },
    });
    vi.mocked(selectAgentSubscriptions.select).mockReturnValue([
      { subscriptionId: 'sub-1', eventType: 'agent:complete' },
    ]);

    const handler = createHandler();
    handler.streamWorkspaceIds.set('agent-coordinator', 'ws-subscribed');
    handler.providers.set('agent-coordinator', {
      config: { workspaceId: 'ws-subscribed' },
      streamingCallbacks: new Map(), // No active streams
      pendingRequests: new Map(), // No pending requests
    });

    expect(handler.hasActiveAgentsInWorkspace('ws-subscribed')).toBe(true);

    // Verify the selector was called with correct arguments
    expect(selectAgentSubscriptions.select).toHaveBeenCalledWith(
      expect.any(Object),
      'ws-subscribed',
      'agent-coordinator',
    );
  });
});

describe('AgentBackendHandler orphaned workspace cleanup integration', () => {
  beforeAll(async () => {
    ({ AgentBackendHandler: AgentBackendHandlerClass } = await vi.importActual(
      '../agent-backend-handler.service',
    ));
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset the subscription selector mock to return empty array (no active subscriptions)
    const { selectAgentSubscriptions } =
      await import('../../../../store/main/slices/agent-subscriptions/agent-subscriptions-selectors');
    vi.mocked(selectAgentSubscriptions.select).mockReturnValue([]);
  });

  function createHandler() {
    const handler = Object.create(AgentBackendHandlerClass.prototype) as any;
    handler.streamWorkspaceIds = new Map<string, string>();
    handler.providers = new Map<string, unknown>();
    handler.streamStartTimes = new Map<string, number>();
    return handler;
  }

  /**
   * Simulates the orphaned workspace cleanup logic from main/index.ts.
   * This is the exact same logic that runs during memory pressure.
   */
  function simulateOrphanedWorkspaceCleanup(
    handler: any,
    openWorkspaceIds: Set<string>,
    onStopProviders: (wsId: string) => void,
  ): { orphanedWorkspaceIds: string[]; safeToCleanup: string[]; skipped: string[] } {
    const { orphanedWorkspaceIds, safeToCleanup, skippedWithActiveAgents } =
      getOrphanedProviderCleanupPlan(handler, openWorkspaceIds);

    for (const wsId of safeToCleanup) {
      onStopProviders(wsId);
    }

    return { orphanedWorkspaceIds, safeToCleanup, skipped: skippedWithActiveAgents };
  }

  it('stops providers for orphaned workspace when all agents are idle', () => {
    const handler = createHandler();
    // Set up an orphaned workspace with idle agents (no open window)
    handler.streamWorkspaceIds.set('agent-1', 'ws-orphaned');
    handler.providers.set('agent-1', {
      config: { workspaceId: 'ws-orphaned' },
      streamingCallbacks: new Map(), // No active streams
      pendingRequests: new Map(), // No pending requests
    });

    const stoppedWorkspaces: string[] = [];
    const openWorkspaceIds = new Set<string>(); // ws-orphaned has no open window

    const result = simulateOrphanedWorkspaceCleanup(handler, openWorkspaceIds, (wsId) =>
      stoppedWorkspaces.push(wsId),
    );

    expect(result.orphanedWorkspaceIds).toEqual(['ws-orphaned']);
    expect(result.safeToCleanup).toEqual(['ws-orphaned']);
    expect(result.skipped).toEqual([]);
    expect(stoppedWorkspaces).toEqual(['ws-orphaned']);
  });

  it('does NOT include virtual workspaces in safeToCleanup when no window is open', () => {
    const handler = createHandler();
    handler.streamWorkspaceIds.set('agent-chief', '__chief__');
    handler.providers.set('agent-chief', {
      config: { workspaceId: '__chief__' },
      streamingCallbacks: new Map(),
      pendingRequests: new Map(),
    });

    const stoppedWorkspaces: string[] = [];
    const openWorkspaceIds = new Set<string>();

    const result = simulateOrphanedWorkspaceCleanup(handler, openWorkspaceIds, (wsId) =>
      stoppedWorkspaces.push(wsId),
    );

    expect(result.safeToCleanup).not.toContain('__chief__');
    expect(stoppedWorkspaces).not.toContain('__chief__');
  });

  it('does NOT stop providers for orphaned workspace with active streaming agent', () => {
    const handler = createHandler();
    // Set up an orphaned workspace with an active streaming agent
    const streamingCallbacks = new Map();
    streamingCallbacks.set('session-1', { onChunk: () => {} });
    handler.streamWorkspaceIds.set('agent-active', 'ws-orphaned-active');
    handler.providers.set('agent-active', {
      config: { workspaceId: 'ws-orphaned-active' },
      streamingCallbacks,
      pendingRequests: new Map(),
    });

    const stoppedWorkspaces: string[] = [];
    const openWorkspaceIds = new Set<string>(); // ws-orphaned-active has no open window

    const result = simulateOrphanedWorkspaceCleanup(handler, openWorkspaceIds, (wsId) =>
      stoppedWorkspaces.push(wsId),
    );

    expect(result.orphanedWorkspaceIds).toEqual(['ws-orphaned-active']);
    expect(result.safeToCleanup).toEqual([]);
    expect(result.skipped).toEqual(['ws-orphaned-active']);
    expect(stoppedWorkspaces).toEqual([]); // Nothing stopped!
  });

  it('cleans up only idle orphaned workspaces when mixed with active ones', () => {
    const handler = createHandler();

    // Orphaned workspace 1: idle agent (should be cleaned up)
    handler.streamWorkspaceIds.set('agent-idle', 'ws-orphaned-idle');
    handler.providers.set('agent-idle', {
      config: { workspaceId: 'ws-orphaned-idle' },
      streamingCallbacks: new Map(),
      pendingRequests: new Map(),
    });

    // Orphaned workspace 2: active agent (should NOT be cleaned up)
    const streamingCallbacks = new Map();
    streamingCallbacks.set('session-1', { onChunk: () => {} });
    handler.streamWorkspaceIds.set('agent-active', 'ws-orphaned-active');
    handler.providers.set('agent-active', {
      config: { workspaceId: 'ws-orphaned-active' },
      streamingCallbacks,
      pendingRequests: new Map(),
    });

    // Workspace 3: has open window (not orphaned)
    handler.streamWorkspaceIds.set('agent-open', 'ws-open');
    handler.providers.set('agent-open', {
      config: { workspaceId: 'ws-open' },
      streamingCallbacks: new Map(),
      pendingRequests: new Map(),
    });

    const stoppedWorkspaces: string[] = [];
    const openWorkspaceIds = new Set(['ws-open']); // Only ws-open has a window

    const result = simulateOrphanedWorkspaceCleanup(handler, openWorkspaceIds, (wsId) =>
      stoppedWorkspaces.push(wsId),
    );

    // Only ws-orphaned-idle and ws-orphaned-active are orphaned (no open window)
    expect(result.orphanedWorkspaceIds.sort()).toEqual(
      ['ws-orphaned-active', 'ws-orphaned-idle'].sort(),
    );
    // Only ws-orphaned-idle is safe to cleanup (no active agents)
    expect(result.safeToCleanup).toEqual(['ws-orphaned-idle']);
    // ws-orphaned-active is skipped because it has active streaming
    expect(result.skipped).toEqual(['ws-orphaned-active']);
    // Only idle workspace was stopped
    expect(stoppedWorkspaces).toEqual(['ws-orphaned-idle']);
  });

  it('does NOT stop providers for orphaned workspace with pending JSON-RPC requests', () => {
    const handler = createHandler();
    // Set up an orphaned workspace with pending requests
    const pendingRequests = new Map();
    pendingRequests.set(1, { resolve: () => {}, reject: () => {} });
    handler.streamWorkspaceIds.set('agent-pending', 'ws-orphaned-pending');
    handler.providers.set('agent-pending', {
      config: { workspaceId: 'ws-orphaned-pending' },
      streamingCallbacks: new Map(),
      pendingRequests,
    });

    const stoppedWorkspaces: string[] = [];
    const openWorkspaceIds = new Set<string>();

    const result = simulateOrphanedWorkspaceCleanup(handler, openWorkspaceIds, (wsId) =>
      stoppedWorkspaces.push(wsId),
    );

    expect(result.orphanedWorkspaceIds).toEqual(['ws-orphaned-pending']);
    expect(result.safeToCleanup).toEqual([]);
    expect(result.skipped).toEqual(['ws-orphaned-pending']);
    expect(stoppedWorkspaces).toEqual([]);
  });

  it('skips workspace with one idle and one active agent', () => {
    const handler = createHandler();
    // Two agents in same workspace: one idle, one active
    handler.streamWorkspaceIds.set('agent-idle', 'ws-mixed');
    handler.providers.set('agent-idle', {
      config: { workspaceId: 'ws-mixed' },
      streamingCallbacks: new Map(),
      pendingRequests: new Map(),
    });

    const streamingCallbacks = new Map();
    streamingCallbacks.set('session-1', { onChunk: () => {} });
    handler.streamWorkspaceIds.set('agent-active', 'ws-mixed');
    handler.providers.set('agent-active', {
      config: { workspaceId: 'ws-mixed' },
      streamingCallbacks,
      pendingRequests: new Map(),
    });

    const stoppedWorkspaces: string[] = [];
    const openWorkspaceIds = new Set<string>();

    const result = simulateOrphanedWorkspaceCleanup(handler, openWorkspaceIds, (wsId) =>
      stoppedWorkspaces.push(wsId),
    );

    expect(result.orphanedWorkspaceIds).toEqual(['ws-mixed']);
    expect(result.safeToCleanup).toEqual([]);
    expect(result.skipped).toEqual(['ws-mixed']);
    expect(stoppedWorkspaces).toEqual([]); // Workspace protected by active agent
  });
});
