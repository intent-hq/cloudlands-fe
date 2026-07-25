/**
 * Regression: remaining FE paths must follow the reply-anchoring contract
 * (PROTOCOL §5.3 "Reply anchoring", monorepo#754).
 *
 * Post-#729, replies carry no anchor/anchorText on the wire — they anchor
 * through their thread root via threadId/parentId. Two paths still diverged:
 * 1. The legacy loadComments path synthesized a point/range anchor for every
 *    comment, replies included (comment-manager-v2 → convertBackendCommentToV2).
 * 2. replyToComment cloned the parent's anchor/anchorText/anchorContext onto
 *    the optimistic reply, so its shape flipped when the daemon refetch
 *    returned the contract-compliant anchorless reply.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const storeControl = vi.hoisted(() => ({ reset: () => {} }));

vi.mock('$store/renderer/store', async () => {
  const { createStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');
  const { commentsReducer, initialState } = await vi.importActual<
    typeof import('$store/renderer/slices/comments/comments-slice')
  >('$store/renderer/slices/comments/comments-slice');
  let state = { comments: initialState };
  storeControl.reset = () => {
    state = { comments: initialState };
  };
  const readable = <T>(getter: () => T) => ({
    subscribe: (listener: (value: T) => void) => {
      listener(getter());
      return () => {};
    },
  });
  const mockStore = {
    dispatch: (action: unknown) => {
      state = { comments: commentsReducer(state.comments, action as never) };
      return action;
    },
    get state() {
      return state;
    },
    createSelector: (selectorFunc: (state: any, ...args: any[]) => any) =>
      Object.assign(
        (...args: any[]) => readable(() => selectorFunc(mockStore.state, ...args)),
        {
          select: selectorFunc,
          effect: (...args: any[]) => selectorFunc(mockStore.state, ...args),
          withStore:
            (storeSource: { state?: unknown }) =>
            (...args: any[]) =>
              readable(() => selectorFunc(storeSource.state ?? mockStore.state, ...args)),
        },
      ),
  };
  return createStoreMockModule(mockStore);
});

vi.mock('../comment-loader', () => ({
  loadComments: vi.fn(async () => []),
  resolveComment: vi.fn(async () => true),
}));

vi.mock('../comments-write-service', () => ({
  addComment: vi.fn(async () => true),
  respondToComment: vi.fn(async () => true),
  deleteComment: vi.fn(async () => ({ existed: true, success: true })),
}));

import type { Editor } from '@tiptap/core';
import { CommentManagerV2 } from '../comment-manager-v2';
import { convertBackendCommentToV2 } from '../comment-types-v2';
import * as commentLoader from '../comment-loader';
import * as commentsWrite from '../comments-write-service';
import { store as appStore } from '$store/renderer/store';
import {
  addCommentAction,
  loadCommentsAction,
} from '$store/renderer/slices/comments/comments-slice';
import {
  selectComments,
  selectCommentById,
} from '$store/renderer/slices/comments/comments-selectors';
import { createTestEditor, destroyTestEditor } from './test-utils';

/** Minimal legacy `NoteComment` rows as `comment-loader` returns them. */
const now = new Date().toISOString();
const backendRoot = {
  id: 'root-1',
  noteId: 'spec',
  threadId: 'thread-1',
  content: 'root comment',
  author: 'User',
  authorType: 'user' as const,
  type: 'comment' as const,
  status: 'open' as const,
  createdAt: now,
  updatedAt: now,
  section: 'Hello world',
};
const backendReply = {
  id: 'reply-1',
  noteId: 'spec',
  threadId: 'thread-1',
  content: 'a reply',
  author: 'Agent',
  authorType: 'agent' as const,
  type: 'comment' as const,
  status: 'open' as const,
  createdAt: now,
  updatedAt: now,
  parentId: 'root-1',
};

