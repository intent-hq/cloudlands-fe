import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceId } from '$shared/types/branded-ids';

const dispatchMock = vi.fn();

vi.mock('$shared/logger', () => ({
  Logger: class {
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
    debug = vi.fn();
  },
}));

vi.mock('$shared/services/unified-id.service', () => ({
  unifiedIdService: {
    generateStreamId: () => 'stream-test-id',
  },
}));

vi.mock('$store/renderer/renderer-store-bridge', () => ({
  getRendererStore: () => ({
    get state() {
      return {
        workspace: { workspaces: { map: { 'ws-1': { id: 'ws-1' } } } },
        agentSessions: { byAgentId: {} },
      };
    },
    dispatch: dispatchMock,
  }),
}));

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-slice', () => ({
  removeWorkspaceAgentState: vi.fn((...payload) => ({
    type: 'removeWorkspaceAgentState',
    payload,
  })),
}));

vi.mock('$store/renderer/slices/agent-session/agent-session-slice', () => ({
  addMessage: vi.fn((...payload) => ({ type: 'addMessage', payload })),
  setAgentStreaming: vi.fn((...payload) => ({ type: 'setAgentStreaming', payload })),
  updateAgentDigest: vi.fn((...payload) => ({ type: 'updateAgentDigest', payload })),
}));

vi.mock('$store/renderer/slices/workspace/workspace-slice', () => ({
  setWorkspaceEntity: vi.fn((...payload) => ({ type: 'setWorkspaceEntity', payload })),
  removeWorkspaceEntity: vi.fn((...payload) => ({ type: 'removeWorkspaceEntity', payload })),
}));

describe('StreamManager lifecycle retention cleanup', () => {
  let manager: import('../stream-manager').StreamManager;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    const mod = await import('../stream-manager');
    manager = mod.StreamManager.getInstance();
  });

  afterEach(() => {
    manager?.dispose();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('cleans up cancelled stream callbacks and registered resources promptly', () => {
    const cleanup = vi.fn();
    const onChunk = vi.fn();
    const agentId = 'agent-cancel-cleanup';

    manager.startStream(
      { agentId, sessionId: 'session-cancel', workspaceId: WorkspaceId('ws-1') },
      { onChunk },
    );
    manager.registerCleanup(agentId, cleanup);

    manager.cancelStream(agentId);

    expect(manager.getSession(agentId)).not.toBeNull();
    vi.advanceTimersByTime(1000);

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(manager.getSession(agentId)).toBeNull();
    manager.addTextChunk(agentId, 'late chunk');
    expect(onChunk).not.toHaveBeenCalled();
  });

  it('does not let an old error cleanup remove a replacement stream', () => {
    const oldCleanup = vi.fn();
    const newChunk = vi.fn();
    const agentId = 'agent-replacement-cleanup';

    manager.startStream(
      { agentId, sessionId: 'session-old', workspaceId: WorkspaceId('ws-1') },
      { onChunk: vi.fn() },
    );
    manager.registerCleanup(agentId, oldCleanup);

    manager.cancelStream(agentId);
    manager.startStream(
      { agentId, sessionId: 'session-new', workspaceId: WorkspaceId('ws-1') },
      { onChunk: newChunk },
    );

    expect(oldCleanup).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    manager.addTextChunk(agentId, 'new stream text');

    expect(manager.getSession(agentId)?.config.sessionId).toBe('session-new');
    expect(newChunk).toHaveBeenCalledWith('new stream text');
  });

  it('runs registered cleanup callbacks when force-closing a stream', () => {
    const cleanup = vi.fn();
    const agentId = 'agent-force-close-cleanup';

    manager.startStream({ agentId, sessionId: 'session-force', workspaceId: WorkspaceId('ws-1') });
    manager.registerCleanup(agentId, cleanup);

    manager.forceCloseStream(agentId);

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(manager.getSession(agentId)).toBeNull();
  });

  it('cleanupSession resolves legacy session IDs instead of retaining sessions', () => {
    const cleanup = vi.fn();
    const agentId = 'agent-session-id-cleanup';
    const sessionId = 'legacy-session-id';

    manager.startStream({ agentId, sessionId, workspaceId: WorkspaceId('ws-1') });
    manager.registerCleanup(agentId, cleanup);

    manager.cleanupSession(sessionId);

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(manager.getSession(agentId)).toBeNull();
  });

  it('labels user cancellation with the user_cancel reason', () => {
    const onError = vi.fn();
    const agentId = 'agent-user-cancel-reason';

    manager.startStream(
      { agentId, sessionId: 'session-user-cancel', workspaceId: WorkspaceId('ws-1') },
      { onError },
    );

    manager.cancelStream(agentId);

    expect(onError).toHaveBeenCalledTimes(1);
    const error = onError.mock.calls[0][0] as Error & { reason?: string };
    expect(error.reason).toBe('user_cancel');
    expect(error.message).toBe('Stream cancelled by user');
  });

  it('labels destroy() teardown as manager_disposed, not a user cancellation', () => {
    const onError = vi.fn();
    const agentId = 'agent-destroy-reason';

    manager.startStream(
      { agentId, sessionId: 'session-destroy', workspaceId: WorkspaceId('ws-1') },
      { onError },
    );

    manager.destroy();

    expect(onError).toHaveBeenCalledTimes(1);
    const error = onError.mock.calls[0][0] as Error & { reason?: string };
    expect(error.reason).toBe('manager_disposed');
    expect(error.message).not.toContain('by user');
  });

  it('labels session-cap eviction as session_evicted, not a user cancellation', () => {
    const onError = vi.fn();

    manager.startStream(
      { agentId: 'agent-evict-0', sessionId: 'session-evict-0', workspaceId: WorkspaceId('ws-1') },
      { onError },
    );
    for (let i = 1; i < 10; i++) {
      manager.startStream({
        agentId: `agent-evict-${i}`,
        sessionId: `session-evict-${i}`,
        workspaceId: WorkspaceId('ws-1'),
      });
    }

    // Hitting MAX_SESSIONS evicts the oldest active session
    manager.startStream({
      agentId: 'agent-evict-10',
      sessionId: 'session-evict-10',
      workspaceId: WorkspaceId('ws-1'),
    });

    expect(onError).toHaveBeenCalledTimes(1);
    const error = onError.mock.calls[0][0] as Error & { reason?: string };
    expect(error.reason).toBe('session_evicted');
    expect(error.message).not.toContain('by user');
  });

  it('clears its cleanup and health-check intervals on dispose', async () => {
    // Global timer counts are non-deterministic in CI (other environment
    // timers shift them), so capture the exact interval handles the manager
    // creates during construction and assert dispose() clears those handles.
    manager.dispose();
    vi.resetModules();

    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    try {
      const mod = await import('../stream-manager');
      manager = mod.StreamManager.getInstance();

      const managerIntervals = setIntervalSpy.mock.results.map((result) => result.value);
      expect(managerIntervals).toHaveLength(2);

      manager.dispose();

      for (const handle of managerIntervals) {
        expect(clearIntervalSpy).toHaveBeenCalledWith(handle);
      }
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });
});
