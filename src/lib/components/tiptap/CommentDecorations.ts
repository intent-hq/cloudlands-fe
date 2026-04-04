/**
 * Comment Decorations Plugin
 *
 * Creates visual decorations (highlights) for comments based on anchor positions.
 * This keeps the visual representation separate from the document structure.
 */

import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { findCommentAnchors, getAllAnchoredCommentIds } from './CommentAnchor';
import type { CommentV2 } from '$features/comments/comment-types-v2';

export const commentDecorationsKey = new PluginKey('commentDecorations');

// Use V2 comment type
type AnyComment = CommentV2;

export interface CommentDecorationOptions {
  getComments: () => AnyComment[];
  onCommentClick?: (commentId: string) => void;
  getCommentStatus?: (
    commentId: string,
  ) => 'open' | 'resolved' | 'accepted' | 'rejected' | 'pending';
}

/**
 * Create decorations for all comments with anchors in the document
 */
function createDecorations(doc: ProseMirrorNode, comments: AnyComment[]): DecorationSet {
  const decorations: Decoration[] = [];
  const anchoredCommentIds = getAllAnchoredCommentIds(doc);

  // Build a map of thread IDs to their root comments for efficient lookup
  const threadRootComments = new Map<string, AnyComment>();
  comments.forEach((comment) => {
    const threadId = 'threadId' in comment && comment.threadId ? comment.threadId : comment.id;
    // Only store root comments (those without parentId)
    if (!('parentId' in comment && comment.parentId)) {
      threadRootComments.set(threadId, comment);
    }
  });

  // Create decorations for each anchored comment
  anchoredCommentIds.forEach((commentId) => {
    // Find the comment that matches this anchor ID
    const comment = comments.find((c) => c.id === commentId);
    if (!comment) {
      return;
    }

    // Get the thread ID for this comment
    const threadId = 'threadId' in comment && comment.threadId ? comment.threadId : comment.id;

    // Find the root comment of this thread
    const rootComment = threadRootComments.get(threadId) || comment;

    // If the root comment is resolved, don't show any highlight for the thread
    if (rootComment.status === 'resolved') {
      return;
    }

    // Skip creating decorations for reply comments
    // Only root comments should have highlights
    if ('parentId' in comment && comment.parentId) {
      return;
    }

    const anchors = findCommentAnchors(doc, commentId);

    // Range comment (has start and end anchors)
    if (anchors.start !== undefined && anchors.end !== undefined) {
      const decoration = Decoration.inline(
        anchors.start,
        anchors.end,
        {
          class: getCommentClass(comment),
          'data-comment-id': commentId,
          'data-comment-status': comment.status,
          'data-comment-type': comment.type,
        },
        {
          // Decoration spec to handle overlapping
          inclusiveStart: false,
          inclusiveEnd: false,
        },
      );
      decorations.push(decoration);
    }

    // Point comment (single anchor)
    else if (anchors.point !== undefined) {
      // Create a widget decoration for point comments
      const widget = Decoration.widget(
        anchors.point,
        () => {
          const span = document.createElement('span');
          span.className = 'comment-point-marker';
          span.setAttribute('data-comment-id', commentId);
          span.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="8" cy="8" r="3"/>
          </svg>`;
          return span;
        },
        {
          side: 1, // Place after the position
          key: `comment-point-${commentId}`,
        },
      );
      decorations.push(widget);
    }
  });

  return DecorationSet.create(doc, decorations);
}

/**
 * Get CSS class for a comment based on its properties
 */
function getCommentClass(comment: AnyComment): string {
  const classes = ['comment-highlight'];

  // Add status class
  classes.push(`comment-${comment.status}`);

  // Add type class
  classes.push(`comment-type-${comment.type}`);

  // Add author type class
  if (comment.authorType) {
    classes.push(`comment-author-${comment.authorType}`);
  }

  return classes.join(' ');
}

/**
 * Create the comment decorations plugin
 */
export function createCommentDecorationsPlugin(options: CommentDecorationOptions): Plugin {
  // Cache comments to avoid fetching on every transaction
  let cachedComments: AnyComment[] = [];
  let lastFetchTime = 0;
  const CACHE_DURATION = 100; // milliseconds

  const getCommentsWithCache = () => {
    const now = Date.now();
    // Only refetch if cache is expired or we're explicitly told comments changed
    if (now - lastFetchTime > CACHE_DURATION) {
      cachedComments = options.getComments();
      lastFetchTime = now;
    }
    return cachedComments;
  };

  return new Plugin({
    key: commentDecorationsKey,

    state: {
      init(_, state) {
        cachedComments = options.getComments();
        lastFetchTime = Date.now();
        return createDecorations(state.doc, cachedComments);
      },

      apply(tr, decorations, oldState, newState) {
        // If there's metadata indicating comments changed, invalidate cache and recreate
        if (tr.getMeta('commentsChanged')) {
          cachedComments = options.getComments();
          lastFetchTime = Date.now();
          return createDecorations(newState.doc, cachedComments);
        }

        // If the document changed, recreate decorations with cached comments
        if (tr.docChanged) {
          return createDecorations(newState.doc, getCommentsWithCache());
        }

        // Otherwise, map existing decorations through the transaction
        return decorations.map(tr.mapping, newState.doc);
      },
    },

    props: {
      decorations(state) {
        return this.getState(state);
      },

      // Handle clicks on comment decorations
      handleClick(view, pos, event) {
        if (!options.onCommentClick) {
          return false;
        }

        const target = event.target as HTMLElement;
        const commentElement = target.closest('[data-comment-id]');

        if (commentElement) {
          const commentId = commentElement.getAttribute('data-comment-id');
          if (commentId) {
            options.onCommentClick(commentId);
            return true;
          }
        }

        return false;
      },
    },
  });
}

/**
 * Update decorations when comments change
 */
export function updateCommentDecorations(view: any) {
  const tr = view.state.tr.setMeta('commentsChanged', true);
  view.dispatch(tr);
}

/**
 * CSS styles for comment decorations
 * These should be added to your global styles or component styles
 * Uses Tailwind CSS color variables for consistent theming
 */
export const commentDecorationStyles = `
  /* Base comment highlight */
  .comment-highlight {
    background-color: hsl(var(--warning) / 0.2);
    border-bottom: 2px solid hsl(var(--warning) / 0.5);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .comment-highlight:hover {
    background-color: hsl(var(--warning) / 0.3);
    border-bottom-color: hsl(var(--warning) / 0.8);
  }

  /* Status-based styles */
  .comment-resolved {
    /* No highlight for resolved comments */
    background-color: transparent;
    border-bottom-color: transparent;
    text-decoration: none;
    opacity: 1;
  }

  .comment-accepted {
    background-color: hsl(var(--success) / 0.2);
    border-bottom-color: hsl(var(--success) / 0.5);
  }

  .comment-rejected {
    background-color: hsl(var(--destructive) / 0.1);
    border-bottom-color: hsl(var(--destructive) / 0.3);
    text-decoration: line-through;
    opacity: 0.7;
  }

  .comment-pending {
    background-color: hsl(var(--warning) / 0.2);
    border-bottom-color: hsl(var(--warning) / 0.5);
  }

  /* Type-based styles */
  .comment-type-suggestion {
    background-color: hsl(var(--primary) / 0.15);
    border-bottom-color: hsl(var(--primary) / 0.4);
    border-bottom-style: dashed;
  }

  .comment-type-change-request {
    background-color: hsl(var(--destructive) / 0.15);
    border-bottom-color: hsl(var(--destructive) / 0.4);
    border-bottom-width: 3px;
  }

  .comment-type-question {
    background-color: hsl(var(--accent) / 0.15);
    border-bottom-color: hsl(var(--accent) / 0.4);
    border-bottom-style: dotted;
  }

  /* Author type styles */
  .comment-author-agent {
    position: relative;
  }

  .comment-author-agent::before {
    content: "🤖";
    position: absolute;
    top: -8px;
    left: -2px;
    font-size: 12px;
    opacity: 0.7;
  }

  /* Point comment marker */
  .comment-point-marker {
    display: inline-block;
    color: hsl(var(--warning));
    cursor: pointer;
    margin: 0 2px;
    vertical-align: middle;
    transition: transform 0.2s ease;
  }

  .comment-point-marker:hover {
    transform: scale(1.2);
    color: hsl(var(--warning) / 0.8);
  }

  /* Overlapping comments */
  .comment-highlight + .comment-highlight {
    background: linear-gradient(
      45deg,
      hsl(var(--warning) / 0.2) 25%,
      hsl(var(--primary) / 0.2) 25%,
      hsl(var(--primary) / 0.2) 50%,
      hsl(var(--warning) / 0.2) 50%,
      hsl(var(--warning) / 0.2) 75%,
      hsl(var(--primary) / 0.2) 75%
    );
    background-size: 10px 10px;
  }
`;
