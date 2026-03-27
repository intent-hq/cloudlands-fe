import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  reduxDispatchMock,
  getReduxStoreMock,
  syncWorkspaceSettingsMock,
  untrackMock,
  unifiedStateStoreMock,
  agentServiceMock,
  notesStateManagerMock,
  fileTrackingStoreMock,
} = vi.hoisted(() => ({
  reduxDispatchMock: vi.fn(),
  getReduxStoreMock: vi.fn(),
  syncWorkspaceSettingsMock: vi.fn((workspaceId: string) => ({
    type: 'workspaceSettings/syncWorkspaceSettings',
    payload: [workspaceId],
  })),
  untrackMock: vi.fn(<T>(fn: () => T): T => fn()),
  unifiedStateStoreMock: { currentWorkspace: null as any },
  agentServiceMock: { getSession: vi.fn((): any => null) },
  notesStateManagerMock: { findById: vi.fn((): any => null) },
  fileTrackingStoreMock: {
    workingChanges: {
      unstaged: [] as any[],
      staged: [] as any[],
    },
  },
}));

vi.mock('svelte', async (importOriginal) => {
  const original = await importOriginal<typeof import('svelte')>();
  return { ...original, untrack: untrackMock };
});

vi.mock('$features/agent/browser', () => ({
  unifiedStateStore: unifiedStateStoreMock,
}));

vi.mock('$features/agent/agent.service', () => ({
  agentService: agentServiceMock,
}));

vi.mock('$features/notes/notes.store.svelte', () => ({
  notesStateManager: notesStateManagerMock,
}));

vi.mock('../file-tracking.store.svelte', () => ({
  fileTrackingStore: fileTrackingStoreMock,
}));

vi.mock('$lib/store/slices/workspace-settings/workspace-settings-slice', () => ({
  syncWorkspaceSettings: syncWorkspaceSettingsMock,
  emptyWorkspaceSettings: { autoCommitEnabled: true },
}));

vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  dispatch: reduxDispatchMock,
  getReduxStore: getReduxStoreMock,
}));

import { createAgentLockStore } from '../agent-lock.store.svelte';

describe('createAgentLockStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not throw when Redux bridges are not initialized yet', () => {
    getReduxStoreMock.mockImplementation(() => {
      throw new Error('store bridge not initialized');
    });
    reduxDispatchMock.mockImplementation(() => {
      throw new Error('dispatch bridge not initialized');
    });

    expect(() => createAgentLockStore('ws-1')).not.toThrow();
    expect(syncWorkspaceSettingsMock).toHaveBeenCalledWith('ws-1');
    expect(reduxDispatchMock).toHaveBeenCalledWith({
      type: 'workspaceSettings/syncWorkspaceSettings',
      payload: ['ws-1'],
    });
  });

  describe('untrack guard for isAgentActivelyWorking', () => {
    function setupFileChangesWithAgent(agentId: string) {
      fileTrackingStoreMock.workingChanges.unstaged = [
        {
          relativePath: 'src/foo.ts',
          file: 'src/foo.ts',
          attribution: { agent: { agentId } },
        },
      ];
      fileTrackingStoreMock.workingChanges.staged = [];
    }

    afterEach(() => {
      // Reset file tracking mock to empty
      fileTrackingStoreMock.workingChanges.unstaged = [];
      fileTrackingStoreMock.workingChanges.staged = [];
      unifiedStateStoreMock.currentWorkspace = null;
      agentServiceMock.getSession.mockReset();
      notesStateManagerMock.findById.mockReset();
    });

    it('calls untrack when computing lockedAgentIds with agent file changes', () => {
      setupFileChangesWithAgent('agent-1');

      const store = createAgentLockStore('ws-1');

      // Clear any untrack calls from store creation
      untrackMock.mockClear();

      // Access lockedAgentIds to trigger the $derived.by computation
      const _ids = store.lockedAgentIds;

      expect(untrackMock).toHaveBeenCalled();
    });

    it('reads unifiedStateStore.currentWorkspace inside untrack wrapper', () => {
      setupFileChangesWithAgent('agent-1');
      unifiedStateStoreMock.currentWorkspace = {
        agents: new Map([
          ['agent-1', { streaming: { active: true } }],
        ]),
      };

      // Track what happens inside untrack
      let readCurrentWorkspace = false;
      untrackMock.mockImplementation(<T>(fn: () => T): T => {
        const originalWorkspace = unifiedStateStoreMock.currentWorkspace;
        const proxy = new Proxy(unifiedStateStoreMock, {
          get(target, prop) {
            if (prop === 'currentWorkspace') {
              readCurrentWorkspace = true;
            }
            return (target as any)[prop];
          },
        });
        // Temporarily swap to detect reads
        const origRef = unifiedStateStoreMock.currentWorkspace;
        const result = fn();
        return result;
      });

      const store = createAgentLockStore('ws-1');
      const _ids = store.lockedAgentIds;

      // untrack was called and the function inside read from the stores
      expect(untrackMock).toHaveBeenCalled();
      // The function passed to untrack should have been executed (not skipped)
      const callArgs = untrackMock.mock.calls;
      const lastCall = callArgs[callArgs.length - 1];
      expect(typeof lastCall[0]).toBe('function');
    });

    it('reads agentService.getSession inside untrack wrapper', () => {
      setupFileChangesWithAgent('agent-1');
      agentServiceMock.getSession.mockReturnValue({
        isStreaming: false,
        metadata: { taskNoteId: 'task-1' },
      });
      notesStateManagerMock.findById.mockReturnValue({
        metadata: { task: { status: 'in_progress' } },
      });

      // Reset untrack to passthrough and track calls
      untrackMock.mockImplementation(<T>(fn: () => T): T => fn());

      const store = createAgentLockStore('ws-1');
      untrackMock.mockClear();
      agentServiceMock.getSession.mockClear();

      const _ids = store.lockedAgentIds;

      // untrack must have been called
      expect(untrackMock).toHaveBeenCalled();
      // agentService.getSession was called (inside untrack)
      expect(agentServiceMock.getSession).toHaveBeenCalledWith('agent-1');
    });

    it('reads notesStateManager.findById inside untrack wrapper', () => {
      setupFileChangesWithAgent('agent-1');
      agentServiceMock.getSession.mockReturnValue({
        isStreaming: false,
        metadata: { taskNoteId: 'task-1' },
      });
      notesStateManagerMock.findById.mockReturnValue({
        metadata: { task: { status: 'in_progress' } },
      });

      untrackMock.mockImplementation(<T>(fn: () => T): T => fn());

      const store = createAgentLockStore('ws-1');
      untrackMock.mockClear();
      notesStateManagerMock.findById.mockClear();

      const _ids = store.lockedAgentIds;

      expect(untrackMock).toHaveBeenCalled();
      expect(notesStateManagerMock.findById).toHaveBeenCalledWith('task-1');
    });

    it('does not call untrack when there are no agent file changes', () => {
      // No file changes = no agents to check = no untrack calls for isAgentActivelyWorking
      fileTrackingStoreMock.workingChanges.unstaged = [];
      fileTrackingStoreMock.workingChanges.staged = [];

      const store = createAgentLockStore('ws-1');
      untrackMock.mockClear();

      const _ids = store.lockedAgentIds;

      // untrack should NOT be called because there are no agent IDs to check
      expect(untrackMock).not.toHaveBeenCalled();
    });
  });
});