import {
  describe,
  expect,
  it,
  vi,
  beforeEach,
} from 'vitest';

import { WorkspaceJsApiTool } from '../workspace-js-api-tool';

// Mock IPC to avoid electron dependency
vi.mock('../../../../system/main/system.ipc', () => ({
  sendToWorkspaceWindows: vi.fn(),
}));

// Mock provenance context manager
vi.mock('$features/workspace/main/provenance/provenance-context-manager', () => ({
  getProvenanceContextManager: () => ({
    getCurrentContext: () => null,
    createAgentContext: () => 'ctx-1',
    popContext: vi.fn(),
  }),
}));

// Mock notes service (used by convertBlocks path)
vi.mock('../../../../notes/main/notes.service', () => ({
  notesService: {
    convertTaskBlocks: vi.fn().mockResolvedValue({ ok: true, data: { convertedCount: 0, createdNoteIds: [] } }),
  },
}));

// Mock task-block-parser
vi.mock('../../../../notes/utils/task-block-parser', () => ({
  hasTaskBlocks: vi.fn().mockReturnValue(false),
}));

// Mock analytics
vi.mock('$lib/services/analytics/main', () => ({
  trackMain: vi.fn(),
}));

describe('ws.task API', () => {
  const workspaceId = 'test-workspace';
  const workspacePath = '/tmp/test-workspace';

  let mockManager: any;

  const exec = async (code: string) => {
    const tool = new WorkspaceJsApiTool(workspacePath, workspaceId, mockManager);
    const result = await tool.execute({
      name: 'workspace_api',
      arguments: { code },
      context: {},
    } as any);
    const text = (result.content[0] as any).text;
    return { ...result, text, json: () => JSON.parse(text) };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockManager = {
      getNote: vi.fn(),
      listNotes: vi.fn().mockResolvedValue([]),
      updateNote: vi.fn(),
      markAsTask: vi.fn(),
      createPrerequisiteNote: vi.fn(),
      assignAgentToTask: vi.fn(),
      convertTaskBlocks: vi.fn(),
      updateTaskStatus: vi.fn(),
      getWorkspace: vi.fn().mockResolvedValue(null),
    };
  });

  describe('getMyTask', () => {
    it('returns task info with parentId, subtasks, acceptance criteria, assigned agents', async () => {
      mockManager.getNote.mockResolvedValue({
        ok: true,
        data: {
          id: 'task-1',
          title: 'My Task',
          content: 'Do the thing',
          parentId: 'parent-1',
          metadata: {
            task: {
              status: 'in_progress',
              acceptanceCriteria: ['criterion 1', 'criterion 2'],
              assignedAgentIds: ['agent-abc-1234'],
            },
          },
        },
      });
      mockManager.listNotes.mockResolvedValue([
        {
          id: 'subtask-1',
          title: 'Subtask One',
          parentId: 'task-1',
          metadata: { task: { status: 'not_started' } },
        },
      ]);

      const r = await exec('return await ws.task.getMyTask("task-1")');
      expect(r.isError).toBe(false);
      const data = r.json();
      expect(data.noteId).toBe('task-1');
      expect(data.title).toBe('My Task');
      expect(data.status).toBe('in_progress');
      expect(data.parentId).toBe('parent-1');
      expect(data.subtasks).toHaveLength(1);
      expect(data.subtasks[0].id).toBe('subtask-1');
      expect(data.assignedAgents).toContain('agent-abc-1234');
    });

    it('handles task with no parent and no subtasks', async () => {
      mockManager.getNote.mockResolvedValue({
        ok: true,
        data: {
          id: 'task-2',
          title: 'Standalone Task',
          content: '',
          metadata: {
            task: { status: 'not_started', assignedAgentIds: [] },
          },
        },
      });
      mockManager.listNotes.mockResolvedValue([]);

      const r = await exec('return await ws.task.getMyTask("task-2")');
      expect(r.isError).toBe(false);
      const data = r.json();
      expect(data.parentId).toBeNull();
      expect(data.subtasks).toHaveLength(0);
    });

    it('returns error if note is not a task', async () => {
      mockManager.getNote.mockResolvedValue({
        ok: true,
        data: {
          id: 'note-1',
          title: 'Regular Note',
          content: 'Just a note',
          metadata: {},
        },
      });

      const r = await exec('return await ws.task.getMyTask("note-1")');
      expect(r.isError).toBe(true);
      expect(r.text).toContain('not a task');
    });
  });

  describe('markAsTask', () => {
    it('marks a note as task with status, acceptance criteria, and effort', async () => {
      mockManager.markAsTask.mockResolvedValue({ ok: true });

      const r = await exec(
        'return await ws.task.markAsTask("note-1", "not_started", { acceptanceCriteria: ["tests pass", "no lint errors"], effort: "medium" })',
      );
      expect(r.isError).toBe(false);
      const data = r.json();
      expect(data.ok).toBe(true);
      expect(data.noteId).toBe('note-1');

      expect(mockManager.markAsTask).toHaveBeenCalledWith({
        workspaceId,
        noteId: 'note-1',
        taskMetadata: {
          status: 'not_started',
          acceptanceCriteria: ['tests pass', 'no lint errors'],
          estimatedEffort: 'medium',
        },
      });
    });
  });

  describe('createPrerequisite', () => {
    it('creates prerequisite and links dependency', async () => {
      mockManager.createPrerequisiteNote.mockResolvedValue({
        ok: true,
        data: {
          prerequisiteNote: {
            id: 'prereq-1',
            title: 'Setup DB',
          },
        },
      });

      const r = await exec(
        'return await ws.task.createPrerequisite("task-1", "Setup DB", { content: "Run migrations", status: "not_started" })',
      );
      expect(r.isError).toBe(false);
      const data = r.json();
      expect(data.ok).toBe(true);
      expect(data.prerequisiteNoteId).toBe('prereq-1');
      expect(data.dependentNoteId).toBe('task-1');
      expect(data.title).toBe('Setup DB');

      expect(mockManager.createPrerequisiteNote).toHaveBeenCalledWith({
        workspaceId,
        dependentNoteId: 'task-1',
        prerequisite: {
          title: 'Setup DB',
          content: 'Run migrations',
          taskMetadata: { status: 'not_started' },
        },
      });
    });
  });

  describe('assignAgent', () => {
    it('assigns agent with valid UUID format', async () => {
      mockManager.assignAgentToTask.mockResolvedValue({ ok: true });

      const r = await exec(
        'return await ws.task.assignAgent("task-1", "agent-b0a8044a-5eac-4b52-8456-15d3b784decb")',
      );
      expect(r.isError).toBe(false);
      const data = r.json();
      expect(data.ok).toBe(true);
      expect(data.noteId).toBe('task-1');
      expect(data.agentId).toBe('agent-b0a8044a-5eac-4b52-8456-15d3b784decb');
    });

    it('rejects placeholder agent names like theme-toggle-agent', async () => {
      const r = await exec(
        'return await ws.task.assignAgent("task-1", "theme-toggle-agent")',
      );
      expect(r.isError).toBe(true);
      expect(r.text).toContain('Invalid agentId format');
      expect(r.text).toContain('theme-toggle-agent');
      expect(mockManager.assignAgentToTask).not.toHaveBeenCalled();
    });

    it('rejects agent IDs without proper UUID format', async () => {
      const r = await exec(
        'return await ws.task.assignAgent("task-1", "agent-not-a-uuid")',
      );
      expect(r.isError).toBe(true);
      expect(r.text).toContain('Invalid agentId format');
      expect(mockManager.assignAgentToTask).not.toHaveBeenCalled();
    });
  });
});

