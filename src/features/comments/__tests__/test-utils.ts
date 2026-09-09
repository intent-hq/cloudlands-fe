/**
 * Test utilities for V2 comment system
 *
 * Provides helper functions for creating test editors, fixtures, and assertions
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { CommentAnchor } from '$lib/components/tiptap/CommentAnchor';
import type { CommentV2 } from '../comment-types-v2';
import { store as appStore } from '$store/renderer/store';
import { loadCommentsAction } from '$store/renderer/slices/comments/comments-slice';
import { Logger } from '../../../shared/logger';

const logger = new Logger('TestUtils');

/**
 * Create a test editor with comment support
 */
export function createTestEditor(content: string = ''): Editor {
  // Ensure we have a DOM element for the editor
  if (typeof document === 'undefined') {
    throw new Error('Document is not defined - test environment must have jsdom');
  }

  // Create a container element for the editor
  const container = document.createElement('div');
  document.body.appendChild(container);

  const editor = new Editor({
    element: container,
    extensions: [StarterKit.configure({}), CommentAnchor],
    content: `<p>${content}</p>`,
    editable: true,
  });

  return editor;
}

/**
 * Destroy an editor and clean up
 */
export function destroyTestEditor(editor: Editor): void {
  try {
    // Check if editor is already destroyed or not mounted
    if (!editor || editor.isDestroyed) {
      return;
    }

    // Try to get the container element before destroying
    let container: HTMLElement | null = null;
    try {
      if (editor.view?.dom?.parentElement) {
        container = editor.view.dom.parentElement;
      }
    } catch {
      // View might not be available, that's ok
    }

    // Destroy the editor
    editor.destroy();

    // Remove the container from DOM if we found it
    if (container && container.parentElement) {
      container.remove();
    }
  } catch (error) {
    logger.error('Error destroying test editor:', error);
  }
}

/**
 * Create a test comment with default values
 */
export function createTestComment(overrides: Partial<CommentV2> = {}): CommentV2 {
  const id = overrides.id || `test-comment-${Date.now()}-${Math.random()}`;
  const type = overrides.type || 'comment';

  const baseComment = {
    id,
    threadId: overrides.threadId || `thread-${id}`,
    content: overrides.content || 'Test comment',
    author: overrides.author || 'Test User',
    authorType: (overrides.authorType || 'user') as 'user' | 'agent',
    status: (overrides.status || 'open') as CommentV2['status'],
    createdAt: overrides.createdAt || new Date().toISOString(),
    updatedAt: overrides.updatedAt || new Date().toISOString(),
    noteId: overrides.noteId || 'test-note',
    anchor: overrides.anchor || {
      type: 'range' as const,
      startId: `${id}:start`,
      endId: `${id}:end`,
    },
    anchorText: overrides.anchorText,
    anchorContext: overrides.anchorContext,
    isOrphaned: overrides.isOrphaned ?? false,
    parentId: overrides.parentId,
    reactions: overrides.reactions,
  };

  // Handle type-specific fields
  if (type === 'suggestion') {
    return {
      ...baseComment,
      type: 'suggestion' as const,
      suggestionDiff: (overrides as any).suggestionDiff || {
        original: 'original text',
        proposed: 'proposed text',
      },
    };
  } else if (type === 'session') {
    return {
      ...baseComment,
      type: 'session' as const,
      agentId: (overrides as any).agentId || 'test-agent-id',
    };
  } else {
    return {
      ...baseComment,
      type: type as 'comment' | 'change-request' | 'question',
    };
  }
}

/**
 * Insert text with anchors and create a comment
 * Returns the comment ID and positions
 */
export async function insertTextWithAnchors(
  editor: Editor,
  manager: any, // CommentManagerV2
  text: string,
  commentContent: string,
  options: { insertAt?: number } = {},
): Promise<{ commentId: string; from: number; to: number }> {
  const { insertAt } = options;

  // Insert the text first
  if (insertAt !== undefined) {
    editor.commands.insertContentAt(insertAt, text);
  } else {
    // Find where to insert (after existing content)
    const docSize = editor.state.doc.content.size;
    const insertPos = Math.max(1, docSize - 1);
    editor.commands.insertContentAt(insertPos, text);
  }

  // Find the text position
  const docText = editor.state.doc.textContent;
  const textIndex = docText.indexOf(text);
  if (textIndex === -1) {
    throw new Error(`Text "${text}" not found in document after insertion`);
  }

  const from = textIndex + 1; // ProseMirror positions are 1-based
  const to = from + text.length;

  // Create comment with anchors
  const comment = createTestComment({
    content: commentContent,
    anchorText: text,
  });

  // Insert anchors
  const success = insertAnchorsAtPosition(editor, comment.id, from, to);
  if (!success) {
    throw new Error('Failed to insert anchors');
  }

  // Add comment to store
  appStore.dispatch(loadCommentsAction([comment]));

  return { commentId: comment.id, from, to };
}

/**
 * Insert anchors for a comment at specific positions
 */
export function insertAnchorsAtPosition(
  editor: Editor,
  commentId: string,
  from: number,
  to?: number,
): boolean {
  try {
    if (to !== undefined && to !== from) {
      // Range anchor
      return editor
        .chain()
        .insertContentAt(to, {
          type: 'commentAnchor',
          attrs: {
            id: `${commentId}:end`,
            type: 'end',
            commentId,
          },
        })
        .insertContentAt(from, {
          type: 'commentAnchor',
          attrs: {
            id: `${commentId}:start`,
            type: 'start',
            commentId,
          },
        })
        .run();
    } else {
      // Point anchor
      return editor.commands.insertContentAt(from, {
        type: 'commentAnchor',
        attrs: {
          id: `${commentId}:point`,
          type: 'point',
          commentId,
        },
      });
    }
  } catch (error) {
    logger.error('Failed to insert anchors:', error);
    return false;
  }
}

/**
 * Clear all comments from the store
 */
export function clearCommentsStore(): void {
  appStore.dispatch(loadCommentsAction([]));
}
