import type { Editor } from '@tiptap/core';
import type { Store } from 'ag-redux-toolkit/svelte-store';
import { selectCommentAction } from '$store/renderer/slices/comments/comments-slice';

import type { LoggerLike } from './logger.types';

export type SetupCommentMarkClickHandlerV2Args = {
  editor: Editor;
  store: Store<any, any>;
  logger: LoggerLike;
  noteId: string | undefined;
  maxAttempts?: number;
  delayMs?: number;
};

/**
 * Adds a click handler that selects comments when clicking highlighted comment marks.
 *
 * TipTap/ProseMirror view can briefly be unavailable during initialization, so this helper
 * retries until the view DOM is ready (bounded by maxAttempts).
 */
export function setupCommentMarkClickHandlerV2({
  editor,
  store,
  logger,
  noteId,
  maxAttempts = 100,
  delayMs = 50,
}: SetupCommentMarkClickHandlerV2Args): () => void {
  let checkViewReadyTimeout: ReturnType<typeof setTimeout> | null = null;
  let checkViewReadyAttempts = 0;

  const checkViewReady = () => {
    try {
      // Prevent infinite loop - stop after max attempts
      if (checkViewReadyAttempts >= maxAttempts) {
        logger.warn('Editor view not ready after maximum attempts', {
          noteId,
          attempts: checkViewReadyAttempts,
        });
        return;
      }
      checkViewReadyAttempts++;

      // Check if editor exists and is ready
      if (!editor || (editor as any).isDestroyed) {
        checkViewReadyTimeout = setTimeout(checkViewReady, delayMs);
        return;
      }

      // Try to access the view - this will throw if not ready
      const editorDom = editor.view?.dom;
      if (!editorDom) {
        checkViewReadyTimeout = setTimeout(checkViewReady, delayMs);
        return;
      }

      const handleCommentClick = (event: MouseEvent) => {
        const target = event.target as HTMLElement;

        // Check multiple ways to find the comment mark
        let commentId: string | null = null;

        // Method 1: Check if clicking on highlighted text with comment mark
        // TipTap applies marks as inline styles, not necessarily as mark elements
        try {
          // Make sure view is fully available before using posAtCoords
          // Check for view.dom to ensure the editor is mounted
          if (editor.view?.dom && (editor as any).state) {
            const pos = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });

            if (pos && pos.pos >= 0) {
              // Get marks at the clicked position
              const resolvedPos = (editor as any).state.doc.resolve(pos.pos);
              const marks = resolvedPos.marks();

              // Find comment mark
              const commentMark = marks.find((mark: any) => mark.type.name === 'commentMark');
              if (commentMark) {
                commentId = commentMark.attrs.commentId;
              }
            }
          }
        } catch {
          // If position detection fails, fall back to DOM methods
        }

        // Fallback methods if position-based detection doesn't work
        if (!commentId) {
          // Method 2: Direct data attribute
          if (target.hasAttribute?.('data-comment-id')) {
            commentId = target.getAttribute('data-comment-id');
          }
          // Method 3: Check if it's a mark element
          else if (target.tagName === 'MARK') {
            commentId = target.getAttribute('data-comment-id');
          }
          // Method 4: Check parent mark element
          else {
            const markElement = target.closest('mark[data-comment-id]') as HTMLElement;
            if (markElement) {
              commentId = markElement.getAttribute('data-comment-id');
            }
          }
          // Method 5: Check for comment-highlight class
          if (!commentId) {
            const highlightElement = target.closest('.comment-highlight') as HTMLElement;
            if (highlightElement) {
              commentId = highlightElement.getAttribute('data-comment-id');
            }
          }
        }

        if (commentId) {
          // Only update through the store to avoid conflicts
          store.dispatch(selectCommentAction(commentId));

          // Prevent default to avoid text selection
          event.preventDefault();
          event.stopPropagation();
        }
      };

      // Remove any existing listener first
      if ((editor as any)._commentClickHandler) {
        editorDom.removeEventListener('click', (editor as any)._commentClickHandler);
      }

      // Add the new listener
      editorDom.addEventListener('click', handleCommentClick);

      // Store the handler for cleanup
      (editor as any)._commentClickHandler = handleCommentClick;
    } catch (error) {
      logger.error('[NoteWithComments] Error setting up comment click handler', error);
      // Retry if there's an error
      checkViewReadyTimeout = setTimeout(checkViewReady, delayMs);
    }
  };

  checkViewReady();

  return () => {
    if (checkViewReadyTimeout) {
      clearTimeout(checkViewReadyTimeout);
      checkViewReadyTimeout = null;
    }

    try {
      const handler = (editor as any)._commentClickHandler;
      if (handler && !(editor as any).isDestroyed && editor.view?.dom) {
        editor.view.dom.removeEventListener('click', handler);
      }
      delete (editor as any)._commentClickHandler;
    } catch {
      // Ignore errors during cleanup
    }
  };
}
