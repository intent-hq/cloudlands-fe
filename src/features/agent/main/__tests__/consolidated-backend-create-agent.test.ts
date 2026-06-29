// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { agentPersistenceSaveAgentMock, setMetadataFSResolverMock } = vi.hoisted(() => ({
  agentPersistenceSaveAgentMock: vi.fn(async () => ({ success: true })),
  setMetadataFSResolverMock: vi.fn(),
}));

vi.mock('uuid', () => ({ v4: () => 'test-uuid' }));
vi.mock('$shared/services/unified-id.service', () => ({
  unifiedIdService: { generateAgentId: () => 'agent-generated' },
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
vi.mock('../services/stream-manager', () => ({
  StreamManager: { getInstance: () => ({ dispose: vi.fn(), cleanupSession: vi.fn() }) },
}));
vi.mock('../agent-validator', () => ({
  agentValidator: { validateConfig: vi.fn(() => ({ valid: true })) },
}));
vi.mock('../services/error-handler', () => ({
  errorHandler: { handleError: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
vi.mock('$shared/ipc/channels', () => ({ AGENT_BACKEND_CHANNELS: {}, PERSISTENCE_CHANNELS: {} }));
vi.mock('../services/memory-manager', () => ({
  memoryManager: { register: vi.fn(), cleanup: vi.fn(), unregister: vi.fn() },
}));
vi.mock('../agent-persistence', () => ({
  agentPersistence: { saveAgent: agentPersistenceSaveAgentMock },
  unifiedPersistence: {
    setMetadataFSResolver: setMetadataFSResolverMock,
    markAgentPending: vi.fn(),
  },
}));
vi.mock('../../metadata-fs/main/metadata-fs-factory', () => ({
  getMetadataFS: vi.fn(),
}));

import { AgentStatus } from '$shared/types';

describe('ConsolidatedBackendService.createAgent', () => {
  beforeEach(() => {
    process.env.INTENT_DISABLE_BACKEND_SIGNAL_HANDLERS = '1';
    agentPersistenceSaveAgentMock.mockClear();
    agentPersistenceSaveAgentMock.mockResolvedValue({ success: true });
    setMetadataFSResolverMock.mockClear();
  });

  afterEach(async () => {
    const { ConsolidatedBackendService } = await import('../consolidated-backend.service');
    (ConsolidatedBackendService as any).instance?.dispose?.();
    (ConsolidatedBackendService as any).instance = undefined;
    delete process.env.INTENT_DISABLE_BACKEND_SIGNAL_HANDLERS;
    vi.resetModules();
  });

  it('creates blank sessions as idle and non-responding', async () => {
    const { ConsolidatedBackendService } = await import('../consolidated-backend.service');
    const backend = ConsolidatedBackendService.getInstance({
      healthCheckInterval: 0,
      persistenceEnabled: false,
    });

    const result = await backend.createAgent(
      { id: 'ws-blank', path: '/tmp/ws-blank', title: 'Blank Workspace' } as any,
      { name: 'Blank Agent', workspaceId: 'ws-blank' as any },
    );

    expect(result.success).toBe(true);
    expect(result.agent).toMatchObject({
      status: AgentStatus.Idle,
      messages: [],
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
    });
  });

  it('does not persist zero-message sessions during create flow', async () => {
    const { ConsolidatedBackendService } = await import('../consolidated-backend.service');
    const backend = ConsolidatedBackendService.getInstance({
      healthCheckInterval: 0,
      persistenceEnabled: true,
    });

    const result = await backend.createAgent(
      { id: 'ws-blank', path: '/tmp/ws-blank', title: 'Blank Workspace' } as any,
      { id: 'agent-blank', name: 'Blank Agent', workspaceId: 'ws-blank' as any },
    );

    expect(result.success).toBe(true);
    expect(result.agent?.messages).toEqual([]);
    expect(agentPersistenceSaveAgentMock).not.toHaveBeenCalled();
  });

  it('persists sessions with at least one message during create flow', async () => {
    const { ConsolidatedBackendService } = await import('../consolidated-backend.service');
    const backend = ConsolidatedBackendService.getInstance({
      healthCheckInterval: 0,
      persistenceEnabled: true,
    });

    const result = await backend.createAgent(
      { id: 'amber-forest', path: '/tmp/amber-forest', title: 'Workspace' } as any,
      {
        id: 'agent-with-message',
        name: 'Agent With Message',
        workspaceId: 'amber-forest' as any,
        initialMessage: 'Hello',
      },
    );

    expect(result.success).toBe(true);
    expect(result.agent?.messages).toHaveLength(1);
    expect(agentPersistenceSaveAgentMock).toHaveBeenCalledTimes(1);
    expect(agentPersistenceSaveAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-with-message', messages: expect.any(Array) }),
    );
  });
});
