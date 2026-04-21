// @vitest-environment node

/**
 * Regression test: shutdown-save overwrite of repaired streaming state.
 *
 * Clean-quit ordering in src/main/index.ts:
 *   1. agentBackendHandler.persistShutdownState() — loads each streaming
 *      agent from disk, flips isStreaming/isProcessing to false, status to
 *      Idle, and saves the repaired copy back.
 *   2. shutdownUnifiedBackend() → ConsolidatedBackendService.shutdown() —
 *      iterates its in-memory `sessions` Map and, prior to this fix, called
 *      saveAgent() for every session. The in-memory `record.session` is a
 *      SEPARATE object from the copy persistShutdownState just repaired; it
 *      still carries `isStreaming: true`, so the unconditional save in (2)
 *      silently overwrote the repaired idle on-disk state.
 *
 * Fix: ConsolidatedBackendService.shutdown() skips saveAgent for any session
 * whose in-memory snapshot has isStreaming === true or isProcessing === true,
 * OR has any assistant message with message.isStreaming === true. The
 * message-level check matters because persistStreamingSessionState() writes
 * message.isStreaming=true onto the shared in-memory backend session without
 * ever setting session-level flags — so a session can be mid-stream with only
 * the per-message flag set. Those are exactly the sessions persistShutdownState
 * repaired (or would be orphan-recovered on next load) — saving the stale
 * in-memory copy during shutdown is never correct.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  AgentStatus: { Idle: 'Idle', Active: 'active', Error: 'error' },
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
    getInstance: () => ({ destroy: vi.fn(), dispose: vi.fn(), cleanupSession: vi.fn() }),
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

describe('ConsolidatedBackendService.shutdown() — no overwrite of repaired streaming state', () => {
  beforeEach(() => {
    process.env.INTENT_DISABLE_BACKEND_SIGNAL_HANDLERS = '1';
  });

  afterEach(async () => {
    const mod = await import('../consolidated-backend.service');
    const CBS = mod.ConsolidatedBackendService;
    (CBS as any).instance?.dispose?.();
    (CBS as any).instance = undefined;
    delete process.env.INTENT_DISABLE_BACKEND_SIGNAL_HANDLERS;
    vi.resetModules();
  });

  async function makeInstance(
    sessions: Array<{
      id: string;
      isStreaming?: boolean;
      isProcessing?: boolean;
      messages?: Array<{ role: string; isStreaming?: boolean }>;
    }>,
  ) {
    const mod = await import('../consolidated-backend.service');
    const CBS = mod.ConsolidatedBackendService;
    const instance = CBS.getInstance({ healthCheckInterval: 0, persistenceEnabled: true }) as any;
    // Seed the private sessions Map directly; we only care about the shutdown path.
    for (const s of sessions) {
      instance.sessions.set(s.id, {
        agentId: s.id,
        sessionId: s.id,
        workspaceId: 'ws',
        session: {
          id: s.id,
          workspaceId: 'ws',
          messages: s.messages ?? [],
          status: s.isStreaming ? 'active' : 'Idle',
          isStreaming: s.isStreaming,
          isProcessing: s.isProcessing,
        },
        streamBuffer: [],
        messageCount: 0,
        lastActivity: new Date(),
        errors: [],
      });
    }
    return instance;
  }

  it('skips saveAgent for sessions whose in-memory snapshot still has isStreaming=true', async () => {
    const instance = await makeInstance([
      { id: 'agent-streaming', isStreaming: true, isProcessing: true },
      { id: 'agent-idle', isStreaming: false, isProcessing: false },
    ]);
    const saveSpy = vi.spyOn(instance, 'saveAgent').mockResolvedValue({ success: true });

    await instance.shutdown();

    const savedIds = saveSpy.mock.calls.map((c) => c[0]);
    expect(savedIds).not.toContain('agent-streaming');
    expect(savedIds).toContain('agent-idle');
  });

  it('skips saveAgent for sessions with isProcessing=true even when isStreaming is not set', async () => {
    const instance = await makeInstance([
      { id: 'agent-processing', isStreaming: false, isProcessing: true },
    ]);
    const saveSpy = vi.spyOn(instance, 'saveAgent').mockResolvedValue({ success: true });

    await instance.shutdown();

    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('skips saveAgent when only a message-level isStreaming=true is set (no session-level flags)', async () => {
    // Regression: persistStreamingSessionState() mutates the shared in-memory
    // backend session by pushing/updating an assistant message with
    // message.isStreaming=true but does NOT set session-level
    // isStreaming/isProcessing. If shutdown only checks session-level flags,
    // the stale streaming message on the in-memory copy would be re-saved on
    // top of the already-repaired idle disk state.
    const instance = await makeInstance([
      {
        id: 'agent-msg-streaming',
        isStreaming: false,
        isProcessing: false,
        messages: [
          { role: 'user' },
          { role: 'assistant', isStreaming: true },
        ],
      },
    ]);
    const saveSpy = vi.spyOn(instance, 'saveAgent').mockResolvedValue({ success: true });

    await instance.shutdown();

    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('still saves idle sessions during shutdown (regression guard for the inverse)', async () => {
    const instance = await makeInstance([
      { id: 'agent-a', isStreaming: false, isProcessing: false },
      { id: 'agent-b', isStreaming: false, isProcessing: false },
    ]);
    const saveSpy = vi.spyOn(instance, 'saveAgent').mockResolvedValue({ success: true });

    await instance.shutdown();

    const savedIds = saveSpy.mock.calls.map((c) => c[0]).sort();
    expect(savedIds).toEqual(['agent-a', 'agent-b']);
  });
});
