// @vitest-environment node

/**
 * Regression tests for the upstream memory fixes ported in #715:
 * - resumeSession / loadPersistedSessions must call normalizeStreamingState so
 *   sessions persisted mid-turn before a hard exit (memory eviction, crash)
 *   cannot re-hydrate phantom isStreaming/isProcessing/isResponding flags.
 * - setupEventForwarding must skip windows whose webContents is destroyed so
 *   the health:check tick does not throw once a window has been closed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentStatus } from '$shared/types';

const {
  mockRequest,
  selectAgentSubscriptionsSelectMock,
  streamManagerMock,
  metadataFsMock,
  browserWindowMock,
  ipcMainMock,
} = vi.hoisted(() => {
  const streamManager = {
    isActive: vi.fn(() => false),
    cancelStream: vi.fn(),
    cleanupSession: vi.fn(),
    destroy: vi.fn(),
    dispose: vi.fn(),
  };
  const metadataFs = {
    access: vi.fn(async () => undefined),
    readdir: vi.fn(async () => [] as Array<{ isFile: () => boolean; name: string }>),
    readFile: vi.fn(async () => ''),
  };
  return {
    mockRequest: vi.fn(async () => ({ success: true })),
    selectAgentSubscriptionsSelectMock: vi.fn(() => []),
    streamManagerMock: streamManager,
    metadataFsMock: metadataFs,
    browserWindowMock: { getAllWindows: vi.fn(() => [] as unknown[]), fromId: vi.fn() },
    ipcMainMock: { handle: vi.fn() },
  };
});

vi.mock('uuid', () => ({ v4: () => 'test-uuid' }));
vi.mock('$shared/services/unified-id.service', () => ({
  unifiedIdService: { generateAgentId: () => 'agent-1', generateSessionId: () => 'session-1' },
}));
vi.mock('$shared/logger', () => {
  const noop = () => {};
  class MockLogger {
    info = noop;
    warn = noop;
    error = noop;
    debug = noop;
  }
  return { Logger: MockLogger };
});
vi.mock('../stream-manager', () => ({
  StreamManager: { getInstance: () => streamManagerMock },
}));
vi.mock('../agent-validator', () => ({
  agentValidator: { validateConfig: vi.fn(() => ({ valid: true })) },
}));
vi.mock('../../services/error-handler', () => ({
  errorHandler: { handleError: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
vi.mock('$shared/ipc/channels', () => ({ AGENT_BACKEND_CHANNELS: {}, PERSISTENCE_CHANNELS: {} }));
vi.mock('../utils/memory-manager', () => ({
  memoryManager: { registerTimer: vi.fn(), cleanup: vi.fn(), unregister: vi.fn() },
}));
vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mockRequest }),
}));
vi.mock('../../metadata-fs/main/metadata-fs-factory', () => ({ getMetadataFS: vi.fn() }));
vi.mock('../../../metadata-fs/main/local-metadata-fs', () => ({
  LocalMetadataFS: class {
    access = metadataFsMock.access;
    readdir = metadataFsMock.readdir;
    readFile = metadataFsMock.readFile;
  },
}));
vi.mock('$shared/main/config', () => ({
  WorkspaceConfig: {
    paths: { agents: (workspaceId: string) => `/tmp/${workspaceId}/agents` },
  },
}));
vi.mock('electron', () => ({ ipcMain: ipcMainMock, BrowserWindow: browserWindowMock }));
vi.mock('../../../system/main/system.ipc', () => ({ getWindowIdsForWorkspace: () => [] }));
vi.mock('$store/main/redux-store-bridge', () => ({ getMainState: vi.fn(() => ({})) }));
vi.mock('$store/main/slices/agent-subscriptions/agent-subscriptions-selectors', () => ({
  selectAgentSubscriptions: { select: selectAgentSubscriptionsSelectMock },
}));

describe('ConsolidatedBackendService phantom streaming-state recovery', () => {
  beforeEach(() => {
    process.env.INTENT_DISABLE_BACKEND_SIGNAL_HANDLERS = '1';
    mockRequest.mockReset();
    mockRequest.mockResolvedValue({ success: true });
    selectAgentSubscriptionsSelectMock.mockReset();
    selectAgentSubscriptionsSelectMock.mockReturnValue([]);
    streamManagerMock.isActive.mockReset();
    streamManagerMock.isActive.mockReturnValue(false);
    metadataFsMock.access.mockReset();
    metadataFsMock.access.mockResolvedValue(undefined);
    metadataFsMock.readdir.mockReset();
    metadataFsMock.readdir.mockResolvedValue([]);
    metadataFsMock.readFile.mockReset();
    browserWindowMock.getAllWindows.mockReset();
    browserWindowMock.getAllWindows.mockReturnValue([]);
    ipcMainMock.handle.mockReset();
  });

  afterEach(async () => {
    const { ConsolidatedBackendService } = await import('../consolidated-backend.service');
    (ConsolidatedBackendService as any).instance?.dispose?.();
    (ConsolidatedBackendService as any).instance = undefined;
    delete process.env.INTENT_DISABLE_BACKEND_SIGNAL_HANDLERS;
    vi.resetModules();
  });

  function makeSession(overrides: Record<string, unknown> = {}) {
    return {
      id: 'agent-stuck',
      backendSessionId: 'backend-session',
      workspaceId: 'amber-forest',
      name: 'Stuck Agent',
      model: 'sonnet4.5',
      provider: 'augment',
      systemPrompt: '',
      status: AgentStatus.Processing,
      isStreaming: true,
      isProcessing: true,
      isResponding: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [
        {
          id: 'msg-user',
          role: 'user',
          contentBlocks: [{ type: 'text', text: 'hi' }],
          timestamp: new Date().toISOString(),
        },
      ],
      ...overrides,
    } as any;
  }

  async function makeBackend() {
    const { ConsolidatedBackendService } = await import('../consolidated-backend.service');
    return ConsolidatedBackendService.getInstance({
      healthCheckInterval: 0,
      persistenceEnabled: true,
    }) as any;
  }

  describe('resumeSession', () => {
    it('clears phantom in-flight flags when resuming a session with messages', async () => {
      const backend = await makeBackend();

      const result = await backend.resumeSession(makeSession());

      expect(result.success).toBe(true);
      expect(result.agent.isStreaming).toBe(false);
      expect(result.agent.isProcessing).toBe(false);
      expect(result.agent.isResponding).toBe(false);
    });

    it('demotes a stuck Processing status to Idle when resuming without messages', async () => {
      const backend = await makeBackend();

      const result = await backend.resumeSession(makeSession({ messages: [] }));

      expect(result.success).toBe(true);
      expect(result.agent.status).toBe(AgentStatus.Idle);
      expect(result.agent.isStreaming).toBe(false);
      expect(result.agent.isProcessing).toBe(false);
      expect(result.agent.isResponding).toBe(false);
    });

    it('preserves in-flight flags when a live stream handler exists', async () => {
      streamManagerMock.isActive.mockReturnValue(true);
      const backend = await makeBackend();
      const session = makeSession({
        messages: [
          {
            id: 'msg-assistant',
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'partial' }],
            timestamp: new Date().toISOString(),
            isStreaming: true,
          },
        ],
      });

      const result = await backend.resumeSession(session);

      expect(result.success).toBe(true);
      expect(result.agent.isStreaming).toBe(true);
      expect(result.agent.messages[0].isStreaming).toBe(true);
    });

    it('clears stale message-level isStreaming flags when no handler exists', async () => {
      const backend = await makeBackend();
      const session = makeSession({
        messages: [
          {
            id: 'msg-assistant',
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'partial' }],
            timestamp: new Date().toISOString(),
            isStreaming: true,
          },
        ],
      });

      const result = await backend.resumeSession(session);

      expect(result.success).toBe(true);
      expect(result.agent.isStreaming).toBe(false);
      expect(result.agent.isProcessing).toBe(false);
      expect(result.agent.isResponding).toBe(false);
      expect(result.agent.messages[0].isStreaming).toBe(false);
    });
  });

  describe('loadPersistedSessions', () => {
    it('heals sessions persisted mid-turn before a hard exit', async () => {
      metadataFsMock.readdir.mockResolvedValue([
        { isFile: () => true, name: 'agent-stuck.json' },
      ] as any);
      metadataFsMock.readFile.mockResolvedValue(JSON.stringify(makeSession()));
      const backend = await makeBackend();

      const loaded = await backend.loadPersistedSessions('amber-forest');

      expect(loaded).toBe(1);
      const record = backend.sessions.get('agent-stuck');
      expect(record).toBeDefined();
      expect(record.session.isStreaming).toBe(false);
      expect(record.session.isProcessing).toBe(false);
      expect(record.session.isResponding).toBe(false);
      expect(record.session.status).toBe(AgentStatus.Idle);
    });

    it('heals snapshots whose last message was persisted mid-stream', async () => {
      const session = makeSession({
        messages: [
          {
            id: 'msg-assistant',
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'partial' }],
            timestamp: new Date().toISOString(),
            isStreaming: true,
          },
        ],
      });
      metadataFsMock.readdir.mockResolvedValue([
        { isFile: () => true, name: 'agent-stuck.json' },
      ] as any);
      metadataFsMock.readFile.mockResolvedValue(JSON.stringify(session));
      const backend = await makeBackend();

      const loaded = await backend.loadPersistedSessions('amber-forest');

      expect(loaded).toBe(1);
      const record = backend.sessions.get('agent-stuck');
      expect(record.session.isStreaming).toBe(false);
      expect(record.session.status).toBe(AgentStatus.Idle);
      expect(record.session.messages[0].isStreaming).toBe(false);
    });
  });

  describe('setupEventForwarding', () => {
    it('registers forwarding listeners only once across repeated setup calls', async () => {
      const backend = await makeBackend();

      await backend.setupIPCHandlers();
      await backend.setupIPCHandlers();

      expect(backend.listenerCount('agent:status')).toBe(1);
    });

    it('skips windows whose webContents is already destroyed', async () => {
      const liveSend = vi.fn();
      const zombieSend = vi.fn();
      const liveWindow = {
        id: 1,
        isDestroyed: () => false,
        webContents: { isDestroyed: () => false, send: liveSend },
      };
      const zombieWindow = {
        id: 2,
        isDestroyed: () => false,
        webContents: { isDestroyed: () => true, send: zombieSend },
      };
      browserWindowMock.getAllWindows.mockReturnValue([liveWindow, zombieWindow]);
      const backend = await makeBackend();
      await backend.setupIPCHandlers();

      backend.emit('agent:status', { agentId: 'agent-1', status: AgentStatus.Idle });

      expect(liveSend).toHaveBeenCalledWith('agent:status', {
        agentId: 'agent-1',
        status: AgentStatus.Idle,
      });
      expect(zombieSend).not.toHaveBeenCalled();
    });
  });
});
