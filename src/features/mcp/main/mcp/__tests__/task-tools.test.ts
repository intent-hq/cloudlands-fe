/**
 * Tests for Task Management Tools
 * Verifies that task tools correctly use parentId hierarchy for subtasks
 * and handle task metadata properly
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  GetMyTaskTool,
  MarkAsTaskTool,
  CreatePrerequisiteTool,
  AssignAgentTool,
} from '../task-tools';
import type { ToolCall } from '../protocol';

describe('Task Management Tools', () => {
  let mockProtocolAdapter: any;
  const workspaceId = 'test-workspace-id';

  beforeEach(() => {
    vi.clearAllMocks();
    mockProtocolAdapter = {
      getNote: vi.fn(),
      listNotes: vi.fn(),
      markAsTask: vi.fn(),
      createPrerequisiteNote: vi.fn(),
      assignAgentToTask: vi.fn(),
    };
  });

  describe('GetMyTaskTool', () => {
    it('should return task info with parentId and subtasks', async () => {
      const tool = new GetMyTaskTool(mockProtocolAdapter, workspaceId);

      // Mock note with parentId (task orchestration uses parentId hierarchy)
      const mockNote = {
        id: 'task-note-1',
        title: 'Test Task',
        content: 'Task content',
        parentId: 'parent-task-1',
        metadata: {
          task: {
            status: 'in_progress',
            assignedAgentIds: ['agent-1'],
            acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
          },
        },
      };

      // Mock child tasks (subtasks)
      const mockChildTasks = [
        {
          id: 'subtask-1',
          title: 'Subtask One',
          parentId: 'task-note-1',
          metadata: { task: { status: 'complete' } },
        },
        {
          id: 'subtask-2',
          title: 'Subtask Two',
          parentId: 'task-note-1',
          metadata: { task: { status: 'not_started' } },
        },
      ];

      mockProtocolAdapter.getNote.mockResolvedValue({
        ok: true,
        data: mockNote,
      });
      mockProtocolAdapter.listNotes.mockResolvedValue([mockNote, ...mockChildTasks]);

      const call: ToolCall = {
        name: 'get_my_task',
        arguments: {
          taskNoteId: 'task-note-1',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect(result.content[0].type).toBe('text');
      const text = (result.content[0] as any).text;

      // Verify task content is shown
      expect(text).toContain('Task: Test Task');
      expect(text).toContain('Status: in_progress');
      expect(text).toContain('Task content');

      // Verify subtasks are shown
      expect(text).toContain('Subtasks (2)');
      expect(text).toContain('[complete] Subtask One');
      expect(text).toContain('[not_started] Subtask Two');

      // Verify metadata includes parentId and subtaskIds
      expect((result as any).metadata.parentId).toBe('parent-task-1');
      expect((result as any).metadata.subtaskIds).toEqual(['subtask-1', 'subtask-2']);
      expect((result as any).metadata.assignedAgents).toEqual(['agent-1']);
    });

    it('should handle task with no parent and no subtasks', async () => {
      const tool = new GetMyTaskTool(mockProtocolAdapter, workspaceId);

      const mockNote = {
        id: 'task-note-2',
        title: 'Root Task',
        content: 'Top-level task',
        // No parentId
        metadata: {
          task: {
            status: 'not_started',
          },
        },
      };

      mockProtocolAdapter.listNotes.mockResolvedValue([mockNote]);

      mockProtocolAdapter.getNote.mockResolvedValue({
        ok: true,
        data: mockNote,
      });

      const call: ToolCall = {
        name: 'get_my_task',
        arguments: {
          taskNoteId: 'task-note-2',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      const text = (result.content[0] as any).text;

      // Verify task info shown
      expect(text).toContain('Task: Root Task');
      expect(text).toContain('Status: not_started');

      // Should not show subtasks section when there are none
      expect(text).not.toContain('Subtasks');

      // Should have null parentId for root tasks and empty subtaskIds
      expect((result as any).metadata.parentId).toBeNull();
      expect((result as any).metadata.subtaskIds).toEqual([]);
    });

    it('should return error if note is not a task', async () => {
      const tool = new GetMyTaskTool(mockProtocolAdapter, workspaceId);

      const mockNote = {
        id: 'regular-note',
        title: 'Regular Note',
        content: 'Not a task',
        metadata: {
          // No task metadata
        },
      };

      mockProtocolAdapter.getNote.mockResolvedValue({
        ok: true,
        data: mockNote,
      });

      const call: ToolCall = {
        name: 'get_my_task',
        arguments: {
          taskNoteId: 'regular-note',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain('Note is not a task');
    });
  });

  describe('MarkAsTaskTool', () => {
    it('should successfully mark a note as a task', async () => {
      const tool = new MarkAsTaskTool(mockProtocolAdapter, workspaceId);

      mockProtocolAdapter.markAsTask.mockResolvedValue({
        ok: true,
        data: {
          id: 'note-1',
          metadata: {
            task: {
              status: 'not_started',
            },
          },
        },
      });

      const call: ToolCall = {
        name: 'mark_as_task',
        arguments: {
          noteId: 'note-1',
          status: 'not_started',
          acceptanceCriteria: '["Criterion 1", "Criterion 2"]',
          estimatedEffort: '2 hours',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect((result.content[0] as any).text).toContain(
        'Note marked as task with status: not_started',
      );

      // Verify the protocol adapter was called with correct parameters
      expect(mockProtocolAdapter.markAsTask).toHaveBeenCalledWith({
        workspaceId,
        noteId: 'note-1',
        taskMetadata: {
          status: 'not_started',
          acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
          estimatedEffort: '2 hours',
        },
      });
    });
  });

  describe('CreatePrerequisiteTool', () => {
    it('should create a prerequisite and link it as a dependency', async () => {
      const tool = new CreatePrerequisiteTool(mockProtocolAdapter, workspaceId);

      const mockPrereqNote = {
        id: 'prereq-note-1',
        title: 'Prerequisite Task',
        content: 'Must be completed first',
        metadata: {
          task: {
            status: 'not_started',
          },
        },
      };

      mockProtocolAdapter.createPrerequisiteNote.mockResolvedValue({
        ok: true,
        data: {
          prerequisiteNote: mockPrereqNote,
          dependentNote: {
            id: 'dependent-note-1',
            metadata: {
              dependencies: [
                {
                  noteId: 'prereq-note-1',
                  type: 'blocks',
                  createdAt: '2025-11-27T00:00:00.000Z',
                },
              ],
            },
          },
        },
      });

      const call: ToolCall = {
        name: 'create_prerequisite',
        arguments: {
          dependentNoteId: 'dependent-note-1',
          title: 'Prerequisite Task',
          content: 'Must be completed first',
          status: 'not_started',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      const text = (result.content[0] as any).text;
      expect(text).toContain('Created prerequisite task: Prerequisite Task');
      expect(text).toContain('Prerequisite ID: prereq-note-1');
      expect(text).toContain('dependent task is now blocked');

      // Verify metadata includes the prerequisite note ID
      expect((result as any).metadata.prerequisiteNoteId).toBe('prereq-note-1');
      expect((result as any).metadata.dependentNoteId).toBe('dependent-note-1');
    });
  });

  describe('AssignAgentTool', () => {
    const validAgentId = 'agent-b0a8044a-5eac-4b52-8456-15d3b784decb';

    it('should assign an agent to a task when agentId format is valid', async () => {
      const tool = new AssignAgentTool(mockProtocolAdapter, workspaceId);

      mockProtocolAdapter.assignAgentToTask.mockResolvedValue({
        ok: true,
        data: {
          id: 'task-note-1',
          metadata: {
            task: {
              assignedAgentIds: [validAgentId],
            },
          },
        },
      });

      const call: ToolCall = {
        name: 'assign_agent',
        arguments: {
          noteId: 'task-note-1',
          agentId: validAgentId,
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect((result.content[0] as any).text).toContain(`Agent ${validAgentId} assigned to task`);

      // Verify the protocol adapter was called correctly
      expect(mockProtocolAdapter.assignAgentToTask).toHaveBeenCalledWith({
        workspaceId,
        noteId: 'task-note-1',
        agentId: validAgentId,
      });
    });

    it('should reject invalid agentId format (placeholder names)', async () => {
      const tool = new AssignAgentTool(mockProtocolAdapter, workspaceId);

      const call: ToolCall = {
        name: 'assign_agent',
        arguments: {
          noteId: 'task-note-1',
          agentId: 'theme-toggle-agent', // Invalid format - not a UUID
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain('Invalid agentId format');
      expect((result.content[0] as any).text).toContain('theme-toggle-agent');
      expect((result.content[0] as any).text).toContain('create_agent with taskNoteId');

      // Should not call assignAgentToTask
      expect(mockProtocolAdapter.assignAgentToTask).not.toHaveBeenCalled();
    });

    it('should reject agentId without proper UUID format', async () => {
      const tool = new AssignAgentTool(mockProtocolAdapter, workspaceId);

      const call: ToolCall = {
        name: 'assign_agent',
        arguments: {
          noteId: 'task-note-1',
          agentId: 'agent-123', // Invalid - not a full UUID
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain('Invalid agentId format');

      // Should not call assignAgentToTask
      expect(mockProtocolAdapter.assignAgentToTask).not.toHaveBeenCalled();
    });
  });

  // Note: ```task blocks are automatically converted to Task Notes
  // when notes are updated via UpdateNoteTool
});
