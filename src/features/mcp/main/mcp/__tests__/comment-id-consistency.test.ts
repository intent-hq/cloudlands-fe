/**
 * Test that MCP comment creation uses consistent IDs between comments and anchors
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AddNoteCommentTool } from '../workspace-tools';

describe('MCP Comment ID Consistency', () => {
  let tool: AddNoteCommentTool;
  let mockWorkspaceManager: any;
  let capturedCommentData: any;
  let capturedNoteContent: string;

  beforeEach(() => {
    capturedCommentData = null;
    capturedNoteContent = '';

    mockWorkspaceManager = {
      getNote: vi.fn().mockResolvedValue({
        id: 'test-note',
        content: '# Test Note\n\nThis is a test document with some content to comment on.',
        updatedAt: new Date().toISOString(),
      }),
      updateNote: vi.fn().mockImplementation(async (params: any) => {
        capturedNoteContent = params.content;
        return { ok: true };
      }),
      addComment: vi.fn().mockImplementation(async (params: any) => {
        capturedCommentData = params;
        return {
          ok: true,
          data: {
            id: params.id || 'generated-uuid',
            ...params,
          },
        };
      }),
    };

    tool = new AddNoteCommentTool(mockWorkspaceManager, 'test-workspace');
  });

  it('should use anchor ID as comment ID', async () => {
    const result = await tool.execute({
      name: 'add_note_comment',
      arguments: {
        noteId: 'test-note',
        comment: 'This is a test comment',
        searchContext: 'This is a test document with some content',
        commentTarget: 'test document',
      },
    });

    // Check that the comment was created
    expect(capturedCommentData).toBeDefined();
    expect(capturedCommentData.id).toBeDefined();

    // Extract anchor IDs from the updated note content
    const anchorMatch = capturedNoteContent.match(/<!--anchor:([^:]+):start-->/);
    expect(anchorMatch).toBeDefined();
    const anchorId = anchorMatch![1];

    // The comment ID should match the anchor ID
    expect(capturedCommentData.id).toBe(anchorId);

    // The markId should also use the same ID
    expect(capturedCommentData.markId).toBe(`${anchorId}:start|${anchorId}:end`);
  });

  it('should create anchors with UUID format', async () => {
    const result = await tool.execute({
      name: 'add_note_comment',
      arguments: {
        noteId: 'test-note',
        comment: 'Another test comment',
        searchContext: 'some content to comment on',
        commentTarget: 'content',
      },
    });

    // Extract anchor ID from the updated note content
    const anchorMatch = capturedNoteContent.match(/<!--anchor:([^:]+):start-->/);
    expect(anchorMatch).toBeDefined();
    const anchorId = anchorMatch![1];

    // Should use UUID v4 format: 8-4-4-4-12 hex digits
    expect(anchorId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('should insert anchors correctly in markdown', async () => {
    const result = await tool.execute({
      name: 'add_note_comment',
      arguments: {
        noteId: 'test-note',
        comment: 'Comment on heading',
        searchContext: '# Test Note',
        commentTarget: 'Test Note',
      },
    });

    // The anchors should be inserted around "Test Note"
    expect(capturedNoteContent).toContain('<!--anchor:');
    expect(capturedNoteContent).toContain(':start-->Test Note<!--anchor:');
    expect(capturedNoteContent).toContain(':end-->');

    // Extract the anchor ID
    const startMatch = capturedNoteContent.match(/<!--anchor:([^:]+):start-->/);
    const endMatch = capturedNoteContent.match(/<!--anchor:([^:]+):end-->/);

    expect(startMatch).toBeDefined();
    expect(endMatch).toBeDefined();

    // Start and end should use the same ID
    expect(startMatch![1]).toBe(endMatch![1]);
  });

  it('should accept "session" comment type', async () => {
    const result = await tool.execute({
      name: 'add_note_comment',
      arguments: {
        noteId: 'test-note',
        comment: 'Agent session started for this section',
        searchContext: 'This is a test document with some content',
        commentTarget: 'test document',
        type: 'session',
      },
    });

    // Check that the comment was created with session type
    expect(capturedCommentData).toBeDefined();
    expect(capturedCommentData.type).toBe('session');
    expect(capturedCommentData.id).toBeDefined();

    // Verify anchors were still inserted correctly
    expect(capturedNoteContent).toContain('<!--anchor:');
    expect(capturedNoteContent).toContain(':start-->test document<!--anchor:');
    expect(capturedNoteContent).toContain(':end-->');
  });

  it('should accept all valid comment types', async () => {
    const validTypes = ['comment', 'suggestion', 'change-request', 'question', 'session'];

    for (const type of validTypes) {
      capturedCommentData = null;
      capturedNoteContent = '';

      const result = await tool.execute({
        name: 'add_note_comment',
        arguments: {
          noteId: 'test-note',
          comment: `Test ${type} comment`,
          searchContext: 'This is a test document with some content',
          commentTarget: 'content',
          type,
        },
      });

      // Each type should be accepted
      expect(capturedCommentData).toBeDefined();
      expect(capturedCommentData.type).toBe(type);
    }
  });
});
