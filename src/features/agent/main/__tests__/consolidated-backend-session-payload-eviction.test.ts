// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentStatus } from '$shared/types';

const {
  agentPersistenceLoadAgentMock,
  agentPersistenceSaveAgentMock,
  selectAgentSubscriptionsSelectMock,
  setMetadataFSResolverMock,
  streamManagerMock,
} = vi.hoisted(() => {
  const streamManager = {
    isActive: vi.fn(() => false),
    cancelStream: vi.fn(),
    cleanupSession: vi.fn(),
    destroy: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    agentPersistenceLoadAgentMock: vi.fn(),
    agentPersistenceSaveAgentMock: vi.fn(async () => ({ success: true })),
    selectAgentSubscriptionsSelectMock: vi.fn(() => []),
    setMetadataFSResolverMock: vi.fn(),
    streamManagerMock: streamManager,
  };
});

vi.mock('uuid', () => ({ v4: () => 'test-uuid' }));
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
vi.mock('../../services/memory-manager', () => ({
  memoryManager: { registerTimer: vi.fn(), cleanup: vi.fn(), unregister: vi.fn() },
}));
vi.mock('../agent-persistence', () => ({
  agentPersistence: {
    loadAgent: agentPersistenceLoadAgentMock,
    saveAgent: agentPersistenceSaveAgentMock,
  },
  unifiedPersistence: { setMetadataFSResolver: setMetadataFSResolverMock },
}));
vi.mock('../../metadata-fs/main/metadata-fs-factory', () => ({ getMetadataFS: vi.fn() }));
vi.mock('$store/main/redux-store-bridge', () => ({ getMainState: vi.fn(() => ({})) }));
vi.mock('$store/main/slices/agent-subscriptions/agent-subscriptions-selectors', () => ({
  selectAgentSubscriptions: { select: selectAgentSubscriptionsSelectMock },
}));

