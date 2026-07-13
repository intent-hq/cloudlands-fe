import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  getWorkspace: vi.fn(),
  computeWorkspaceDiffSummary: vi.fn(),
  computeWorkspaceGitSummary: vi.fn(),
  getWorkspaceTasks: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      mocks.handlers.set(channel, handler);
    }),
  },
}));

vi.mock('../../../protocol/main/protocol-adapter', () => ({
  protocolAdapter: {
    getWorkspace: mocks.getWorkspace,
  },
}));

vi.mock('../workspace-summaries', () => ({
  computeWorkspaceDiffSummary: mocks.computeWorkspaceDiffSummary,
  computeWorkspaceGitSummary: mocks.computeWorkspaceGitSummary,
  getWorkspaceTasks: mocks.getWorkspaceTasks,
}));

import { setupWorkspaceSummaryIPC } from '../workspace-summary.ipc';

const WORKSPACE_ID = 'amber-forest';
const WORKSPACE = { id: WORKSPACE_ID, worktreePath: '/tmp/wt', baseRef: 'main' };

const invoke = (channel: string, payload: unknown) => {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return handler({}, payload);
};

describe('setupWorkspaceSummaryIPC', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.getWorkspace.mockReset();
    mocks.computeWorkspaceDiffSummary.mockReset();
    mocks.computeWorkspaceGitSummary.mockReset();
    mocks.getWorkspaceTasks.mockReset();
    setupWorkspaceSummaryIPC();
  });

  it('registers handlers for all three on-demand channels', () => {
    expect(mocks.handlers.has('workspace:get-diff-summary')).toBe(true);
    expect(mocks.handlers.has('workspace:get-git-summary')).toBe(true);
    expect(mocks.handlers.has('workspace:get-tasks')).toBe(true);
  });

  describe('workspace:get-diff-summary', () => {
    it('returns computed diff summary without persisting to the workspace', async () => {
      const summary = {
        schemaVersion: 1,
        updatedAt: '2026-06-09T00:00:00.000Z',
        totalFiles: 3,
        totalAdditions: 10,
        totalDeletions: 2,
        files: [],
      };
      mocks.getWorkspace.mockResolvedValue({ ...WORKSPACE });
      mocks.computeWorkspaceDiffSummary.mockResolvedValue(summary);

      const response = await invoke('workspace:get-diff-summary', { workspaceId: WORKSPACE_ID });

      expect(response).toEqual({ success: true, data: summary });
      expect(mocks.computeWorkspaceDiffSummary).toHaveBeenCalledWith(WORKSPACE_ID, '/tmp/wt');
    });

    it('returns null data when there are no changes', async () => {
      mocks.getWorkspace.mockResolvedValue({ ...WORKSPACE });
      mocks.computeWorkspaceDiffSummary.mockResolvedValue(undefined);

      const response = await invoke('workspace:get-diff-summary', { workspaceId: WORKSPACE_ID });

      expect(response).toEqual({ success: true, data: null });
    });

    it('returns failure when the workspace is not found', async () => {
      mocks.getWorkspace.mockResolvedValue(null);

      const response = await invoke('workspace:get-diff-summary', { workspaceId: WORKSPACE_ID });

      expect(response).toEqual({ success: false, error: 'Workspace not found' });
      expect(mocks.computeWorkspaceDiffSummary).not.toHaveBeenCalled();
    });

    it('scopes computation errors to the response', async () => {
      mocks.getWorkspace.mockResolvedValue({ ...WORKSPACE });
      mocks.computeWorkspaceDiffSummary.mockRejectedValue(new Error('git exploded'));

      const response = await invoke('workspace:get-diff-summary', { workspaceId: WORKSPACE_ID });

      expect(response).toEqual({ success: false, error: 'Failed to get diff summary' });
    });
  });

  describe('workspace:get-git-summary', () => {
    it('returns computed git summary using workspace worktree and baseRef', async () => {
      const summary = { ahead: 2, behind: 1, hasUnpushed: true, commits: [] };
      mocks.getWorkspace.mockResolvedValue({ ...WORKSPACE });
      mocks.computeWorkspaceGitSummary.mockResolvedValue(summary);

      const response = await invoke('workspace:get-git-summary', { workspaceId: WORKSPACE_ID });

      expect(response).toEqual({ success: true, data: summary });
      expect(mocks.computeWorkspaceGitSummary).toHaveBeenCalledWith({
        id: WORKSPACE_ID,
        worktreePath: '/tmp/wt',
        baseRef: 'main',
      });
    });

    it('returns null data when branch is even with base', async () => {
      mocks.getWorkspace.mockResolvedValue({ ...WORKSPACE });
      mocks.computeWorkspaceGitSummary.mockResolvedValue(undefined);

      const response = await invoke('workspace:get-git-summary', { workspaceId: WORKSPACE_ID });

      expect(response).toEqual({ success: true, data: null });
    });

    it('returns failure when the workspace is not found', async () => {
      mocks.getWorkspace.mockResolvedValue(null);

      const response = await invoke('workspace:get-git-summary', { workspaceId: WORKSPACE_ID });

      expect(response).toEqual({ success: false, error: 'Workspace not found' });
    });
  });

  describe('workspace:get-tasks', () => {
    it('returns the canonical task list', async () => {
      const tasks = [
        { id: 'task-1', title: 'Do thing', status: 'in_progress', updatedAt: '2026-06-09T00:00:00.000Z' },
        { id: 'task-2', title: 'Other thing', status: 'complete' },
      ];
      mocks.getWorkspaceTasks.mockResolvedValue(tasks);

      const response = await invoke('workspace:get-tasks', { workspaceId: WORKSPACE_ID });

      expect(response).toEqual({ success: true, data: tasks });
      expect(mocks.getWorkspaceTasks).toHaveBeenCalledWith(WORKSPACE_ID);
    });

    it('scopes task listing errors to the response', async () => {
      mocks.getWorkspaceTasks.mockRejectedValue(new Error('notes unavailable'));

      const response = await invoke('workspace:get-tasks', { workspaceId: WORKSPACE_ID });

      expect(response).toEqual({ success: false, error: 'Failed to get workspace tasks' });
    });

    it('rejects invalid payloads via schema validation', async () => {
      const response = await invoke('workspace:get-tasks', { workspaceId: 123 });

      expect(response?.success).not.toBe(true);
      expect(mocks.getWorkspaceTasks).not.toHaveBeenCalled();
    });
  });
});

