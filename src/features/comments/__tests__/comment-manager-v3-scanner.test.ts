/**
 * V3 Comment Manager - Anchor Health Scanner Tests
 *
 * Tests the scanner that detects orphaned comments by comparing:
 * - What comments exist in the store (should have anchors)
 * - What anchors actually exist in the editor
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
} from 'vitest';

vi.mock('$store/renderer/store', async () => {
  const { createStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');
  const { commentsReducer, initialState } = await vi.importActual<typeof import('$store/renderer/slices/comments/comments-slice')>(
    '$store/renderer/slices/comments/comments-slice'
  );
  let state = { comments: initialState };
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
    createSelector: (selectorFunc: (state: any, ...args: any[]) => any) => Object.assign(
      (...args: any[]) => readable(() => selectorFunc(mockStore.state, ...args)),
      {
        select: selectorFunc,
        effect: (...args: any[]) => selectorFunc(mockStore.state, ...args),
        withStore: (storeSource: { state?: unknown }) =>
          (...args: any[]) => readable(() => selectorFunc(storeSource.state ?? mockStore.state, ...args)),
      },
    ),
  };

  return createStoreMockModule(mockStore);
});

import { Editor } from '@tiptap/core';
import { CommentManagerV2 } from '../comment-manager-v2';
import { store as appStore } from '$store/renderer/store';
import {
  loadCommentsAction,
} from '$store/renderer/slices/comments/comments-slice';
import {
  selectComments,
  selectCommentById,
} from '$store/renderer/slices/comments/comments-selectors';
import {
  createTestEditor,
  insertTextWithAnchors,
  clearCommentsStore,
  createTestComment,
  insertAnchorsAtPosition,
} from './test-utils';
import { findCommentAnchors } from '$lib/components/tiptap/CommentAnchor';

describe('CommentManagerV3 - Anchor Health Scanner', () => {
  let editor: Editor;
  let manager: CommentManagerV2;

  beforeEach(async () => {
    editor = createTestEditor();
    manager = new CommentManagerV2('test-workspace', 'test-note');
    await manager.initialize(editor);
    clearCommentsStore();
  });

  describe('Basic Health Detection', () => {
    it('should detect healthy anchors when both store and editor have them', async () => {
      // Arrange: Create comment with anchors in editor
      const { commentId } = await insertTextWithAnchors(
        editor,
        manager,
        'Hello world',
        'Test comment',
      );

      // Act: Scan health
      await manager.scanAnchorHealth();

      // Assert: Comment is healthy
      const comment = selectCommentById.select(appStore.state, commentId);
      expect(comment?.isOrphaned).toBe(false);
    });

    it('should detect orphaned anchors when store has comment but editor missing anchors', async () => {
      // Arrange: Create comment with anchors
      const { commentId } = await insertTextWithAnchors(
        editor,
        manager,
        'Hello world',
        'Test comment',
      );

      // Delete all content (removes anchors)
      editor.commands.setContent('<p></p>');

      // Act: Scan health
      await manager.scanAnchorHealth();

      // Assert: Comment is orphaned
      const comment = selectCommentById.select(appStore.state, commentId);
      expect(comment?.isOrphaned).toBe(true);
    });

    it('should detect orphaned when only start anchor exists', async () => {
      // Arrange: Create comment with both anchors
      const { commentId } = await insertTextWithAnchors(
        editor,
        manager,
        'Hello world',
        'Test comment',
      );

      // Manually remove end anchor by traversing and deleting the node
      const positionsToDelete: Array<{ from: number; to: number }> = [];
      editor.state.doc.descendants((node, pos) => {
        if (
          node.type.name === 'commentAnchor' &&
          node.attrs.commentId === commentId &&
          node.attrs.type === 'end'
        ) {
          positionsToDelete.push({ from: pos, to: pos + node.nodeSize });
        }
      });
      if (positionsToDelete.length > 0) {
        const { from, to } = positionsToDelete[0];
        const tr = editor.state.tr.delete(from, to);
        editor.view.dispatch(tr);
      }

      // Act: Scan health
      await manager.scanAnchorHealth();

      // Assert: Comment is orphaned (incomplete anchors)
      const comment = selectCommentById.select(appStore.state, commentId);
      expect(comment?.isOrphaned).toBe(true);
    });

    it('should detect orphaned when only end anchor exists', async () => {
      // Arrange: Create comment with both anchors
      const { commentId } = await insertTextWithAnchors(
        editor,
        manager,
        'Hello world',
        'Test comment',
      );

      // Manually remove start anchor by traversing and deleting the node
      const positionsToDelete: Array<{ from: number; to: number }> = [];
      editor.state.doc.descendants((node, pos) => {
        if (
          node.type.name === 'commentAnchor' &&
          node.attrs.commentId === commentId &&
          node.attrs.type === 'start'
        ) {
          positionsToDelete.push({ from: pos, to: pos + node.nodeSize });
        }
      });
      if (positionsToDelete.length > 0) {
        const { from, to } = positionsToDelete[0];
        const tr = editor.state.tr.delete(from, to);
        editor.view.dispatch(tr);
      }

      // Act: Scan health
      await manager.scanAnchorHealth();

      // Assert: Comment is orphaned (incomplete anchors)
      const comment = selectCommentById.select(appStore.state, commentId);
      expect(comment?.isOrphaned).toBe(true);
    });
  });

  describe('Point Anchors', () => {
    it('should detect healthy point anchors', async () => {
      // Arrange: Create point anchor (single position)
      const comment = createTestComment({
        anchor: {
          type: 'point',
          pointId: 'test-comment:point',
        },
      });
      appStore.dispatch(loadCommentsAction([comment]));

      // Insert point anchor in editor
      editor.commands.insertContentAt(1, {
        type: 'commentAnchor',
        attrs: {
          id: `${comment.id}:point`,
          type: 'point',
          commentId: comment.id,
        },
      });

      // Act: Scan health
      await manager.scanAnchorHealth();

      // Assert: Comment is healthy
      const updatedComment = selectCommentById.select(appStore.state, comment.id);
      expect(updatedComment?.isOrphaned).toBe(false);
    });

    it('should detect orphaned point anchors', async () => {
      // Arrange: Create point anchor in store but not in editor
      const comment = createTestComment({
        anchor: {
          type: 'point',
          pointId: 'test-comment:point',
        },
      });
      appStore.dispatch(loadCommentsAction([comment]));

      // Act: Scan health (no anchor in editor)
      await manager.scanAnchorHealth();

      // Assert: Comment is orphaned
      const updatedComment = selectCommentById.select(appStore.state, comment.id);
      expect(updatedComment?.isOrphaned).toBe(true);
    });
  });

  describe('Multiple Comments', () => {
    it('should correctly identify health status for multiple comments', async () => {
      // Arrange: Create 3 comments
      // Note: insertTextWithAnchors calls loadComments which clears existing comments
      // So we need to manually manage the store
      const comment1 = createTestComment({
        content: 'Comment 1',
        anchorText: 'First text',
      });
      editor.commands.insertContentAt(1, 'First text');
      const from1 = 1;
      const to1 = from1 + 'First text'.length;
      insertAnchorsAtPosition(editor, comment1.id, from1, to1);

      const comment2 = createTestComment({
        content: 'Comment 2',
        anchorText: 'Second text',
      });
      const docSize1 = editor.state.doc.content.size;
      const insertPos2 = Math.max(1, docSize1 - 1);
      editor.commands.insertContentAt(insertPos2, 'Second text');
      const from2 = editor.state.doc.textContent.indexOf('Second text') + 1;
      const to2 = from2 + 'Second text'.length;
      insertAnchorsAtPosition(editor, comment2.id, from2, to2);

      const comment3 = createTestComment({
        content: 'Comment 3',
        anchorText: 'Third text',
      });
      const docSize2 = editor.state.doc.content.size;
      const insertPos3 = Math.max(1, docSize2 - 1);
      editor.commands.insertContentAt(insertPos3, 'Third text');
      const from3 = editor.state.doc.textContent.indexOf('Third text') + 1;
      const to3 = from3 + 'Third text'.length;
      insertAnchorsAtPosition(editor, comment3.id, from3, to3);

      // Load all comments at once
      appStore.dispatch(loadCommentsAction([comment1, comment2, comment3]));

      const id1 = comment1.id;
      const id2 = comment2.id;
      const id3 = comment3.id;

      // Delete anchors for comment 2 only by traversing and deleting nodes
      // Collect positions first, then delete in reverse order to avoid position shifts
      const positionsToDelete: Array<{ from: number; to: number }> = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'commentAnchor' && node.attrs.commentId === id2) {
          positionsToDelete.push({ from: pos, to: pos + node.nodeSize });
        }
      });

      // Delete in reverse order to avoid position shifts
      let tr = editor.state.tr;
      for (let i = positionsToDelete.length - 1; i >= 0; i--) {
        const { from, to } = positionsToDelete[i];
        tr = tr.delete(from, to);
      }
      editor.view.dispatch(tr);

      // Act: Scan health
      await manager.scanAnchorHealth();

      // Assert: Only comment 2 is orphaned
      expect(selectCommentById.select(appStore.state, id1)?.isOrphaned).toBe(false);
      expect(selectCommentById.select(appStore.state, id2)?.isOrphaned).toBe(true);
      expect(selectCommentById.select(appStore.state, id3)?.isOrphaned).toBe(false);
    });

    it('should handle mix of range and point anchors', async () => {
      // Arrange: Create range anchor
      const { commentId: rangeId } = await insertTextWithAnchors(
        editor,
        manager,
        'Range text',
        'Range comment',
      );

      // Create point anchor
      const pointComment = createTestComment({
        anchor: {
          type: 'point',
          pointId: 'point-comment:point',
        },
      });
      appStore.dispatch(loadCommentsAction([...selectComments.select(appStore.state), pointComment]));

      editor.commands.insertContentAt(1, {
        type: 'commentAnchor',
        attrs: {
          id: `${pointComment.id}:point`,
          type: 'point',
          commentId: pointComment.id,
        },
      });

      // Act: Scan health
      await manager.scanAnchorHealth();

      // Assert: Both healthy
      expect(selectCommentById.select(appStore.state, rangeId)?.isOrphaned).toBe(false);
      expect(selectCommentById.select(appStore.state, pointComment.id)?.isOrphaned).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty document', async () => {
      // Arrange: Comment in store, empty editor
      const comment = createTestComment();
      appStore.dispatch(loadCommentsAction([comment]));
      editor.commands.setContent('<p></p>');

      // Act: Scan health
      await manager.scanAnchorHealth();

      // Assert: Comment is orphaned
      expect(selectCommentById.select(appStore.state, comment.id)?.isOrphaned).toBe(true);
    });

    it('should handle no comments in store', async () => {
      // Arrange: Empty store
      clearCommentsStore();

      // Act: Scan health (should not throw)
      await expect(manager.scanAnchorHealth()).resolves.not.toThrow();
    });

    it('should handle comment without anchor metadata', async () => {
      // Arrange: Comment with no anchor field
      const comment = createTestComment();
      delete (comment as any).anchor;
      appStore.dispatch(loadCommentsAction([comment]));

      // Act: Scan health (should not throw)
      await expect(manager.scanAnchorHealth()).resolves.not.toThrow();

      // Assert: Comment is orphaned (no anchor metadata = orphaned)
      expect(selectCommentById.select(appStore.state, comment.id)?.isOrphaned).toBe(true);
    });

    it('should preserve existing orphaned status if still orphaned', async () => {
      // Arrange: Already orphaned comment
      const comment = createTestComment({ isOrphaned: true });
      appStore.dispatch(loadCommentsAction([comment]));

      // Act: Scan health
      await manager.scanAnchorHealth();

      // Assert: Still orphaned
      expect(selectCommentById.select(appStore.state, comment.id)?.isOrphaned).toBe(true);
    });

    it('should update orphaned status from true to false when anchors restored', async () => {
      // Arrange: Start with orphaned comment
      const comment = createTestComment({ isOrphaned: true });
      appStore.dispatch(loadCommentsAction([comment]));

      // Restore anchors in editor
      editor.commands.insertContentAt(1, {
        type: 'commentAnchor',
        attrs: {
          id: `${comment.id}:start`,
          type: 'start',
          commentId: comment.id,
        },
      });
      editor.commands.insertContentAt(2, {
        type: 'commentAnchor',
        attrs: {
          id: `${comment.id}:end`,
          type: 'end',
          commentId: comment.id,
        },
      });

      // Act: Scan health
      await manager.scanAnchorHealth();

      // Assert: No longer orphaned
      expect(selectCommentById.select(appStore.state, comment.id)?.isOrphaned).toBe(false);
    });
  });

  describe('Reply Anchoring Contract (monorepo#749)', () => {
    // Post-#729 replies carry no anchor/anchorText on the wire — they anchor
    // through their thread root (threadId/parentId, PROTOCOL §5.3 "Reply
    // anchoring"). The scanner must exempt replies from orphan evaluation,
    // mirroring the parentId guard in insertAnchorsForLoadedComments (#371).
    it('does not orphan a contract-compliant anchorless reply (parentId set, no anchor)', async () => {
      // Arrange: root with healthy anchors in the doc
      const root = createTestComment({
        content: 'Root comment',
        anchorText: 'Root text',
      });
      editor.commands.insertContentAt(1, 'Root text');
      insertAnchorsAtPosition(editor, root.id, 1, 1 + 'Root text'.length);

      // Contract-compliant reply: parentId set, no anchor at all
      const reply = createTestComment({
        content: 'Reply comment',
        threadId: root.threadId,
        parentId: root.id,
      });
      delete (reply as { anchor?: unknown }).anchor;

      appStore.dispatch(loadCommentsAction([root, reply]));

      // Act
      await manager.scanAnchorHealth();

      // Assert: neither the root nor the anchorless reply is orphaned
      expect(selectCommentById.select(appStore.state, root.id)?.isOrphaned).toBe(false);
      expect(selectCommentById.select(appStore.state, reply.id)?.isOrphaned).toBe(false);
    });

    it('exempts legacy pre-#729 replies with cloned anchors (parentId is the discriminator)', async () => {
      // Legacy reply row: parentId set AND a non-authoritative clone of the
      // root's anchor, whose anchor nodes are absent from the doc. It must
      // still be exempt — the parentId, not anchor presence, decides.
      const reply = createTestComment({
        content: 'Legacy reply',
        parentId: 'root-1',
        anchor: {
          type: 'range',
          startId: 'root-1:start',
          endId: 'root-1:end',
        },
      });
      appStore.dispatch(loadCommentsAction([reply]));

      await manager.scanAnchorHealth();

      expect(selectCommentById.select(appStore.state, reply.id)?.isOrphaned).toBe(false);
    });

    it('heals a stale isOrphaned flag on a reply left by a pre-guard scan', async () => {
      // A reply wrongly flagged before the exemption existed (or by an older
      // renderer) must be healed, not left permanently orphaned by the skip.
      const reply = createTestComment({
        content: 'Previously flagged reply',
        parentId: 'root-1',
        isOrphaned: true,
      });
      delete (reply as { anchor?: unknown }).anchor;
      appStore.dispatch(loadCommentsAction([reply]));

      await manager.scanAnchorHealth();

      expect(selectCommentById.select(appStore.state, reply.id)?.isOrphaned).toBe(false);
    });

    it('still flags a root comment with a genuinely missing anchor', async () => {
      // Root (no parentId) whose anchors are absent from the doc — real
      // orphan detection must survive the reply exemption.
      const root = createTestComment({ content: 'Rootless root' });
      appStore.dispatch(loadCommentsAction([root]));

      await manager.scanAnchorHealth();

      expect(selectCommentById.select(appStore.state, root.id)?.isOrphaned).toBe(true);
    });
  });

  describe('Integration with Debounced Save', () => {
    it('should be called automatically on debounced save', async () => {
      // This test verifies the integration point where the scanner
      // is triggered after content changes are debounced

      // Arrange: Create comment
      const { commentId } = await insertTextWithAnchors(
        editor,
        manager,
        'Hello world',
        'Test comment',
      );

      // Delete anchors
      editor.commands.setContent('<p>New content</p>');

      // Act: Simulate debounced save
      await manager.handleDebouncedSave();

      // Assert: Scanner ran and detected orphan
      const comment = selectCommentById.select(appStore.state, commentId);
      expect(comment?.isOrphaned).toBe(true);
    });
  });

  describe('Orphaned Anchor Cleanup', () => {
    it('should remove broken anchors when comment becomes orphaned', async () => {
      // Arrange: Create comment with anchors
      const { commentId } = await insertTextWithAnchors(
        editor,
        manager,
        'Hello world',
        'Test comment',
      );

      // Verify anchors exist
      let anchors = findCommentAnchors(editor.state.doc, commentId);
      expect(anchors.start).toBeDefined();
      expect(anchors.end).toBeDefined();

      // Delete only the start anchor manually (simulating partial deletion)
      const { doc } = editor.state;
      const tr = editor.state.tr;
      doc.descendants((node, pos) => {
        if (
          node.type.name === 'commentAnchor' &&
          node.attrs.commentId === commentId &&
          node.attrs.type === 'start'
        ) {
          tr.delete(pos, pos + node.nodeSize);
        }
      });
      editor.view.dispatch(tr);

      // Verify only end anchor remains (broken state)
      anchors = findCommentAnchors(editor.state.doc, commentId);
      expect(anchors.start).toBeUndefined();
      expect(anchors.end).toBeDefined();

      // Act: Scan health (should detect orphan and clean up)
      await manager.scanAnchorHealth();

      // Assert: Comment marked as orphaned
      const comment = selectCommentById.select(appStore.state, commentId);
      expect(comment?.isOrphaned).toBe(true);

      // Assert: All anchors removed (cleanup happened)
      anchors = findCommentAnchors(editor.state.doc, commentId);
      expect(anchors.start).toBeUndefined();
      expect(anchors.end).toBeUndefined();
      expect(anchors.point).toBeUndefined();
    });

    it('should not remove anchors when comment is healthy', async () => {
      // Arrange: Create comment with anchors
      const { commentId } = await insertTextWithAnchors(
        editor,
        manager,
        'Hello world',
        'Test comment',
      );

      // Act: Scan health
      await manager.scanAnchorHealth();

      // Assert: Comment is healthy
      const comment = selectCommentById.select(appStore.state, commentId);
      expect(comment?.isOrphaned).toBe(false);

      // Assert: Anchors still exist
      const anchors = findCommentAnchors(editor.state.doc, commentId);
      expect(anchors.start).toBeDefined();
      expect(anchors.end).toBeDefined();
    });
  });
});
