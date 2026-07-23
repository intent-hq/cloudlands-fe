import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
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

vi.mock('$store/renderer/slices/unread-tracking/unread-tracking-slice', () => ({
  newAssistantMessage: vi.fn((...payload) => ({ type: 'newAssistantMessage', payload })),
}));

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-slice', () => ({
  removeWorkspaceAgentState: vi.fn((...payload) => ({ type: 'removeWorkspaceAgentState', payload })),
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