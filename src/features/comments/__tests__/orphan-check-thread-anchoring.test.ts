/**
 * Regression: the orphan check must understand daemon-format bare anchor ids
 * and thread-root anchoring (PROTOCOL §5.3 "Reply anchoring").
 *
 * 1. `getAnchorOwnerCommentId` — daemon-format anchor ids have no `:suffix`
 *    (`start_id = comment_id`), so a bare id IS the owning comment id. The
 *    old `lastIndexOf(':')` parse fell back to the reply's own id and falsely
 *    orphaned legacy replies carrying a bare-UUID clone of the root's anchor.
 * 2. `performOrphanCheck` — replies anchor through their thread root, never
 *    independently, so a reply (legacy cloned-anchor or modern anchorless)
 *    must be accepted when its root is anchored in the document.
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
          effect: () => {
            throw new Error('selector.effect is not supported (sagas removed)');
          },
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

import type { Editor } from '@tiptap/core';
import { CommentManagerV2 } from '../comment-manager-v2';
import type { CommentV2 } from '../comment-types-v2';
import { getAnchorOwnerCommentId } from '../utils/anchor-reconciliation';
import { store as appStore } from '$store/renderer/store';
import { loadCommentsAction } from '$store/renderer/slices/comments/comments-slice';
import { createTestEditor, destroyTestEditor, insertAnchorsAtPosition } from './test-utils';

const ROOT_ID = '0c748177-e4a7-4e02-9a1c-4f2b8c31d001';

const now = new Date().toISOString();
const base = {
  content: 'text',
  author: 'User',
  authorType: 'user' as const,
  type: 'comment' as const,
  status: 'open' as const,
  createdAt: now,
  updatedAt: now,
  noteId: 'spec',
};

/** Thread root whose markers are present in the document. */
const rootComment: CommentV2 = {
  ...base,
  id: ROOT_ID,
  threadId: 'thread-1',
  anchor: { type: 'range', startId: `${ROOT_ID}:start`, endId: `${ROOT_ID}:end` },
  anchorText: 'Hello world',
};

/** Legacy reply holding a bare-UUID clone of the root's daemon-format anchor. */
const legacyReply: CommentV2 = {
  ...base,
  id: 'legacy-reply-1',
  threadId: 'thread-1',
  parentId: ROOT_ID,
  anchor: { type: 'range', startId: ROOT_ID, endId: ROOT_ID },
};

/** Modern anchorless reply (PROTOCOL §5.3): anchors via threadId/parentId. */
const modernReply: CommentV2 = {
  ...base,
  id: 'modern-reply-1',
  threadId: 'thread-1',
  parentId: ROOT_ID,
};

/** Nested reply (reply to a reply): root only reachable via the parentId chain. */
const nestedReply: CommentV2 = {
  ...base,
  id: 'nested-reply-1',
  threadId: 'thread-1',
  parentId: 'modern-reply-1',
};

/** Root with no markers anywhere in the document — genuinely orphaned. */
const orphanRoot: CommentV2 = {
  ...base,
  id: 'orphan-root-1',
  threadId: 'thread-2',
  anchor: { type: 'range', startId: 'orphan-root-1:start', endId: 'orphan-root-1:end' },
  anchorText: 'gone text',
};

describe('getAnchorOwnerCommentId (daemon-format bare anchor ids)', () => {
  it('returns the bare anchor id itself when it has no :suffix', () => {
    expect(getAnchorOwnerCommentId(legacyReply)).toBe(ROOT_ID);
  });

  it('still strips the :suffix from FE-format anchor ids', () => {
    expect(
      getAnchorOwnerCommentId({
        id: 'reply-9',
        anchor: { type: 'range', startId: `${ROOT_ID}:start`, endId: `${ROOT_ID}:end` },
      }),
    ).toBe(ROOT_ID);
  });

  it('falls back to the comment id when there is no anchor', () => {
    expect(getAnchorOwnerCommentId(modernReply)).toBe('modern-reply-1');
  });
});

describe('performOrphanCheck thread-root anchoring (PROTOCOL §5.3)', () => {
  let editor: Editor;
  let manager: CommentManagerV2;

  const runOrphanCheck = (): CommentV2[] =>
    (manager as unknown as { performOrphanCheck: () => CommentV2[] }).performOrphanCheck();

  beforeEach(async () => {
    vi.clearAllMocks();
    storeControl.reset();
    editor = createTestEditor('Hello world');
    manager = new CommentManagerV2('test-workspace', 'spec');
    await manager.initialize(editor);
    insertAnchorsAtPosition(editor, ROOT_ID, 1, 12);
  });

  afterEach(() => {
    manager.destroy();
    destroyTestEditor(editor);
  });

  it('does not orphan a legacy reply with a bare-UUID cloned anchor when the root is anchored', () => {
    appStore.dispatch(loadCommentsAction([rootComment, legacyReply]));

    const orphaned = runOrphanCheck();
    expect(orphaned.map((c) => c.id)).toEqual([]);
  });

  it('does not orphan a modern anchorless reply when its thread root is anchored', () => {
    appStore.dispatch(loadCommentsAction([rootComment, modernReply]));

    const orphaned = runOrphanCheck();
    expect(orphaned.map((c) => c.id)).toEqual([]);
  });

  it('does not orphan a nested reply whose root is only reachable via the parentId chain', () => {
    appStore.dispatch(loadCommentsAction([rootComment, modernReply, nestedReply]));

    const orphaned = runOrphanCheck();
    expect(orphaned.map((c) => c.id)).toEqual([]);
  });

  it('still flags a genuinely orphaned root with no markers in the document', () => {
    appStore.dispatch(loadCommentsAction([rootComment, legacyReply, modernReply, orphanRoot]));

    const orphaned = runOrphanCheck();
    expect(orphaned.map((c) => c.id)).toEqual(['orphan-root-1']);
  });
});
