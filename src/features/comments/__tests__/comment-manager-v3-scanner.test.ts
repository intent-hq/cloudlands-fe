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
  beforeAll,
} from 'vitest';
import { Editor } from '@tiptap/core';
import { CommentManagerV2 } from '../comment-manager-v2';
import {
  getReduxStore,
  dispatch as reduxDispatch,
  initReduxDispatchBridge,
  initReduxStoreBridge,
} from '$lib/store/redux-dispatch-bridge';
import {
  loadCommentsAction,
  commentsReducer,
  initialState as commentsInitialState,
} from '$lib/store/slices/comments/comments-slice';
import {
  selectComments,
  selectCommentById,
} from '$lib/store/slices/comments/comments-selectors';
import {
  createTestEditor,
  insertTextWithAnchors,
  clearCommentsStore,
  createTestComment,
  insertAnchorsAtPosition,
} from './test-utils';
import { findCommentAnchors } from '$lib/components/tiptap/CommentAnchor';
import { createStore } from 'redux';

// Set up a minimal Redux store with comments reducer for tests
function createTestReduxStore() {
  const rootReducer = (state: any = { comments: commentsInitialState }, action: any) => ({
    ...state,
    comments: commentsReducer(state.comments, action),
  });
  return createStore(rootReducer);
}

let testStore: ReturnType<typeof createTestReduxStore>;

beforeAll(() => {
  testStore = createTestReduxStore();
  initReduxDispatchBridge(testStore.dispatch);
  initReduxStoreBridge(testStore as any);
});

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
      const comment = selectCommentById.select(getReduxStore().getState(), commentId);
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
      const comment = selectCommentById.select(getReduxStore().getState(), commentId);
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
      const comment = selectCommentById.select(getReduxStore().getState(), commentId);
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
      const comment = selectCommentById.select(getReduxStore().getState(), commentId);
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
      reduxDispatch(loadCommentsAction([comment]));

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
      const updatedComment = selectCommentById.select(getReduxStore().getState(), comment.id);
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
      reduxDispatch(loadCommentsAction([comment]));

      // Act: Scan health (no anchor in editor)
      await manager.scanAnchorHealth();

      // Assert: Comment is orphaned
      const updatedComment = selectCommentById.select(getReduxStore().getState(), comment.id);
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
      reduxDispatch(loadCommentsAction([comment1, comment2, comment3]));

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
      expect(selectCommentById.select(getReduxStore().getState(), id1)?.isOrphaned).toBe(false);
      expect(selectCommentById.select(getReduxStore().getState(), id2)?.isOrphaned).toBe(true);
      expect(selectCommentById.select(getReduxStore().getState(), id3)?.isOrphaned).toBe(false);
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
      reduxDispatch(loadCommentsAction([...selectComments.select(getReduxStore().getState()), pointComment]));

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
      expect(selectCommentById.select(getReduxStore().getState(), rangeId)?.isOrphaned).toBe(false);
      expect(selectCommentById.select(getReduxStore().getState(), pointComment.id)?.isOrphaned).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty document', async () => {
      // Arrange: Comment in store, empty editor
      const comment = createTestComment();
      reduxDispatch(loadCommentsAction([comment]));
      editor.commands.setContent('<p></p>');

      // Act: Scan health
      await manager.scanAnchorHealth();

      // Assert: Comment is orphaned
      expect(selectCommentById.select(getReduxStore().getState(), comment.id)?.isOrphaned).toBe(true);
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
      reduxDispatch(loadCommentsAction([comment]));

      // Act: Scan health (should not throw)
      await expect(manager.scanAnchorHealth()).resolves.not.toThrow();

      // Assert: Comment is orphaned (no anchor metadata = orphaned)
      expect(selectCommentById.select(getReduxStore().getState(), comment.id)?.isOrphaned).toBe(true);
    });

    it('should preserve existing orphaned status if still orphaned', async () => {
      // Arrange: Already orphaned comment
      const comment = createTestComment({ isOrphaned: true });
      reduxDispatch(loadCommentsAction([comment]));

      // Act: Scan health
      await manager.scanAnchorHealth();

      // Assert: Still orphaned
      expect(selectCommentById.select(getReduxStore().getState(), comment.id)?.isOrphaned).toBe(true);
    });

    it('should update orphaned status from true to false when anchors restored', async () => {
      // Arrange: Start with orphaned comment
      const comment = createTestComment({ isOrphaned: true });
      reduxDispatch(loadCommentsAction([comment]));

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
      expect(selectCommentById.select(getReduxStore().getState(), comment.id)?.isOrphaned).toBe(false);
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
      const comment = selectCommentById.select(getReduxStore().getState(), commentId);
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
      const comment = selectCommentById.select(getReduxStore().getState(), commentId);
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
      const comment = selectCommentById.select(getReduxStore().getState(), commentId);
      expect(comment?.isOrphaned).toBe(false);

      // Assert: Anchors still exist
      const anchors = findCommentAnchors(editor.state.doc, commentId);
      expect(anchors.start).toBeDefined();
      expect(anchors.end).toBeDefined();
    });
  });
});
