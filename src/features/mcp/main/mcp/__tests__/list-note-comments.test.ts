/**
 * Tests for ListNoteCommentsTool thread-grouping and filtering
 * Verifies that comments are properly grouped into threads with correct metadata
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ListNoteCommentsTool } from '../workspace-tools';
import { ToolCall } from '../protocol';

describe('ListNoteCommentsTool', () => {
  let tool: ListNoteCommentsTool;
  let mockWorkspaceManager: any;
  const workspaceId = 'test-workspace';

  // Mock comments data
  const mockComments = [
    // Thread 1: User commented last (needs agent response)
    {
      id: 'cmt-1',
      noteId: 'spec',
      threadId: 'thread-1',
      parentId: undefined,
      author: 'Alice',
      authorType: 'user',
      type: 'question',
      content: 'How does authentication work?',
      status: 'open',
      createdAt: '2024-01-15T10:00:00Z',
      updatedAt: '2024-01-15T10:00:00Z',
      section: 'Authentication System',
      markId: 'cmt-1',
    },
    {
      id: 'cmt-2',
      noteId: 'spec',
      threadId: 'thread-1',
      parentId: 'cmt-1',
      author: 'Agent',
      authorType: 'agent',
      type: 'comment',
      content: 'We use OAuth 2.0...',
      status: 'open',
      createdAt: '2024-01-15T11:00:00Z',
      updatedAt: '2024-01-15T11:00:00Z',
      section: 'Authentication System',
      markId: 'cmt-1',
    },
    {
      id: 'cmt-3',
      noteId: 'spec',
      threadId: 'thread-1',
      parentId: 'cmt-2',
      author: 'Alice',
      authorType: 'user',
      type: 'comment',
      content: 'Thanks! What about refresh tokens?',
      status: 'open',
      createdAt: '2024-01-15T14:00:00Z',
      updatedAt: '2024-01-15T14:00:00Z',
      section: 'Authentication System',
      markId: 'cmt-1',
    },

    // Thread 2: Agent commented last (already handled)
    {
      id: 'cmt-4',
      noteId: 'spec',
      threadId: 'thread-2',
      parentId: undefined,
      author: 'Bob',
      authorType: 'user',
      type: 'suggestion',
      content: 'Consider using Redis for caching',
      status: 'open',
      createdAt: '2024-01-15T09:00:00Z',
      updatedAt: '2024-01-15T09:00:00Z',
      section: 'Caching Strategy',
      markId: 'cmt-4',
    },
    {
      id: 'cmt-5',
      noteId: 'spec',
      threadId: 'thread-2',
      parentId: 'cmt-4',
      author: 'Agent',
      authorType: 'agent',
      type: 'comment',
      content: "Good idea! I'll add that to the spec.",
      status: 'open',
      createdAt: '2024-01-15T12:00:00Z',
      updatedAt: '2024-01-15T12:00:00Z',
      section: 'Caching Strategy',
      markId: 'cmt-4',
    },

    // Thread 3: Resolved thread
    {
      id: 'cmt-6',
      noteId: 'spec',
      threadId: 'thread-3',
      parentId: undefined,
      author: 'Charlie',
      authorType: 'user',
      type: 'question',
      content: 'What database should we use?',
      status: 'resolved',
      createdAt: '2024-01-14T10:00:00Z',
      updatedAt: '2024-01-14T10:00:00Z',
      section: 'Database Selection',
      markId: 'cmt-6',
    },
    {
      id: 'cmt-7',
      noteId: 'spec',
      threadId: 'thread-3',
      parentId: 'cmt-6',
      author: 'Agent',
      authorType: 'agent',
      type: 'comment',
      content: 'PostgreSQL is recommended.',
      status: 'resolved',
      createdAt: '2024-01-14T11:00:00Z',
      updatedAt: '2024-01-14T11:00:00Z',
      section: 'Database Selection',
      markId: 'cmt-6',
    },

    // Thread 4: Old thread with user comment last
    {
      id: 'cmt-8',
      noteId: 'spec',
      threadId: 'thread-4',
      parentId: undefined,
      author: 'Dave',
      authorType: 'user',
      type: 'comment',
      content: 'Old comment from last week',
      status: 'open',
      createdAt: '2024-01-08T10:00:00Z',
      updatedAt: '2024-01-08T10:00:00Z',
      section: 'Old Section',
      markId: 'cmt-8',
    },
  ];

  beforeEach(() => {
    mockWorkspaceManager = {
      getNote: vi.fn().mockResolvedValue({ id: 'spec', title: 'Spec' }),
      listComments: vi.fn().mockResolvedValue({
        ok: true,
        data: mockComments,
      }),
    };

    tool = new ListNoteCommentsTool(mockWorkspaceManager, workspaceId);
  });

  describe('Thread Grouping', () => {
    it('should group comments by thread', async () => {
      const call: ToolCall = {
        name: 'list_note_comments',
        arguments: { noteId: 'spec' },
      };

      const result = await tool.execute(call);
      expect(result.isError).toBe(false);

      const textContent = result.content[0];
      expect(textContent.type).toBe('text');
      const response = JSON.parse((textContent as any).text);
      expect(response.threads).toHaveLength(4);
      expect(response.totalThreads).toBe(4);
      expect(response.totalComments).toBe(8);
    });

    it('should sort comments within threads chronologically', async () => {
      const call: ToolCall = {
        name: 'list_note_comments',
        arguments: { noteId: 'spec', includeComments: true },
      };

      const result = await tool.execute(call);
      const response = JSON.parse((result.content[0] as any).text);

      const thread1 = response.threads.find((t: any) => t.threadId === 'thread-1');
      expect(thread1.comments).toHaveLength(3);
      expect(thread1.comments[0].id).toBe('cmt-1'); // Root first
      expect(thread1.comments[1].id).toBe('cmt-2'); // Then replies in order
      expect(thread1.comments[2].id).toBe('cmt-3');
    });

    it('should sort threads by lastActivity (most recent first)', async () => {
      const call: ToolCall = {
        name: 'list_note_comments',
        arguments: { noteId: 'spec' },
      };

      const result = await tool.execute(call);
      const response = JSON.parse((result.content[0] as any).text);

      // Thread 1 has most recent activity (14:00)
      expect(response.threads[0].threadId).toBe('thread-1');
      // Thread 2 next (12:00)
      expect(response.threads[1].threadId).toBe('thread-2');
      // Thread 3 next (11:00 on 01-14)
      expect(response.threads[2].threadId).toBe('thread-3');
      // Thread 4 oldest (01-08)
      expect(response.threads[3].threadId).toBe('thread-4');
    });
  });

  describe('Thread Metadata', () => {
    it('should compute correct thread metadata', async () => {
      const call: ToolCall = {
        name: 'list_note_comments',
        arguments: { noteId: 'spec' },
      };

      const result = await tool.execute(call);
      const response = JSON.parse((result.content[0] as any).text);

      const thread1 = response.threads.find((t: any) => t.threadId === 'thread-1');
      expect(thread1).toMatchObject({
        threadId: 'thread-1',
        noteId: 'spec',
        targetedText: 'Authentication System',
        anchorId: 'cmt-1',
        status: 'open',
        createdAt: '2024-01-15T10:00:00Z',
        lastActivity: '2024-01-15T14:00:00Z', // Most recent comment
        latestCommentAuthor: 'Alice',
        latestCommentAuthorType: 'user',
        latestCommentAt: '2024-01-15T14:00:00Z',
        commentCount: 3,
      });
    });

    it("should compute thread status as 'open' if any comment is open", async () => {
      const call: ToolCall = {
        name: 'list_note_comments',
        arguments: { noteId: 'spec' },
      };

      const result = await tool.execute(call);
      const response = JSON.parse((result.content[0] as any).text);

      const thread1 = response.threads.find((t: any) => t.threadId === 'thread-1');
      expect(thread1.status).toBe('open');
    });

    it("should compute thread status as 'resolved' if all comments are resolved", async () => {
      const call: ToolCall = {
        name: 'list_note_comments',
        arguments: { noteId: 'spec' },
      };

      const result = await tool.execute(call);
      const response = JSON.parse((result.content[0] as any).text);

      const thread3 = response.threads.find((t: any) => t.threadId === 'thread-3');
      expect(thread3.status).toBe('resolved');
    });

    it('should track latest comment author info', async () => {
      const call: ToolCall = {
        name: 'list_note_comments',
        arguments: { noteId: 'spec' },
      };

      const result = await tool.execute(call);
      const response = JSON.parse((result.content[0] as any).text);

      const thread1 = response.threads.find((t: any) => t.threadId === 'thread-1');
      expect(thread1.latestCommentAuthor).toBe('Alice');
      expect(thread1.latestCommentAuthorType).toBe('user');

      const thread2 = response.threads.find((t: any) => t.threadId === 'thread-2');
      expect(thread2.latestCommentAuthor).toBe('Agent');
      expect(thread2.latestCommentAuthorType).toBe('agent');
    });
  });

  describe('includeComments Parameter', () => {
    it('should not include comments by default', async () => {
      const call: ToolCall = {
        name: 'list_note_comments',
        arguments: { noteId: 'spec' },
      };

      const result = await tool.execute(call);
      const response = JSON.parse((result.content[0] as any).text);

      expect(response.threads[0].comments).toBeUndefined();
    });

    it('should include comments when includeComments=true', async () => {
      const call: ToolCall = {
        name: 'list_note_comments',
        arguments: { noteId: 'spec', includeComments: true },
      };

      const result = await tool.execute(call);
      const response = JSON.parse((result.content[0] as any).text);

      const thread1 = response.threads.find((t: any) => t.threadId === 'thread-1');
      expect(thread1.comments).toBeDefined();
      expect(thread1.comments).toHaveLength(3);
    });
  });

  describe('Filtering', () => {
    it("should filter by 'since' on lastActivity", async () => {
      const call: ToolCall = {
        name: 'list_note_comments',
        arguments: {
          noteId: 'spec',
          since: '2024-01-15T10:00:00Z',
        },
      };

      const result = await tool.execute(call);
      const response = JSON.parse((result.content[0] as any).text);

      // Should include threads 1 and 2 (activity after 10:00)
      // Should exclude thread 3 (last activity 11:00 on 01-14)
      // Should exclude thread 4 (last activity on 01-08)
      expect(response.threads).toHaveLength(2);
      expect(response.threads.some((t: any) => t.threadId === 'thread-1')).toBe(true);
      expect(response.threads.some((t: any) => t.threadId === 'thread-2')).toBe(true);
    });

    it("should filter by authorType='user' (threads where user commented last)", async () => {
      const call: ToolCall = {
        name: 'list_note_comments',
        arguments: {
          noteId: 'spec',
          authorType: 'user',
        },
      };

      const result = await tool.execute(call);
      const response = JSON.parse((result.content[0] as any).text);

      // Should include threads 1 and 4 (user commented last)
      // Should exclude thread 2 (agent commented last)
      // Should exclude thread 3 (agent commented last, even though resolved)
      expect(response.threads).toHaveLength(2);
      expect(response.threads.some((t: any) => t.threadId === 'thread-1')).toBe(true);
      expect(response.threads.some((t: any) => t.threadId === 'thread-4')).toBe(true);
    });

    it("should filter by authorType='agent' (threads where agent commented last)", async () => {
      const call: ToolCall = {
        name: 'list_note_comments',
        arguments: {
          noteId: 'spec',
          authorType: 'agent',
        },
      };

      const result = await tool.execute(call);
      const response = JSON.parse((result.content[0] as any).text);

      // Should include threads 2 and 3 (agent commented last)
      expect(response.threads).toHaveLength(2);
      expect(response.threads.some((t: any) => t.threadId === 'thread-2')).toBe(true);
      expect(response.threads.some((t: any) => t.threadId === 'thread-3')).toBe(true);
    });

    it("should filter by status='open'", async () => {
      const call: ToolCall = {
        name: 'list_note_comments',
        arguments: {
          noteId: 'spec',
          status: 'open',
        },
      };

      const result = await tool.execute(call);
      const response = JSON.parse((result.content[0] as any).text);

      // Should include threads 1, 2, 4 (open)
      // Should exclude thread 3 (resolved)
      expect(response.threads).toHaveLength(3);
      expect(response.threads.some((t: any) => t.threadId === 'thread-3')).toBe(false);
    });

    it("should filter by status='resolved'", async () => {
      const call: ToolCall = {
        name: 'list_note_comments',
        arguments: {
          noteId: 'spec',
          status: 'resolved',
        },
      };

      const result = await tool.execute(call);
      const response = JSON.parse((result.content[0] as any).text);

      // Should only include thread 3
      expect(response.threads).toHaveLength(1);
      expect(response.threads[0].threadId).toBe('thread-3');
    });

    it('should combine multiple filters (perfect agent workflow)', async () => {
      const call: ToolCall = {
        name: 'list_note_comments',
        arguments: {
          noteId: 'spec',
          since: '2024-01-15T10:00:00Z',
          authorType: 'user',
          status: 'open',
          includeComments: true,
        },
      };

      const result = await tool.execute(call);
      const response = JSON.parse((result.content[0] as any).text);

      // Should only include thread 1:
      // - Has activity after 10:00 (14:00)
      // - User commented last
      // - Status is open
      expect(response.threads).toHaveLength(1);
      expect(response.threads[0].threadId).toBe('thread-1');
      expect(response.threads[0].comments).toBeDefined();
      expect(response.threads[0].comments).toHaveLength(3);
    });
  });

  describe('Error Handling', () => {
    it('should return error if noteId is missing', async () => {
      const call: ToolCall = {
        name: 'list_note_comments',
        arguments: {},
      };

      const result = await tool.execute(call);
      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain('Note ID is required');
    });

    it('should return error if note does not exist', async () => {
      mockWorkspaceManager.getNote.mockResolvedValue(null);

      const call: ToolCall = {
        name: 'list_note_comments',
        arguments: { noteId: 'nonexistent' },
      };

      const result = await tool.execute(call);
      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain('Note not found');
    });

    it("should return error for invalid 'since' timestamp", async () => {
      const call: ToolCall = {
        name: 'list_note_comments',
        arguments: {
          noteId: 'spec',
          since: 'invalid-date',
        },
      };

      const result = await tool.execute(call);
      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain("Invalid 'since' timestamp");
    });

    it('should return error for invalid authorType', async () => {
      const call: ToolCall = {
        name: 'list_note_comments',
        arguments: {
          noteId: 'spec',
          authorType: 'invalid',
        },
      };

      const result = await tool.execute(call);
      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain("Invalid 'authorType'");
    });

    it('should return error for invalid status', async () => {
      const call: ToolCall = {
        name: 'list_note_comments',
        arguments: {
          noteId: 'spec',
          status: 'invalid',
        },
      };

      const result = await tool.execute(call);
      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain("Invalid 'status'");
    });

    it('should return empty threads array when no comments exist', async () => {
      mockWorkspaceManager.listComments.mockResolvedValue({
        ok: true,
        data: [],
      });

      const call: ToolCall = {
        name: 'list_note_comments',
        arguments: { noteId: 'spec' },
      };

      const result = await tool.execute(call);
      expect(result.isError).toBe(false);

      const response = JSON.parse((result.content[0] as any).text);
      expect(response.threads).toEqual([]);
      expect(response.totalThreads).toBe(0);
      expect(response.totalComments).toBe(0);
    });
  });
});
