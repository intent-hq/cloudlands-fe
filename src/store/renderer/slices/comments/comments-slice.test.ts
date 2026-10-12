import { describe, it, expect } from 'vitest';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import {
  commentsReducer,
  initialState,
  addCommentAction,
  updateCommentAction,
  removeCommentAction,
  loadCommentsAction,
  replaceNoteCommentsAction,
  clearCommentsAction,
  commentLoadFinished,
  commentLoadReleased,
  commentLoadRequested,
  selectCommentAction,
} from './comments-slice';
import type { CommentV2 } from '$features/comments/comment-types-v2';

const reduce = commentsReducer;

const makeComment = (overrides: Partial<CommentV2> = {}): CommentV2 =>
  ({
    id: 'c-1',
    threadId: 't-1',
    type: 'comment',
    content: 'Test comment',
    author: 'user',
    authorType: 'user',
    status: 'open',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    anchor: { type: 'point' },
    ...overrides,
  }) as CommentV2;

describe('commentsReducer', () => {
  it('should return initial state', () => {
    const state = reduce(undefined, { type: '@@INIT' });
    expect(state).toEqual(initialState);
  });

  it('correlates comment load outcomes, clears retry errors, and releases consumers', () => {
    let state = reduce(
      initialState,
      commentLoadRequested('consumer', 'request-1', 'workspace-1', 'note-1'),
    );
    state = reduce(
      state,
      commentLoadFinished('consumer', 'request-1', 'workspace-1', 'authority-1', 'offline'),
    );
    const stale = reduce(
      state,
      commentLoadFinished('consumer', 'stale', 'workspace-1', 'authority-1'),
    );
    expect(stale).toBe(state);
    state = reduce(
      state,
      commentLoadFinished('consumer', 'request-1', 'workspace-1', 'authority-1'),
    );
    expect(getItem(state.loadsByConsumer, 'consumer')).toMatchObject({
      status: 'ready',
      authority: 'authority-1',
    });
    expect(getItem(state.loadsByConsumer, 'consumer')).not.toHaveProperty('error');
    state = reduce(state, commentLoadReleased('consumer'));
    expect(getItem(state.loadsByConsumer, 'consumer')).toBeUndefined();
  });

  describe('replaceNoteCommentsAction', () => {
    it('replaces only the exact workspace/note and rebuilds threads', () => {
      const own = makeComment({
        id: 'own',
        workspaceId: 'a',
        noteId: 'spec',
        threadId: 'own-thread',
      });
      const otherWorkspace = makeComment({
        id: 'other',
        workspaceId: 'b',
        noteId: 'spec',
        threadId: 'other-thread',
      });
      const otherNote = makeComment({
        id: 'task',
        workspaceId: 'a',
        noteId: 'task',
        threadId: 'task-thread',
      });
      let state = reduce(initialState, loadCommentsAction([own, otherWorkspace, otherNote]));
      state = reduce(state, selectCommentAction('other'));
      const fresh = makeComment({
        id: 'fresh',
        workspaceId: 'a',
        noteId: 'spec',
        threadId: 'fresh-thread',
      });
      const reply = makeComment({
        id: 'reply',
        workspaceId: 'a',
        noteId: 'spec',
        threadId: 'fresh-thread',
        parentId: 'fresh',
      });
      state = reduce(state, replaceNoteCommentsAction('a', 'spec', [fresh, reply]));
      expect(getItems(state.commentsById).map((c) => c.id)).toEqual([
        'other',
        'task',
        'fresh',
        'reply',
      ]);
      expect(getItem(state.threadsById, 'own-thread')).toBeUndefined();
      expect(getItem(state.threadsById, 'fresh-thread')?.commentIds).toEqual(['fresh', 'reply']);
      expect(state.selectedCommentId).toBe('other');
      state = reduce(state, replaceNoteCommentsAction('a', 'spec', []));
      expect(getItems(state.commentsById).map((c) => c.id)).toEqual(['other', 'task']);
      expect(getItem(state.threadsById, 'fresh-thread')).toBeUndefined();
    });

    it('rejects foreign or unowned rows in a scoped snapshot', () => {
      const state = reduce(
        initialState,
        replaceNoteCommentsAction('a', 'spec', [
          makeComment({ id: 'unknown', noteId: 'spec' }),
          makeComment({ id: 'foreign', workspaceId: 'b', noteId: 'spec' }),
          makeComment({ id: 'task', workspaceId: 'a', noteId: 'task' }),
        ]),
      );
      expect(getItems(state.commentsById)).toEqual([]);
    });
  });

  describe('addCommentAction', () => {
    it('should add a comment and build thread', () => {
      const comment = makeComment({ id: 'c-1', threadId: 't-1' });
      const state = reduce(initialState, addCommentAction(comment));
      expect(getItem(state.commentsById, 'c-1')).toEqual(comment);
      expect(state.commentIdsByThread['t-1']).toEqual(['c-1']);
      const thread = getItem(state.threadsById, 't-1');
      expect(thread).toBeDefined();
      expect(thread!.rootCommentId).toBe('c-1');
      expect(thread!.status).toBe('open');
    });

    it('should append to existing thread', () => {
      const c1 = makeComment({ id: 'c-1', threadId: 't-1' });
      const c2 = makeComment({ id: 'c-2', threadId: 't-1', parentId: 'c-1' });
      let state = reduce(initialState, addCommentAction(c1));
      state = reduce(state, addCommentAction(c2));
      expect(state.commentIdsByThread['t-1']).toEqual(['c-1', 'c-2']);
      expect(getItem(state.threadsById, 't-1')!.commentIds).toEqual(['c-1', 'c-2']);
    });
  });

  describe('updateCommentAction', () => {
    it('should update comment fields', () => {
      const comment = makeComment({ id: 'c-1' });
      let state = reduce(initialState, addCommentAction(comment));
      state = reduce(state, updateCommentAction('c-1', { content: 'Updated' }));
      expect(getItem(state.commentsById, 'c-1')!.content).toBe('Updated');
    });

    it('should return same state if comment not found', () => {
      const state = reduce(initialState, updateCommentAction('nonexistent', { content: 'x' }));
      expect(state).toBe(initialState);
    });

    it('should rebuild threads when status changes', () => {
      const c1 = makeComment({ id: 'c-1', threadId: 't-1', status: 'open' });
      let state = reduce(initialState, addCommentAction(c1));
      state = reduce(state, updateCommentAction('c-1', { status: 'resolved' }));
      expect(getItem(state.threadsById, 't-1')!.status).toBe('resolved');
    });
  });

  describe('removeCommentAction', () => {
    it('should remove a comment and update thread', () => {
      const c1 = makeComment({ id: 'c-1', threadId: 't-1' });
      const c2 = makeComment({ id: 'c-2', threadId: 't-1', parentId: 'c-1' });
      let state = reduce(initialState, addCommentAction(c1));
      state = reduce(state, addCommentAction(c2));
      state = reduce(state, removeCommentAction('c-2'));
      expect(getItem(state.commentsById, 'c-2')).toBeUndefined();
      expect(state.commentIdsByThread['t-1']).toEqual(['c-1']);
    });

    it('should remove thread when last comment removed', () => {
      const c1 = makeComment({ id: 'c-1', threadId: 't-1' });
      let state = reduce(initialState, addCommentAction(c1));
      state = reduce(state, removeCommentAction('c-1'));
      expect(state.commentIdsByThread['t-1']).toBeUndefined();
    });

    it('should return same state if comment not found', () => {
      const state = reduce(initialState, removeCommentAction('nonexistent'));
      expect(state).toBe(initialState);
    });
  });

  describe('loadCommentsAction', () => {
    it('should bulk-load comments replacing existing', () => {
      const existing = makeComment({ id: 'old', threadId: 't-old' });
      let state = reduce(initialState, addCommentAction(existing));

      const comments = [
        makeComment({ id: 'c-1', threadId: 't-1' }),
        makeComment({ id: 'c-2', threadId: 't-1', parentId: 'c-1' }),
        makeComment({ id: 'c-3', threadId: 't-2' }),
      ];
      state = reduce(state, loadCommentsAction(comments));
      expect(getItems(state.commentsById)).toHaveLength(3);
      expect(getItem(state.commentsById, 'old')).toBeUndefined();
      expect(Object.keys(state.commentIdsByThread)).toEqual(['t-1', 't-2']);
      expect(getItems(state.threadsById)).toHaveLength(2);
    });
  });

  describe('clearCommentsAction', () => {
    it('should reset to initial state', () => {
      let state = reduce(initialState, addCommentAction(makeComment()));
      state = reduce(state, clearCommentsAction());
      expect(state).toEqual(initialState);
    });
  });

  describe('selectCommentAction', () => {
    it('should set selected comment id', () => {
      const state = reduce(initialState, selectCommentAction('c-1'));
      expect(state.selectedCommentId).toBe('c-1');
    });

    it('should deselect with null', () => {
      let state = reduce(initialState, selectCommentAction('c-1'));
      state = reduce(state, selectCommentAction(null));
      expect(state.selectedCommentId).toBeNull();
    });
  });
});
