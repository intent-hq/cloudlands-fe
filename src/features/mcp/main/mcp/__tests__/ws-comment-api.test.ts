import {
  describe,
  expect,
  it,
  vi,
  beforeEach,
} from 'vitest';

import { WorkspaceJsApiTool } from '../workspace-js-api-tool';

// --- helpers ----------------------------------------------------------------

const workspaceId = 'ws-comment-test';
const workspacePath = '/tmp/ws-comment-test';

function makeMockManager(overrides: Record<string, any> = {}) {
  return {
    getNote: vi.fn().mockResolvedValue({
      id: 'note-1',
      title: 'Test Note',
      content: 'Hello world, this is a test note with some content.',
      tags: ['test'],
    }),
    updateNote: vi.fn().mockResolvedValue({ ok: true }),
    addComment: vi.fn().mockResolvedValue({
      ok: true,
      data: { id: 'comment-1', content: 'Nice work', author: 'Agent' },
    }),
    listComments: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    deleteComment: vi.fn().mockResolvedValue({ ok: true }),
    getWorkspace: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function exec(tool: WorkspaceJsApiTool, code: string) {
  return tool.execute({
    name: 'workspace_api',
    arguments: { code },
    context: {},
  } as any);
}

function text(result: any): string {
  return (result.content[0] as any).text;
}

// --- tests ------------------------------------------------------------------

describe('ws.comment API', () => {
  let manager: ReturnType<typeof makeMockManager>;
  let tool: WorkspaceJsApiTool;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = makeMockManager();
    tool = new WorkspaceJsApiTool(workspacePath, workspaceId, manager);
  });

  // ── comment.add ──────────────────────────────────────────────────────────

  describe('comment.add', () => {
    it('creates a comment anchored to the target text', async () => {
      const result = await exec(
        tool,
        `return await ws.comment.add("note-1", {
          searchContext: "this is a test note",
          commentTarget: "test note",
          comment: "Good section"
        })`,
      );

      expect(result.isError).toBe(false);
      const out = JSON.parse(text(result));
      expect(out.success).toBe(true);
      expect(out.anchored).toBe(true);
      expect(out.commentId).toBeDefined();
      expect(out.location.anchoredText).toBe('test note');

      // Verify updateNote was called with anchor tags in content
      expect(manager.updateNote).toHaveBeenCalledTimes(1);
      const updateCall = manager.updateNote.mock.calls[0][0];
      expect(updateCall.content).toContain('<!--anchor:');
      expect(updateCall.content).toContain(':start-->test note<!--anchor:');
      expect(updateCall.content).toContain(':end-->');

      // Verify addComment was called with matching markId
      expect(manager.addComment).toHaveBeenCalledTimes(1);
      const commentCall = manager.addComment.mock.calls[0][0];
      expect(commentCall.noteId).toBe('note-1');
      expect(commentCall.content).toBe('Good section');
      expect(commentCall.markId).toContain(':start|');
      expect(commentCall.markId).toContain(':end');
      expect(commentCall.section).toBe('test note');
    });

    it('anchor IDs in note content match the comment markId', async () => {
      await exec(
        tool,
        `return await ws.comment.add("note-1", {
          searchContext: "this is a test note",
          commentTarget: "test note",
          comment: "Check IDs"
        })`,
      );

      const updatedContent: string = manager.updateNote.mock.calls[0][0].content;
      const markId: string = manager.addComment.mock.calls[0][0].markId;

      // Extract anchor IDs from content
      const startMatch = updatedContent.match(/<!--anchor:([^:]+):start-->/);
      const endMatch = updatedContent.match(/<!--anchor:([^:]+):end-->/);
      expect(startMatch).not.toBeNull();
      expect(endMatch).not.toBeNull();

      // markId should reference those same IDs
      expect(markId).toBe(`${startMatch![1]}:start|${endMatch![1]}:end`);
    });

    it('accepts all valid comment types', async () => {
      const types = ['comment', 'suggestion', 'change-request', 'question'];

      for (const type of types) {
        manager = makeMockManager();
        tool = new WorkspaceJsApiTool(workspacePath, workspaceId, manager);

        const result = await exec(
          tool,
          `return await ws.comment.add("note-1", {
            searchContext: "this is a test note",
            commentTarget: "test note",
            comment: "typed comment",
            type: "${type}"
          })`,
        );

        expect(result.isError).toBe(false);
        const commentCall = manager.addComment.mock.calls[0][0];
        expect(commentCall.type).toBe(type);
      }
    });

    it('errors when searchContext is not found in note', async () => {
      const result = await exec(
        tool,
        `return await ws.comment.add("note-1", {
          searchContext: "nonexistent context",
          commentTarget: "nonexistent",
          comment: "Oops"
        })`,
      );

      expect(result.isError).toBe(true);
      expect(text(result)).toContain('Could not find the search context');
    });

    it('errors when commentTarget is not in searchContext', async () => {
      const result = await exec(
        tool,
        `return await ws.comment.add("note-1", {
          searchContext: "this is a test note",
          commentTarget: "something else",
          comment: "Oops"
        })`,
      );

      expect(result.isError).toBe(true);
      expect(text(result)).toContain('comment target was not found within the search context');
    });

    it('errors when required params are missing', async () => {
      const r1 = await exec(tool, `return await ws.comment.add("note-1", { comment: "x", commentTarget: "y" })`);
      expect(r1.isError).toBe(true);
      expect(text(r1)).toContain('searchContext');
    });
  });

  // ── comment.delete ───────────────────────────────────────────────────────

  describe('comment.delete', () => {
    it('deletes a comment successfully', async () => {
      const result = await exec(tool, `return await ws.comment.delete("note-1", "comment-42")`);

      expect(result.isError).toBe(false);
      const out = JSON.parse(text(result));
      expect(out.success).toBe(true);
      expect(manager.deleteComment).toHaveBeenCalledWith({
        workspaceId,
        noteId: 'note-1',
        commentId: 'comment-42',
      });
    });

    it('errors when noteId is missing', async () => {
      const result = await exec(tool, `return await ws.comment.delete("", "comment-42")`);
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('Note ID is required');
    });

    it('errors when commentId is missing', async () => {
      const result = await exec(tool, `return await ws.comment.delete("note-1", "")`);
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('Comment ID is required');
    });

    it('errors when delete fails', async () => {
      manager.deleteComment.mockResolvedValue({ ok: false, error: 'Comment not found' });
      const result = await exec(tool, `return await ws.comment.delete("note-1", "missing")`);
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('Comment not found');
    });
  });

  // ── comment.list ─────────────────────────────────────────────────────────

  describe('comment.list', () => {
    const now = new Date('2026-03-22T20:00:00Z');
    const earlier = new Date('2026-03-22T18:00:00Z');

    function makeComments() {
      return [
        {
          id: 'c1',
          threadId: 't1',
          content: 'First',
          author: 'User',
          authorType: 'user',
          status: 'open',
          section: 'hello',
          markId: 'mark-1',
          createdAt: earlier.toISOString(),
          updatedAt: earlier.toISOString(),
        },
        {
          id: 'c2',
          threadId: 't1',
          parentId: 'c1',
          content: 'Reply',
          author: 'Agent',
          authorType: 'agent',
          status: 'open',
          section: 'hello',
          markId: 'mark-1',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
        {
          id: 'c3',
          threadId: 't2',
          content: 'Resolved one',
          author: 'User',
          authorType: 'user',
          status: 'resolved',
          section: 'world',
          markId: 'mark-2',
          createdAt: earlier.toISOString(),
          updatedAt: earlier.toISOString(),
        },
      ];
    }

    it('groups comments into threads sorted by latest activity', async () => {
      manager.listComments.mockResolvedValue({ ok: true, data: makeComments() });

      const result = await exec(tool, `return await ws.comment.list("note-1")`);
      expect(result.isError).toBe(false);
      const out = JSON.parse(text(result));

      expect(out.totalThreads).toBe(2);
      // Thread t1 has latest activity (c2 at 20:00) so should be first
      expect(out.threads[0].threadId).toBe('t1');
      expect(out.threads[0].commentCount).toBe(2);
      expect(out.threads[1].threadId).toBe('t2');
      expect(out.threads[1].commentCount).toBe(1);
    });

    it('filters by status', async () => {
      manager.listComments.mockResolvedValue({ ok: true, data: makeComments() });

      const result = await exec(tool, `return await ws.comment.list("note-1", { status: "resolved" })`);
      expect(result.isError).toBe(false);
      const out = JSON.parse(text(result));
      expect(out.totalThreads).toBe(1);
      expect(out.threads[0].threadId).toBe('t2');
    });

    it('filters by authorType', async () => {
      manager.listComments.mockResolvedValue({ ok: true, data: makeComments() });

      const result = await exec(tool, `return await ws.comment.list("note-1", { authorType: "agent" })`);
      expect(result.isError).toBe(false);
      const out = JSON.parse(text(result));
      // Thread t1 has latest comment by agent
      expect(out.totalThreads).toBe(1);
      expect(out.threads[0].threadId).toBe('t1');
    });

    it('filters by since timestamp', async () => {
      manager.listComments.mockResolvedValue({ ok: true, data: makeComments() });

      const result = await exec(
        tool,
        `return await ws.comment.list("note-1", { since: "2026-03-22T19:00:00Z" })`,
      );
      expect(result.isError).toBe(false);
      const out = JSON.parse(text(result));
      // Only thread t1 has activity after 19:00
      expect(out.totalThreads).toBe(1);
      expect(out.threads[0].threadId).toBe('t1');
    });

    it('includes full comments when includeComments is true', async () => {
      manager.listComments.mockResolvedValue({ ok: true, data: makeComments() });

      const result = await exec(
        tool,
        `return await ws.comment.list("note-1", { includeComments: true })`,
      );
      expect(result.isError).toBe(false);
      const out = JSON.parse(text(result));
      expect(out.threads[0].comments).toBeDefined();
      expect(out.threads[0].comments.length).toBe(2);
    });

    it('omits full comments when includeComments is not set', async () => {
      manager.listComments.mockResolvedValue({ ok: true, data: makeComments() });

      const result = await exec(tool, `return await ws.comment.list("note-1")`);
      expect(result.isError).toBe(false);
      const out = JSON.parse(text(result));
      expect(out.threads[0].comments).toBeUndefined();
    });

    it('returns empty when no comments exist', async () => {
      const result = await exec(tool, `return await ws.comment.list("note-1")`);
      expect(result.isError).toBe(false);
      const out = JSON.parse(text(result));
      expect(out.totalThreads).toBe(0);
      expect(out.threads).toEqual([]);
    });

    it('rejects invalid authorType', async () => {
      const result = await exec(
        tool,
        `return await ws.comment.list("note-1", { authorType: "bot" })`,
      );
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("Invalid 'authorType'");
    });

    it('rejects invalid status', async () => {
      const result = await exec(
        tool,
        `return await ws.comment.list("note-1", { status: "closed" })`,
      );
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("Invalid 'status'");
    });
  });
});

