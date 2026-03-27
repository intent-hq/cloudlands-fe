// @vitest-environment node

/**
 * Regression test: EventEmitter SIGTERM/SIGINT listener leak
 *
 * ConsolidatedBackendService.setupShutdownHandlers() registers anonymous arrow
 * functions on process.on('SIGINT'/'SIGTERM'). The singleton's dispose() method
 * calls this.removeAllListeners() (clearing the custom EventEmitter listeners)
 * and sets the static instance to undefined, but does NOT remove the process
 * signal listeners. When getInstance() is called again, a new instance is
 * created and setupShutdownHandlers() adds MORE listeners to the process,
 * causing listener accumulation (leak).
 *
 * This test proves that after multiple getInstance()/dispose() cycles,
 * the SIGTERM/SIGINT listener count on process grows unboundedly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all heavy dependencies so we can instantiate ConsolidatedBackendService in isolation.

vi.mock('uuid', () => ({ v4: () => 'test-uuid' }));
vi.mock('$shared/services/unified-id.service', () => ({
  unifiedIdService: { generateAgentId: () => 'agent-1', generateSessionId: () => 'session-1' },
}));
vi.mock('$shared/logger', () => {
  const noop = () => {};
  const loggerInstance = { info: noop, warn: noop, error: noop, debug: noop };
  class MockLogger {
    info = noop;
    warn = noop;
    error = noop;
    debug = noop;
  }
  return { Logger: MockLogger, logger: loggerInstance };
});
vi.mock('$shared/types', () => ({
  AgentStatus: { IDLE: 'idle', ACTIVE: 'active', ERROR: 'error' },
}));
vi.mock('$shared/types/branded-ids', () => ({
  createAgentId: (id: string) => id,
  createSessionId: (id: string) => id,
  createWorkspaceId: (id: string) => id,
  createMessageId: (id: string) => id,
}));
vi.mock('../services/stream-manager', () => ({
  StreamManager: {
    getInstance: () => ({
      dispose: vi.fn(),
      cleanupSession: vi.fn(),
    }),
  },
}));
vi.mock('../services/agent-validator', () => ({
  agentValidator: { validateConfig: vi.fn(() => ({ valid: true })) },
}));
vi.mock('../services/error-handler', () => ({
  errorHandler: { handleError: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
vi.mock('$shared/ipc/channels', () => ({
  AGENT_BACKEND_CHANNELS: {},
  PERSISTENCE_CHANNELS: {},
}));
vi.mock('../services/memory-manager', () => ({
  memoryManager: { register: vi.fn(), cleanup: vi.fn(), unregister: vi.fn() },
}));

describe('ConsolidatedBackendService SIGTERM/SIGINT listener leak', () => {
  let initialSigintCount: number;
  let initialSigtermCount: number;

  beforeEach(() => {
    // Record baseline listener counts before each test
    initialSigintCount = process.listenerCount('SIGINT');
    initialSigtermCount = process.listenerCount('SIGTERM');
  });

  afterEach(async () => {
    // Clean up: remove any listeners we added beyond the baseline.
    // We need to re-import to get current instance and dispose it.
    const mod = await import('../consolidated-backend.service');
    const CBS = mod.ConsolidatedBackendService;

    // Reset the singleton so the next test starts fresh
    // Access private static via cast
    (CBS as any).instance?.dispose?.();
    (CBS as any).instance = undefined;

    // Remove excess SIGINT/SIGTERM listeners that leaked
    const currentSigint = process.listenerCount('SIGINT');
    const currentSigterm = process.listenerCount('SIGTERM');
    // We can't easily remove anonymous listeners, but we can at least reset
    // the module between tests
    vi.resetModules();
  });

  it('should NOT accumulate process SIGINT/SIGTERM listeners after multiple getInstance()/dispose() cycles', async () => {
    // Dynamic import so mocks are applied
    const mod = await import('../consolidated-backend.service');
    const CBS = mod.ConsolidatedBackendService;

    const cycles = 5;

    for (let i = 0; i < cycles; i++) {
      const instance = CBS.getInstance({ healthCheckInterval: 0 });
      instance.dispose();
    }

    const sigintAdded = process.listenerCount('SIGINT') - initialSigintCount;
    const sigtermAdded = process.listenerCount('SIGTERM') - initialSigtermCount;

    // FIX: dispose() now removes the process signal handlers, so listener count
    // should not grow with cycles. After all cycles complete (with dispose),
    // no extra listeners should remain.
    expect(sigintAdded).toBeLessThanOrEqual(0);
    expect(sigtermAdded).toBeLessThanOrEqual(0);
  });
});

