import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  getWorkspaceTasks: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      mocks.handlers.set(channel, handler);
    }),
  },
}));

vi.mock('../workspace-summaries', () => ({
  getWorkspaceTasks: mocks.getWorkspaceTasks,
}));

import { setupWorkspaceSummaryIPC } from '../workspace-summary.ipc';

const WORKSPACE_ID = 'amber-forest';

const invoke = (channel: string, payload: unknown) => {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return handler({}, payload);
};

describe('setupWorkspaceSummaryIPC', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.getWorkspaceTasks.mockReset();
    setupWorkspaceSummaryIPC();
  });

  it('registers only the task channel (diff/git summaries are served by the renderer seeder)', () => {
    expect([...mocks.handlers.keys()]).toEqual(['workspace:get-tasks']);
  });

  describe('workspace:get-tasks', () => {
    it('returns the canonical task list', async () => {
      const tasks = [
        {
          id: 'task-1',
          title: 'Do thing',
          status: 'in_progress',
          updatedAt: '2026-06-09T00:00:00.000Z',
        },
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
