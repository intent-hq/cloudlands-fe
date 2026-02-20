/**
 * Tests for Cross-Workspace Tools
 * Verifies that agents can discover and access notes from sibling workspaces
 * (workspaces that share the same repository path)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { ToolCall } from '../protocol';
import type { Workspace } from '../../../../../shared/types';
import type { WorkspaceId } from '../../../../../shared/types/branded-ids';
import {
  ListSiblingWorkspacesTool,
  ReadExternalNoteTool,
  ListExternalNotesTool,
  setWorkspaceRepository,
} from '../cross-workspace-tools';

describe('Cross-Workspace Tools', () => {
  const currentWorkspaceId = 'workspace-current';
  const siblingWorkspaceId = 'workspace-sibling';
  const unrelatedWorkspaceId = 'workspace-unrelated';
  const sharedRepoPath = '/path/to/shared/repo';

  const currentWorkspace: Workspace = {
    id: currentWorkspaceId as WorkspaceId,
    title: 'Current Workspace',
    branch: 'feature-current',
    status: 'active' as any,
    repositoryPath: sharedRepoPath,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    changesets: [],
    timeline: [],
    conversationInfo: [],
  };

  const siblingWorkspace: Workspace = {
    id: siblingWorkspaceId as WorkspaceId,
    title: 'Sibling Workspace',
    branch: 'feature-sibling',
    status: 'active' as any,
    repositoryPath: sharedRepoPath,
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    changesets: [],
    timeline: [],
    conversationInfo: [],
  };

  const unrelatedWorkspace: Workspace = {
    id: unrelatedWorkspaceId as WorkspaceId,
    title: 'Unrelated Workspace',
    branch: 'main',
    status: 'active' as any,
    repositoryPath: '/path/to/different/repo',
    createdAt: '2024-01-03T00:00:00Z',
    updatedAt: '2024-01-03T00:00:00Z',
    changesets: [],
    timeline: [],
    conversationInfo: [],
  };

  let mockWorkspaceManager: any;

  // Mock repository functions
  const mockFindById = vi.fn();
  const mockFindAll = vi.fn();
  const mockRepository = {
    findById: mockFindById,
    findAll: mockFindAll,
    save: vi.fn(),
    delete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Set the mock repository
    setWorkspaceRepository(mockRepository);

    mockWorkspaceManager = {
      getNote: vi.fn(),
      listNotes: vi.fn(),
    };

    // Default mock implementations
    mockFindById.mockImplementation(async (id: string) => {
      if (id === currentWorkspaceId) return currentWorkspace;
      if (id === siblingWorkspaceId) return siblingWorkspace;
      if (id === unrelatedWorkspaceId) return unrelatedWorkspace;
      return null;
    });

    mockFindAll.mockResolvedValue([currentWorkspace, siblingWorkspace, unrelatedWorkspace]);
  });

  afterEach(() => {
    // Reset the repository to null after each test
    setWorkspaceRepository(null);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('ListSiblingWorkspacesTool', () => {
    it('should list workspaces with the same repository path', async () => {
      const tool = new ListSiblingWorkspacesTool(currentWorkspaceId);

      const call: ToolCall = {
        name: 'list_sibling_workspaces',
        arguments: {},
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect((result.content[0] as any).text).toContain('Found 1 sibling workspace');
      expect((result.content[0] as any).text).toContain('Sibling Workspace');
      expect((result.content[0] as any).text).not.toContain('Unrelated Workspace');
    });

    it('should return empty list when no siblings exist', async () => {
      mockFindAll.mockResolvedValue([currentWorkspace, unrelatedWorkspace]);

      const tool = new ListSiblingWorkspacesTool(currentWorkspaceId);

      const call: ToolCall = {
        name: 'list_sibling_workspaces',
        arguments: {},
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect((result.content[0] as any).text).toContain('No sibling workspaces found');
    });

    it('should return error if current workspace not found', async () => {
      mockFindById.mockResolvedValue(null);

      const tool = new ListSiblingWorkspacesTool('non-existent');

      const call: ToolCall = {
        name: 'list_sibling_workspaces',
        arguments: {},
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain('Current workspace not found');
    });

    it('should return error if workspace has no repository path', async () => {
      const noRepoWorkspace = { ...currentWorkspace, repositoryPath: undefined };
      mockFindById.mockResolvedValue(noRepoWorkspace);

      const tool = new ListSiblingWorkspacesTool(currentWorkspaceId);

      const call: ToolCall = {
        name: 'list_sibling_workspaces',
        arguments: {},
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain('not associated with a repository');
    });
  });

  describe('ReadExternalNoteTool', () => {
    const mockNote = {
      id: 'note-1',
      title: 'Test Note',
      content: 'Line 1\nLine 2\nLine 3',
    };

    it('should read a note from a sibling workspace', async () => {
      mockWorkspaceManager.getNote.mockResolvedValue(mockNote);

      const tool = new ReadExternalNoteTool(mockWorkspaceManager, currentWorkspaceId);

      const call: ToolCall = {
        name: 'read_external_note',
        arguments: {
          targetWorkspaceId: siblingWorkspaceId,
          noteId: 'note-1',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect((result.content[0] as any).text).toContain('Test Note');
      expect((result.content[0] as any).text).toContain('From workspace:');
      expect(mockWorkspaceManager.getNote).toHaveBeenCalledWith(siblingWorkspaceId, 'note-1');
    });

    it('should deny access to notes from unrelated workspaces', async () => {
      const tool = new ReadExternalNoteTool(mockWorkspaceManager, currentWorkspaceId);

      const call: ToolCall = {
        name: 'read_external_note',
        arguments: {
          targetWorkspaceId: unrelatedWorkspaceId,
          noteId: 'note-1',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain('Access denied');
      expect(mockWorkspaceManager.getNote).not.toHaveBeenCalled();
    });

    it('should return error if note not found', async () => {
      mockWorkspaceManager.getNote.mockResolvedValue(null);

      const tool = new ReadExternalNoteTool(mockWorkspaceManager, currentWorkspaceId);

      const call: ToolCall = {
        name: 'read_external_note',
        arguments: {
          targetWorkspaceId: siblingWorkspaceId,
          noteId: 'non-existent',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain('Note not found');
    });

    it('should require both targetWorkspaceId and noteId', async () => {
      const tool = new ReadExternalNoteTool(mockWorkspaceManager, currentWorkspaceId);

      const call: ToolCall = {
        name: 'read_external_note',
        arguments: {
          targetWorkspaceId: siblingWorkspaceId,
          // noteId missing
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain('required');
    });
  });

  describe('ListExternalNotesTool', () => {
    const mockNotes = [
      { id: 'note-1', title: 'First Note' },
      { id: 'note-2', title: 'Second Note' },
    ];

    it('should list notes from a sibling workspace', async () => {
      mockWorkspaceManager.listNotes.mockResolvedValue(mockNotes);

      const tool = new ListExternalNotesTool(mockWorkspaceManager, currentWorkspaceId);

      const call: ToolCall = {
        name: 'list_external_notes',
        arguments: {
          targetWorkspaceId: siblingWorkspaceId,
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect((result.content[0] as any).text).toContain('First Note');
      expect((result.content[0] as any).text).toContain('Second Note');
      expect(mockWorkspaceManager.listNotes).toHaveBeenCalledWith(siblingWorkspaceId);
    });

    it('should deny listing notes from unrelated workspaces', async () => {
      const tool = new ListExternalNotesTool(mockWorkspaceManager, currentWorkspaceId);

      const call: ToolCall = {
        name: 'list_external_notes',
        arguments: {
          targetWorkspaceId: unrelatedWorkspaceId,
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain('Access denied');
      expect(mockWorkspaceManager.listNotes).not.toHaveBeenCalled();
    });

    it('should handle empty notes list', async () => {
      mockWorkspaceManager.listNotes.mockResolvedValue([]);

      const tool = new ListExternalNotesTool(mockWorkspaceManager, currentWorkspaceId);

      const call: ToolCall = {
        name: 'list_external_notes',
        arguments: {
          targetWorkspaceId: siblingWorkspaceId,
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect((result.content[0] as any).text).toContain('No notes found');
    });
  });
});