describe('ConsolidatedBackendService session payload eviction', () => {
  beforeEach(() => {
    process.env.INTENT_DISABLE_BACKEND_SIGNAL_HANDLERS = '1';
    agentPersistenceLoadAgentMock.mockReset();
    agentPersistenceSaveAgentMock.mockClear();
    agentPersistenceSaveAgentMock.mockResolvedValue({ success: true });
    selectAgentSubscriptionsSelectMock.mockReset();
    selectAgentSubscriptionsSelectMock.mockReturnValue([]);
    streamManagerMock.isActive.mockReset();
    streamManagerMock.isActive.mockReturnValue(false);
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
      id: 'agent-completed',
      backendSessionId: 'backend-session',
      workspaceId: 'amber-forest',
      name: 'Completed Agent',
      model: 'sonnet4.5',
      provider: 'augment',
      systemPrompt: '',
      status: AgentStatus.Completed,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [
        {
          id: 'msg-user',
          role: 'user',
          contentBlocks: [{ type: 'text', text: 'hi' }],
          timestamp: new Date().toISOString(),
        },
        {
          id: 'msg-assistant',
          role: 'assistant',
          contentBlocks: [{ type: 'text', text: 'large payload' }],
          timestamp: new Date().toISOString(),
        },
      ],
      ...overrides,
    } as any;
  }

  async function makeBackendWithSession(session = makeSession(), lastActivity = new Date()) {
    const { ConsolidatedBackendService } = await import('../consolidated-backend.service');
    const backend = ConsolidatedBackendService.getInstance({
      healthCheckInterval: 0,
      persistenceEnabled: true,
    }) as any;
    backend.sessions.set(session.id, {
      agentId: session.id,
      sessionId: session.backendSessionId,
      workspaceId: session.workspaceId,
      session,
      streamBuffer: ['old stream buffer'],
      messageCount: session.messages.length,
      lastActivity,
      errors: [],
    });
    return backend;
  }

  it('evicts completed messages after successful persistence and restores them on getAgent', async () => {
    const session = makeSession();
    agentPersistenceLoadAgentMock.mockResolvedValue({ success: true, data: session });
    const backend = await makeBackendWithSession(session);

    await expect(backend.saveAgent(session.id)).resolves.toEqual({ success: true });

    const record = backend.sessions.get(session.id);
    expect(agentPersistenceSaveAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ messages: session.messages }),
    );
    expect(record.session.messages).toEqual([]);
    expect(record.messagesEvicted).toBe(true);
    expect(record.messageCount).toBe(2);
    expect(record.streamBuffer).toEqual([]);

    await expect(backend.getAgent(session.id)).resolves.toMatchObject({
      messages: session.messages,
    });
    expect(agentPersistenceLoadAgentMock).toHaveBeenCalledWith(session.id, session.workspaceId);
    expect(backend.sessions.get(session.id).messagesEvicted).toBe(false);
  });

  it('does not evict completed messages while the stream manager reports an active stream', async () => {
    streamManagerMock.isActive.mockReturnValue(true);
    const session = makeSession({ id: 'agent-streaming' });
    const backend = await makeBackendWithSession(session);

    await backend.saveAgent(session.id);

    const record = backend.sessions.get(session.id);
    expect(record.session.messages).toHaveLength(2);
    expect(record.messagesEvicted).not.toBe(true);
  });

  it('does not evict active session messages', async () => {
    const session = makeSession({ id: 'agent-active', status: AgentStatus.Active });
    const backend = await makeBackendWithSession(session);

    await backend.saveAgent(session.id);

    const record = backend.sessions.get(session.id);
    expect(record.session.messages).toHaveLength(2);
    expect(record.messagesEvicted).not.toBe(true);
  });

  it('does not evict completed messages for agents with active subscriptions', async () => {
    selectAgentSubscriptionsSelectMock.mockReturnValue([
      { id: 'sub-1', agentId: 'agent-completed' },
    ]);
    const session = makeSession();
    const backend = await makeBackendWithSession(session);

    await backend.saveAgent(session.id);

    const record = backend.sessions.get(session.id);
    expect(record.session.messages).toHaveLength(2);
    expect(record.messagesEvicted).not.toBe(true);
  });

  it('evicts idle messages after the idle payload threshold has elapsed', async () => {
    const session = makeSession({ id: 'agent-idle', status: AgentStatus.Idle });
    const lastActivity = new Date(Date.now() - 3 * 60 * 1000);
    const backend = await makeBackendWithSession(session, lastActivity);

    await backend.saveAgent(session.id);

    expect(backend.sessions.get(session.id).session.messages).toEqual([]);
    expect(backend.sessions.get(session.id).messagesEvicted).toBe(true);
  });

  it('keeps evicted completed sessions visible in workspace lists', async () => {
    const session = makeSession();
    const backend = await makeBackendWithSession(session);

    await backend.saveAgent(session.id);

    const agents = await backend.listAgents(session.workspaceId);
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ id: session.id, status: AgentStatus.Completed });
    expect(agents[0].messages).toEqual([]);
  });

  it('returns loaded persisted messages while evicting the in-memory load copy', async () => {
    const session = makeSession({ id: 'agent-loaded' });
    agentPersistenceLoadAgentMock.mockResolvedValue({ success: true, data: session });
    const { ConsolidatedBackendService } = await import('../consolidated-backend.service');
    const backend = ConsolidatedBackendService.getInstance({
      healthCheckInterval: 0,
      persistenceEnabled: true,
    }) as any;

    const result = await backend.loadAgent(session.id, {
      id: session.workspaceId,
      path: '/tmp/amber-forest',
      title: 'Workspace',
    });

    expect(result).toMatchObject({ success: true, agent: { messages: session.messages } });
    const record = backend.sessions.get(session.id);
    expect(record.session.messages).toEqual([]);
    expect(record.messagesEvicted).toBe(true);
    expect(record.messageCount).toBe(2);
  });
});
