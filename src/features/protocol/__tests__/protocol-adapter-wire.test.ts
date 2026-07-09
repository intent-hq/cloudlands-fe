import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wire-contract tests for ProtocolAdapter note/task/comment methods.
 *
 * Per PROTOCOL.md §5.2/§5.3/§5.4, these arms are dispatched to the intentd
 * daemon over JSON-RPC. Each test asserts the exact `(method, params)` sent
 * to `getBackendClient().request()` and feeds a PROTOCOL-shaped mock response
 * back, then asserts the adapter's return shape for both IPC and MCP callers.
 */

const { mockRequest, loggerSpies } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  loggerSpies: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mockRequest }),
}));

vi.mock('$shared/logger', () => ({
  Logger: class {
    debug = loggerSpies.debug;
    info = loggerSpies.info;
    warn = loggerSpies.warn;
    error = loggerSpies.error;
  },
}));

vi.mock('../../workspace/main/workspace.service', () => ({
  WorkspaceService: class {},
}));

vi.mock('../../tools/main/tool.service', () => ({
  ToolService: class {},
}));

vi.unmock('$features/protocol/main/protocol-adapter');
vi.unmock('../main/protocol-adapter');

import { ProtocolAdapter } from '../main/protocol-adapter';

describe('ProtocolAdapter wire contracts (PROTOCOL.md §5.2/§5.3/§5.4)', () => {
  let adapter: ProtocolAdapter;

  beforeEach(() => {
    mockRequest.mockReset();
    adapter = new ProtocolAdapter();
  });

  describe('note.*', () => {
    it('createNote → note.create (MCP style returns raw note)', async () => {
      mockRequest.mockResolvedValueOnce({ note: { id: 'n1', title: 'T' } });
      const out = await adapter.createNote('ws-1', { title: 'T', content: 'B' });
      expect(mockRequest).toHaveBeenCalledWith('note.create', {
        workspaceId: 'ws-1',
        title: 'T',
        content: 'B',
      });
      expect(out).toEqual({ id: 'n1', title: 'T' });
    });

    it('listNotes → note.list flattens { notes } to array', async () => {
      mockRequest.mockResolvedValueOnce({ notes: [{ id: 'a' }, { id: 'b' }] });
      const out = await adapter.listNotes('ws-1');
      expect(mockRequest).toHaveBeenCalledWith('note.list', { workspaceId: 'ws-1' });
      expect(out).toEqual([{ id: 'a' }, { id: 'b' }]);
    });

    it('getNote → note.get (IPC style returns Result)', async () => {
      mockRequest.mockResolvedValueOnce({ note: { id: 'n1' } });
      const out = await adapter.getNote({ workspaceId: 'ws-1', noteId: 'n1' });
      expect(mockRequest).toHaveBeenCalledWith('note.get', { workspaceId: 'ws-1', noteId: 'n1' });
      expect(out).toEqual({ ok: true, data: { id: 'n1' } });
    });

    it('updateNote → note.update forwards content/title/tags only', async () => {
      mockRequest.mockResolvedValueOnce({ note: { id: 'n1', title: 'X' } });
      await adapter.updateNote({ workspaceId: 'ws-1', id: 'n1', title: 'X', tags: ['t'] });
      expect(mockRequest).toHaveBeenCalledWith('note.update', {
        workspaceId: 'ws-1',
        noteId: 'n1',
        title: 'X',
        tags: ['t'],
      });
    });

    it('deleteNote → note.delete', async () => {
      mockRequest.mockResolvedValueOnce({ ok: true, noteId: 'n1', deleted: true });
      const out = await adapter.deleteNote('ws-1', 'n1');
      expect(mockRequest).toHaveBeenCalledWith('note.delete', { workspaceId: 'ws-1', noteId: 'n1' });
      expect(out).toBe(true);
    });
  });

  describe('comment.*', () => {
    it('addComment → comment.add maps content→comment', async () => {
      mockRequest.mockResolvedValueOnce({ ok: true, commentId: 'c1' });
      const out = await adapter.addComment({
        workspaceId: 'ws-1',
        noteId: 'n1',
        content: 'hi',
        type: 'comment',
        author: 'me',
        authorType: 'user',
        searchContext: 'ctx',
        commentTarget: 'ctx',
      });
      expect(mockRequest).toHaveBeenCalledWith('comment.add', {
        workspaceId: 'ws-1',
        noteId: 'n1',
        comment: 'hi',
        searchContext: 'ctx',
        commentTarget: 'ctx',
        type: 'comment',
        author: 'me',
        authorType: 'user',
      });
      expect(out).toEqual({ ok: true, data: { ok: true, commentId: 'c1' } });
    });

    it('listComments → comment.list flattens threads to comments', async () => {
      mockRequest.mockResolvedValueOnce({
        threads: [{ id: 't1', comments: [{ id: 'c1' }, { id: 'c2' }] }],
      });
      const out = await adapter.listComments({ workspaceId: 'ws-1', noteId: 'n1' });
      expect(mockRequest).toHaveBeenCalledWith('comment.list', {
        workspaceId: 'ws-1',
        noteId: 'n1',
        includeComments: true,
      });
      expect(out).toEqual({ ok: true, data: [{ id: 'c1' }, { id: 'c2' }] });
    });

    it('updateCommentStatus → comment.resolveThread', async () => {
      mockRequest.mockResolvedValueOnce({ ok: true });
      await adapter.updateCommentStatus({
        workspaceId: 'ws-1',
        noteId: 'n1',
        commentId: 'c1',
        status: 'resolved',
      });
      expect(mockRequest).toHaveBeenCalledWith('comment.resolveThread', {
        workspaceId: 'ws-1',
        noteId: 'n1',
        commentId: 'c1',
        resolved: true,
      });
    });

    it('deleteComment → comment.delete', async () => {
      mockRequest.mockResolvedValueOnce({ ok: true });
      await adapter.deleteComment({ workspaceId: 'ws-1', noteId: 'n1', commentId: 'c1' });
      expect(mockRequest).toHaveBeenCalledWith('comment.delete', {
        workspaceId: 'ws-1',
        noteId: 'n1',
        commentId: 'c1',
      });
    });

    it('suggestChange → comment.add with type suggestion', async () => {
      mockRequest.mockResolvedValueOnce({ ok: true });
      await adapter.suggestChange({
        workspaceId: 'ws-1',
        noteId: 'n1',
        description: 'desc',
        original: 'orig',
        proposed: 'new',
        author: 'me',
        authorType: 'user',
      });
      expect(mockRequest).toHaveBeenCalledWith('comment.add', {
        workspaceId: 'ws-1',
        noteId: 'n1',
        comment: 'desc',
        type: 'suggestion',
        author: 'me',
        authorType: 'user',
        suggestionOriginal: 'orig',
        suggestionProposed: 'new',
      });
    });
  });

  describe('task.*', () => {
    it('markAsTask → task.markAsTask forwards status/effort', async () => {
      mockRequest.mockResolvedValueOnce({ ok: true });
      await adapter.markAsTask({
        workspaceId: 'ws-1',
        noteId: 'n1',
        taskMetadata: { status: 'in_progress', effort: 3 },
      });
      expect(mockRequest).toHaveBeenCalledWith('task.markAsTask', {
        workspaceId: 'ws-1',
        noteId: 'n1',
        status: 'in_progress',
        effort: 3,
      });
    });

    it('createPrerequisiteNote → task.createPrerequisite', async () => {
      mockRequest.mockResolvedValueOnce({ note: { id: 'pre-1' } });
      const out = await adapter.createPrerequisiteNote({
        workspaceId: 'ws-1',
        dependentNoteId: 'n1',
        prerequisite: { title: 'Prep', content: 'body' },
      });
      expect(mockRequest).toHaveBeenCalledWith('task.createPrerequisite', {
        workspaceId: 'ws-1',
        dependentNoteId: 'n1',
        title: 'Prep',
        content: 'body',
      });
      expect(out).toEqual({ ok: true, data: { prerequisiteNote: { id: 'pre-1' }, agent: undefined } });
    });

    it('assignAgentToTask → task.assignAgent', async () => {
      mockRequest.mockResolvedValueOnce({ ok: true, noteId: 'n1', agentId: 'agent-1' });
      await adapter.assignAgentToTask({
        workspaceId: 'ws-1',
        noteId: 'n1',
        agentId: 'agent-1',
      });
      expect(mockRequest).toHaveBeenCalledWith('task.assignAgent', {
        workspaceId: 'ws-1',
        noteId: 'n1',
        agentId: 'agent-1',
      });
    });

    it('updateTaskStatus → task.updateNoteStatus (returns {success})', async () => {
      mockRequest.mockResolvedValueOnce({ ok: true });
      const out = await adapter.updateTaskStatus('ws-1', 'n1', 'complete');
      expect(mockRequest).toHaveBeenCalledWith('task.updateNoteStatus', {
        workspaceId: 'ws-1',
        noteId: 'n1',
        status: 'complete',
      });
      expect(out).toEqual({ success: true, data: { ok: true } });
    });

    it('convertTaskBlocks → task.convertBlocks', async () => {
      mockRequest.mockResolvedValueOnce({ convertedCount: 2, createdNoteIds: ['a', 'b'] });
      const out = await adapter.convertTaskBlocks({ workspaceId: 'ws-1', noteId: 'n1' });
      expect(mockRequest).toHaveBeenCalledWith('task.convertBlocks', {
        workspaceId: 'ws-1',
        noteId: 'n1',
      });
      expect(out).toEqual({ ok: true, data: { convertedCount: 2, createdNoteIds: ['a', 'b'] } });
    });
  });
});
