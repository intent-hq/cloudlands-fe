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

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';

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
  NoteId: (id: string) => id,
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

  it('should SKIP SIGINT/SIGTERM registration when INTENT_DISABLE_BACKEND_SIGNAL_HANDLERS=1 (Electron single-owner)', async () => {
    // Simulate the Electron main process telling the backend service to stay
    // out of signal handling. src/main/index.ts is the single owner of
    // SIGINT/SIGTERM in Electron so that persistShutdownState() can run
    // BEFORE shutdownUnifiedBackend() without a race.
    const prev = process.env.INTENT_DISABLE_BACKEND_SIGNAL_HANDLERS;
    process.env.INTENT_DISABLE_BACKEND_SIGNAL_HANDLERS = '1';
    try {
      const mod = await import('../consolidated-backend.service');
      const CBS = mod.ConsolidatedBackendService;

      const instance = CBS.getInstance({ healthCheckInterval: 0 });

      const sigintAdded = process.listenerCount('SIGINT') - initialSigintCount;
      const sigtermAdded = process.listenerCount('SIGTERM') - initialSigtermCount;

      expect(sigintAdded).toBe(0);
      expect(sigtermAdded).toBe(0);

      instance.dispose();
    } finally {
      if (prev === undefined) {
        delete process.env.INTENT_DISABLE_BACKEND_SIGNAL_HANDLERS;
      } else {
        process.env.INTENT_DISABLE_BACKEND_SIGNAL_HANDLERS = prev;
      }
    }
  });

  it('should SKIP SIGINT/SIGTERM registration when running inside Electron (process.versions.electron set)', async () => {
    const versions = process.versions as Record<string, string>;
    const prev = versions.electron;
    // Simulate Electron runtime. In real Electron main process this is set
    // automatically; tests run in plain Node so we stub it.
    Object.defineProperty(process.versions, 'electron', {
      value: '37.0.0-test',
      configurable: true,
      writable: true,
    });
    try {
      const mod = await import('../consolidated-backend.service');
      const CBS = mod.ConsolidatedBackendService;

      const instance = CBS.getInstance({ healthCheckInterval: 0 });

      const sigintAdded = process.listenerCount('SIGINT') - initialSigintCount;
      const sigtermAdded = process.listenerCount('SIGTERM') - initialSigtermCount;

      expect(sigintAdded).toBe(0);
      expect(sigtermAdded).toBe(0);

      instance.dispose();
    } finally {
      if (prev === undefined) {
        delete (process.versions as Record<string, string | undefined>).electron;
      } else {
        Object.defineProperty(process.versions, 'electron', {
          value: prev,
          configurable: true,
          writable: true,
        });
      }
    }
  });
});

