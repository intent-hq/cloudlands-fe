// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('../services/agent-validator', () => ({
  agentValidator: { validateConfig: vi.fn(() => ({ valid: true })) },
}));
vi.mock('../services/error-handler', () => ({
  errorHandler: { handleError: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
vi.mock('$shared/ipc/channels', () => ({ AGENT_BACKEND_CHANNELS: {}, PERSISTENCE_CHANNELS: {} }));
vi.mock('../services/memory-manager', () => ({
  memoryManager: { register: vi.fn(), cleanup: vi.fn(), unregister: vi.fn() },
}));

import { AgentStatus } from '$shared/types';

describe('ConsolidatedBackendService.createAgent', () => {
  beforeEach(() => {
    process.env.INTENT_DISABLE_BACKEND_SIGNAL_HANDLERS = '1';
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
});
