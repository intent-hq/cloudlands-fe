/**
 * Test utilities for V2 comment system
 *
 * Provides helper functions for creating test editors, fixtures, and assertions
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  CommentAnchor,
  findCommentAnchors,
  getAllAnchoredCommentIds,
} from '$lib/components/tiptap/CommentAnchor';
import type { CommentV2 } from '../comment-types-v2';
import { getReduxStore, dispatch as reduxDispatch } from '$lib/store/redux-dispatch-bridge';
import { loadCommentsAction } from '$lib/store/slices/comments/comments-slice';
import { selectCommentById } from '$lib/store/slices/comments/comments-selectors';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
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
 * Create an orphaned comment (no anchors in document)
 */
export function createOrphanedComment(overrides: Partial<CommentV2> = {}): CommentV2 {
  return createTestComment({
    ...overrides,
    isOrphaned: true,
    anchorText: overrides.anchorText || 'Missing text',
    anchorContext: overrides.anchorContext || {
      before: 'Context before ',
      after: ' context after',
    },
  });
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
  reduxDispatch(loadCommentsAction([comment]));

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
 * Get text content between two positions
 */
export function getTextBetween(editor: Editor, from: number, to: number): string {
  return editor.state.doc.textBetween(from, to);
}

/**
 * Find text in document and return position
 */
export function findTextInDocument(
  doc: ProseMirrorNode,
  searchText: string,
): { from: number; to: number } | null {
  const docText = doc.textContent;
  const index = docText.indexOf(searchText);

  if (index === -1) {
    return null;
  }

  return {
    from: index + 1, // +1 because ProseMirror positions are 1-based
    to: index + 1 + searchText.length,
  };
}

/**
 * Wait for a debounced operation to complete
 */
export function waitForDebounce(ms: number = 1500): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for orphan check to complete (debounced at 1000ms)
 */
export function waitForOrphanCheck(): Promise<void> {
  return waitForDebounce(1500); // Wait longer than the debounce timeout
}

/**
 * Clear all comments from the store
 */
export function clearCommentsStore(): void {
  reduxDispatch(loadCommentsAction([]));
}

/**
 * Assert that anchors exist for a comment
 */
export function assertAnchorsExist(
  editor: Editor,
  commentId: string,
  expectedType: 'range' | 'point' = 'range',
): void {
  const anchors = findCommentAnchors(editor.state.doc, commentId);

  if (expectedType === 'range') {
    if (anchors.start === undefined || anchors.end === undefined) {
      throw new Error(
        `Expected range anchors for comment ${commentId}, but got: ${JSON.stringify(anchors)}`,
      );
    }
  } else {
    if (anchors.point === undefined) {
      throw new Error(
        `Expected point anchor for comment ${commentId}, but got: ${JSON.stringify(anchors)}`,
      );
    }
  }
}

/**
 * Assert that no anchors exist for a comment
 */
export function assertNoAnchors(editor: Editor, commentId: string): void {
  const anchors = findCommentAnchors(editor.state.doc, commentId);

  if (anchors.start !== undefined || anchors.end !== undefined || anchors.point !== undefined) {
    throw new Error(
      `Expected no anchors for comment ${commentId}, but found: ${JSON.stringify(anchors)}`,
    );
  }
}

/**
 * Assert that a comment is marked as orphaned
 */
export function assertCommentOrphaned(commentId: string, expected: boolean = true): void {
  const comment = selectCommentById.select(getReduxStore().getState(), commentId);

  if (!comment) {
    throw new Error(`Comment ${commentId} not found in store`);
  }

  if (comment.isOrphaned !== expected) {
    throw new Error(
      `Expected comment ${commentId} to be ${expected ? 'orphaned' : 'not orphaned'}, but it was ${comment.isOrphaned ? 'orphaned' : 'not orphaned'}`,
    );
  }
}

/**
 * Get all anchored comment IDs from document
 */
export function getAnchoredCommentIds(editor: Editor): Set<string> {
  return getAllAnchoredCommentIds(editor.state.doc);
}

/**
 * Set editor content with HTML
 */
export function setEditorContent(editor: Editor, html: string): void {
  editor.commands.setContent(html);
}

/**
 * Get editor HTML content
 */
export function getEditorHTML(editor: Editor): string {
  try {
    return editor.getHTML();
  } catch  {
    // If getHTML fails due to invalid state (e.g., with anchors), serialize manually
    const doc = editor.state.doc;
    const parts: string[] = [];

    doc.descendants((node) => {
      if (node.type.name === 'paragraph') {
        let text = '';
        node.forEach((child) => {
          if (child.type.name === 'text') {
            text += htmlEncode(child.text || '');
          } else if (child.type.name === 'commentAnchor') {
            const id = child.attrs.id;
            text += `<span data-anchor-id="${id}" data-anchor-type="${child.attrs.type}" data-comment-id="${child.attrs.commentId}"></span>`;
          }
        });
        if (text) {
          parts.push(`<p>${text}</p>`);
        }
      }
    });

    return parts.length > 0 ? parts.join('') : `<p>${htmlEncode(editor.state.doc.textContent)}</p>`;
  }
}

/**
 * HTML encode special characters
 */
function htmlEncode(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Select text in editor
 */
export function selectText(editor: Editor, from: number, to: number): void {
  editor.commands.setTextSelection({ from, to });
}

/**
 * Delete range in editor
 */
export function deleteRange(editor: Editor, from: number, to: number): void {
  editor.commands.deleteRange({ from, to });
}

/**
 * Insert text at position
 */
export function insertText(editor: Editor, text: string, position?: number): void {
  if (position !== undefined) {
    editor.commands.insertContentAt(position, text);
  } else {
    editor.commands.insertContent(text);
  }
}

/**
 * Mock console methods for testing
 */
export function mockConsole() {
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalLog = console.log;

  const warnings: any[] = [];
  const errors: any[] = [];
  const logs: any[] = [];

  console.warn = (...args: any[]) => warnings.push(args);
  console.error = (...args: any[]) => errors.push(args);
  console.log = (...args: any[]) => logs.push(args);

  return {
    warnings,
    errors,
    logs,
    restore: () => {
      console.warn = originalWarn;
      console.error = originalError;
      console.log = originalLog;
    },
  };
}
