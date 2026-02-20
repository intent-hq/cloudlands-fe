/**
 * Tests for DeleteNoteCommentTool
 * Verifies that agents can delete comments from notes via MCP
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeleteNoteCommentTool } from '../workspace-comment-thread-tools';
import type { ToolCall } from '../protocol';

// Mock electron BrowserWindow
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

// Mock provenance context manager
vi.mock('$features/workspace/main/provenance/provenance-context-manager', () => ({
  getProvenanceContextManager: vi.fn(() => ({
    getCurrentContext: vi.fn(() => null),
    createAgentContext: vi.fn(() => 'mock-context-id'),
    popContext: vi.fn(),
  })),
}));

describe('DeleteNoteCommentTool', () => {
  let mockWorkspaceManager: any;
  const workspaceId = 'test-workspace-id';

  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceManager = {
      deleteComment: vi.fn(),
    };
  });

  it('should successfully delete a comment', async () => {
    const tool = new DeleteNoteCommentTool(mockWorkspaceManager, workspaceId);

    mockWorkspaceManager.deleteComment.mockResolvedValue({
      ok: true,
      data: undefined,
    });

    const call: ToolCall = {
      name: 'delete_note_comment',
      arguments: {
        noteId: 'spec',
        commentId: 'comment-123',
      },
    };

    const result = await tool.execute(call);

    expect(result.isError).toBe(false);
    const text = (result.content[0] as any).text;
    const parsed = JSON.parse(text);
    expect(parsed.success).toBe(true);
    expect(parsed.message).toContain('comment-123');
    expect(parsed.message).toContain('spec');

    expect(mockWorkspaceManager.deleteComment).toHaveBeenCalledWith({
      workspaceId,
      noteId: 'spec',
      commentId: 'comment-123',
    });
  });

  it('should return error when noteId is missing', async () => {
    const tool = new DeleteNoteCommentTool(mockWorkspaceManager, workspaceId);

    const call: ToolCall = {
      name: 'delete_note_comment',
      arguments: {
        commentId: 'comment-123',
      },
    };

    const result = await tool.execute(call);

    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('Note ID is required');
    expect(mockWorkspaceManager.deleteComment).not.toHaveBeenCalled();
  });

  it('should return error when commentId is missing', async () => {
    const tool = new DeleteNoteCommentTool(mockWorkspaceManager, workspaceId);

    const call: ToolCall = {
      name: 'delete_note_comment',
      arguments: {
        noteId: 'spec',
      },
    };

    const result = await tool.execute(call);

    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('Comment ID is required');
    expect(mockWorkspaceManager.deleteComment).not.toHaveBeenCalled();
  });

  it('should return error when deleteComment fails with error result', async () => {
    const tool = new DeleteNoteCommentTool(mockWorkspaceManager, workspaceId);

    mockWorkspaceManager.deleteComment.mockResolvedValue({
      ok: false,
      error: 'Comment not found',
    });

    const call: ToolCall = {
      name: 'delete_note_comment',
      arguments: {
        noteId: 'spec',
        commentId: 'nonexistent-comment',
      },
    };

    const result = await tool.execute(call);

    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('Comment not found');
  });

  it('should return error when deleteComment throws an exception', async () => {
    const tool = new DeleteNoteCommentTool(mockWorkspaceManager, workspaceId);

    mockWorkspaceManager.deleteComment.mockRejectedValue(
      new Error('Database connection failed'),
    );

    const call: ToolCall = {
      name: 'delete_note_comment',
      arguments: {
        noteId: 'spec',
        commentId: 'comment-123',
      },
    };

    const result = await tool.execute(call);

    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('Database connection failed');
  });

  it('should handle null/undefined result from deleteComment gracefully', async () => {
    const tool = new DeleteNoteCommentTool(mockWorkspaceManager, workspaceId);

    mockWorkspaceManager.deleteComment.mockResolvedValue(null);

    const call: ToolCall = {
      name: 'delete_note_comment',
      arguments: {
        noteId: 'spec',
        commentId: 'comment-123',
      },
    };

    const result = await tool.execute(call);

    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('Failed to delete comment');
  });
});
