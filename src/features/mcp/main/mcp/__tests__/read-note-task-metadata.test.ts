/**
 * Tests for ReadNoteTool with Task Metadata
 * Verifies that ReadNoteTool correctly displays task metadata including dependencies
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock provenance manager
const mockProvenanceManager = vi.hoisted(() => ({
  getProvenanceContextManager: vi.fn(() => ({
    getCurrentContext: vi.fn(() => null),
    createAgentContext: vi.fn(() => 'mock-context-id'),
    clearContext: vi.fn(),
    popContext: vi.fn(),
  })),
}));

vi.mock(
  '$features/workspace/main/provenance/provenance-context-manager',
  () => mockProvenanceManager,
);

import { ReadNoteTool } from '../workspace-tools';
import type { ToolCall } from '../protocol';

describe('ReadNoteTool - Task Metadata', () => {
  let mockWorkspaceManager: any;
  const workspaceId = 'test-workspace-id';

  beforeEach(() => {
    mockWorkspaceManager = {
      getNote: vi.fn(),
    };
  });

  it('should display task metadata section with status and acceptance criteria', async () => {
    const tool = new ReadNoteTool(mockWorkspaceManager, workspaceId);

    // Note: Task orchestration now uses parentId hierarchy for subtasks.
    // No separate dependency tracking in metadata.
    const mockTaskNote = {
      id: 'task-note-1',
      title: 'Implement Authentication',
      content: 'Add JWT-based authentication to the API',
      parentId: 'parent-task-1',
      metadata: {
        task: {
          status: 'in_progress',
          assignedAgentIds: ['agent-1'],
          acceptanceCriteria: ['JWT tokens generated', 'Tokens validated on routes'],
          estimatedEffort: '4 hours',
        },
      },
    };

    mockWorkspaceManager.getNote.mockResolvedValue(mockTaskNote);

    const call: ToolCall = {
      name: 'read_note',
      arguments: {
        noteId: 'task-note-1',
      },
    };

    const result = await tool.execute(call);

    expect(result.isError).toBe(false);
    const text = (result.content[0] as any).text;

    // Verify task metadata section is present
    expect(text).toContain('--- Task Metadata ---');
    expect(text).toContain('Status: in_progress');

    // Verify acceptance criteria
    expect(text).toContain('Acceptance Criteria:');
    expect(text).toContain('- JWT tokens generated');
    expect(text).toContain('- Tokens validated on routes');

    // Verify assigned agents
    expect(text).toContain('Assigned Agents: agent-1');

    // Verify estimated effort
    expect(text).toContain('Estimated Effort: 4 hours');

    // Verify metadata includes task info
    expect((result as any).metadata.isTask).toBe(true);
    expect((result as any).metadata.taskStatus).toBe('in_progress');
    expect((result as any).metadata.taskMetadata).toBeDefined();
  });

  it('should handle task note with no dependencies', async () => {
    const tool = new ReadNoteTool(mockWorkspaceManager, workspaceId);

    const mockTaskNote = {
      id: 'task-note-2',
      title: 'Independent Task',
      content: 'This task has no dependencies',
      metadata: {
        task: {
          status: 'not_started',
        },
        // No dependencies array
      },
    };

    mockWorkspaceManager.getNote.mockResolvedValue(mockTaskNote);

    const call: ToolCall = {
      name: 'read_note',
      arguments: {
        noteId: 'task-note-2',
      },
    };

    const result = await tool.execute(call);

    expect(result.isError).toBe(false);
    const text = (result.content[0] as any).text;

    // Should show task metadata section
    expect(text).toContain('--- Task Metadata ---');
    expect(text).toContain('Status: not_started');

    // Should NOT show dependencies section
    expect(text).not.toContain('Dependencies (');
  });

  it('should not show task metadata section for regular notes', async () => {
    const tool = new ReadNoteTool(mockWorkspaceManager, workspaceId);

    const mockRegularNote = {
      id: 'regular-note',
      title: 'Regular Note',
      content: 'This is not a task',
      metadata: {
        // No task metadata
      },
    };

    mockWorkspaceManager.getNote.mockResolvedValue(mockRegularNote);

    const call: ToolCall = {
      name: 'read_note',
      arguments: {
        noteId: 'regular-note',
      },
    };

    const result = await tool.execute(call);

    expect(result.isError).toBe(false);
    const text = (result.content[0] as any).text;

    // Should NOT show task metadata section
    expect(text).not.toContain('--- Task Metadata ---');
    expect((result as any).metadata.isTask).toBeUndefined();
  });
});