describe('reply-anchoring contract (PROTOCOL §5.3, monorepo#754)', () => {
  let editor: Editor;
  let manager: CommentManagerV2;

  beforeEach(() => {
    vi.clearAllMocks();
    storeControl.reset();
    editor = createTestEditor('Hello world');
    manager = new CommentManagerV2('test-workspace', 'spec');
  });

  afterEach(() => {
    manager.destroy();
    destroyTestEditor(editor);
  });

  describe('legacy loadComments path', () => {
    it('does not synthesize an anchor for replies (parentId set)', async () => {
      vi.mocked(commentLoader.loadComments).mockResolvedValueOnce([backendRoot, backendReply]);

      await manager.initialize(editor);

      const reply = selectCommentById.select(appStore.state, 'reply-1');
      expect(reply).toBeDefined();
      expect(reply!.parentId).toBe('root-1');
      expect(reply!.threadId).toBe('thread-1');
      expect(reply).not.toHaveProperty('anchor');
    });

    it('keeps the synthesized point-anchor fallback for anchorless roots', async () => {
      vi.mocked(commentLoader.loadComments).mockResolvedValueOnce([backendRoot, backendReply]);

      await manager.initialize(editor);

      const root = selectCommentById.select(appStore.state, 'root-1');
      expect(root).toBeDefined();
      expect(root!.anchor).toEqual({ type: 'point', pointId: 'root-1:point' });
      expect(root!.anchorText).toBe('Hello world');
    });
  });

  describe('convertBackendCommentToV2', () => {
    it('omits the anchor key entirely when no anchor is passed', () => {
      const converted = convertBackendCommentToV2(backendReply, undefined, 'spec', 'ws-1');
      expect(converted.parentId).toBe('root-1');
      expect(converted).not.toHaveProperty('anchor');
    });

    it('keeps a passed anchor for roots', () => {
      const anchor = { type: 'point' as const, pointId: 'root-1:point' };
      const converted = convertBackendCommentToV2(backendRoot, anchor, 'spec', 'ws-1');
      expect(converted.anchor).toEqual(anchor);
      expect(converted.anchorText).toBe('Hello world');
    });
  });

  describe('replyToComment optimistic reply', () => {
    const rootV2 = {
      id: 'root-1',
      threadId: 'thread-1',
      content: 'root comment',
      type: 'comment' as const,
      author: 'User',
      authorType: 'user' as const,
      status: 'open' as const,
      createdAt: now,
      updatedAt: now,
      noteId: 'spec',
      anchor: { type: 'range' as const, startId: 'root-1:start', endId: 'root-1:end' },
      anchorText: 'Hello world',
      anchorContext: { before: 'before ', after: ' after' },
    };

    it('carries no anchor fields, so its shape matches the daemon refetch reply', async () => {
      await manager.initialize(editor);
      appStore.dispatch(loadCommentsAction([rootV2]));

      const reply = await manager.replyToComment('root-1', 'my reply');
      expect(reply).not.toBeNull();

      const respondMock = vi.mocked(commentsWrite.respondToComment);
      expect(respondMock).toHaveBeenCalledTimes(1);
      const [noteId, optimisticReply, params] = respondMock.mock.calls[0];
      expect(noteId).toBe('spec');
      expect(params).toMatchObject({
        workspaceId: 'test-workspace',
        commentId: 'root-1',
        comment: 'my reply',
        type: 'comment',
        authorType: 'user',
      });

      // §5.3: replies anchor via threadId/parentId; no cloned anchor fields.
      // Their absence keeps the optimistic shape identical to the anchorless
      // reply the daemon refetch returns (no shape flip on reconcile).
      expect(optimisticReply.parentId).toBe('root-1');
      expect(optimisticReply.threadId).toBe('thread-1');
      expect(optimisticReply).not.toHaveProperty('anchor');
      expect(optimisticReply).not.toHaveProperty('anchorText');
      expect(optimisticReply).not.toHaveProperty('anchorContext');
    });

    it('still renders as a nested reply during the optimistic window', async () => {
      await manager.initialize(editor);
      appStore.dispatch(loadCommentsAction([rootV2]));

      // Mimic the real write service's optimistic dispatch (the daemon call
      // itself stays mocked) so the store reflects the optimistic window.
      vi.mocked(commentsWrite.respondToComment).mockImplementationOnce(
        async (_noteId, optimistic) => {
          appStore.dispatch(addCommentAction(optimistic));
          return true;
        },
      );

      const reply = await manager.replyToComment('root-1', 'my reply');
      expect(reply).not.toBeNull();

      // Mirror the sidebar's grouping (CommentsSidebar.svelte): roots are
      // comments without parentId; replies attach via parentId.
      const comments = selectComments.select(appStore.state);
      const activeRoots = comments.filter((c) => c.status !== 'resolved' && !c.parentId);
      const replies = comments.filter((c) => c.parentId === 'root-1');
      expect(activeRoots.map((c) => c.id)).toEqual(['root-1']);
      expect(replies.map((c) => c.id)).toEqual([reply!.id]);
    });
  });
});
