import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';

const state = vi.hoisted(() => {
  const listeners = new Map<string, (data: any) => void>();
  return {
    session: null as any,
    listeners,
    windowMock: {
      electronAPI: {
        on: vi.fn((channel: string, handler: (data: any) => void) => {
          listeners.set(channel, handler);
          return `${channel}-listener-id`;
        }),
        offById: vi.fn(),
        send: vi.fn(),
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    },
  };
});

vi.mock('../browser', () => ({
  agentIpcProxy: {},
  configCache: {},
  errorBoundary: { captureError: vi.fn() },
  persistenceService: { saveSession: vi.fn() },
  sessionStore: {
    getStore: vi.fn(() => writable({ sessions: [] })),
    getAllSessionsForWorkspace: vi.fn(() => []),
    getAllSessionsAcrossWorkspaces: vi.fn(() => []),
    getSessionForWorkspace: vi.fn((_workspaceId: string, agentId: string) => {
      if (!state.session || state.session.id !== agentId) return undefined;
      return { ...state.session, messages: [...state.session.messages] };
    }),
    addMessageForWorkspace: vi.fn((_workspaceId: string, _agentId: string, message: any) => state.session?.messages.push(message)),
    addSessionForWorkspace: vi.fn((_workspaceId: string, session: any) => {
      state.session = { ...session, messages: [...(session.messages || [])] };
    }),
    updateMessagesForWorkspace: vi.fn((_workspaceId: string, _agentId: string, messages: any[]) => {
      if (state.session) state.session.messages = [...messages];
    }),
    setStreamingForWorkspace: vi.fn(),
    removeSessionForWorkspace: vi.fn(),
  },
}));

vi.mock('$lib/electron-bridge', () => ({ invoke: vi.fn() }));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('$features/agent/services/unified-state-store', () => ({ unifiedStateStore: { currentWorkspace: { workspace: { id: 'ws-1' } }, getAgentsForWorkspace: vi.fn(() => []) } }));
vi.mock('$features/agent/services/performance-optimizer', () => ({ performanceOptimizer: {} }));
vi.mock('$features/agent/services/agent-factory', () => ({ agentFactory: {} }));
vi.mock('../browser/services/error-recovery.service', () => ({ errorRecovery: {}, DEFAULT_STRATEGIES: {} }));
vi.mock('../browser/services/request-deduplicator.service', () => ({ requestDeduplicator: { clearKeysForAgent: vi.fn() }, generateMessageKey: vi.fn() }));
vi.mock('../services/unread-tracking.service', () => ({ unreadTrackingService: { setAgentExistsCallback: vi.fn() } }));
vi.mock('$lib/services/analytics', () => ({ track: vi.fn() }));
vi.mock('$features/agent/services/error-handler', () => ({ errorHandler: {}, AgentError: class {}, ErrorCode: {}, ErrorCategory: {}, ErrorSeverity: {} }));
vi.mock('../observability/event-collector-client', () => ({ eventCollector: {}, AgentEventType: {} }));
vi.mock('../workspace/workspace-metrics', () => ({ workspaceMetrics: {} }));
vi.mock('../agent-file-tracker', () => ({ agentFileTracker: {} }));

describe('queued message persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    state.listeners.clear();
    state.session = { id: 'agent-1', workspaceId: 'ws-1', isStreaming: false, messages: [] };
    delete (state.windowMock as any).__agentService_hmr;
    vi.stubGlobal('window', state.windowMock as any);
  });

  it('persists the queued user message via the real queue-processing listener', async () => {
    const { agentService } = await import('../agent.service');
    const saveSession = vi.fn().mockResolvedValue(undefined);
    (agentService as any).saveSession = saveSession;
    (agentService as any).registerStreamHandlerForSession = vi.fn();

    const handler = state.listeners.get('agent:queue:processing');
    expect(handler).toBeDefined();

    handler?.({ agentId: 'agent-1', messageId: 'msg-1', content: 'hello', contextItems: [] });

    expect(state.session.messages).toHaveLength(1);
    expect(state.session.isStreaming).toBe(true);
    expect(saveSession).toHaveBeenCalledWith('agent-1', 'ws-1', true);
    expect(state.windowMock.dispatchEvent).toHaveBeenCalledWith(expect.any(CustomEvent));
  });

  it('persists cancellation cleanup via the real queue-cancelled listener', async () => {
    state.session.messages = [{ id: 'msg-1', role: 'user', contentBlocks: [] }];
    const { agentService } = await import('../agent.service');
    const saveSession = vi.fn().mockResolvedValue(undefined);
    (agentService as any).saveSession = saveSession;

    const handler = state.listeners.get('agent:queue:processing-cancelled');
    expect(handler).toBeDefined();

    handler?.({ agentId: 'agent-1', messageId: 'msg-1' });

    expect(state.session.messages).toHaveLength(0);
    expect(saveSession).toHaveBeenCalledWith('agent-1', 'ws-1', true);
    expect(state.windowMock.dispatchEvent).toHaveBeenCalledWith(expect.any(CustomEvent));
  });
});
