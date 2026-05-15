/**
 * Comment Anchor Node
 *
 * An invisible inline node that represents an anchor point for comments.
 * These anchors survive markdown round-trips by serializing to HTML comments.
 *
 * Example in markdown: <!--anchor:cmt-123:start-->
 *
 * This approach keeps comments out-of-band while maintaining stable references
 * that move naturally with the document content.
 */

import {
  Node,
  mergeAttributes,
} from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('CommentAnchor');

export interface CommentAnchorAttributes {
  id: string; // Unique anchor ID like "cmt-123:start" or "cmt-123:end"
  type: 'start' | 'end' | 'point'; // Type of anchor
  commentId: string; // The comment this anchor belongs to
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    commentAnchor: {
      /**
       * Insert comment anchors at the current selection
       */
      insertCommentAnchors: (commentId: string) => ReturnType;
      /**
       * Remove comment anchors for a specific comment
       */
      removeCommentAnchors: (commentId: string) => ReturnType;
      /**
       * Insert a single point anchor
       */
      insertPointAnchor: (commentId: string) => ReturnType;
    };
  }
}

export const CommentAnchor = Node.create({
  name: 'commentAnchor',

  inline: true,
  group: 'inline',
  atom: true, // Atomic node - can't be split
  selectable: false, // Can't be selected by user

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-anchor-id'),
        renderHTML: (attributes) => {
          if (!attributes.id) return {};
          return { 'data-anchor-id': attributes.id };
        },
      },
      type: {
        default: 'point',
        parseHTML: (element) => element.getAttribute('data-anchor-type') || 'point',
        renderHTML: (attributes) => ({ 'data-anchor-type': attributes.type }),
      },
      commentId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-comment-id'),
        renderHTML: (attributes) => {
          if (!attributes.commentId) return {};
          return { 'data-comment-id': attributes.commentId };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        // Parse from our custom span elements
        tag: 'span[data-anchor-id]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // Render as an invisible span.
    // IMPORTANT: This node is an atom/leaf node, so we MUST NOT define a
    // content hole (no `0` third element, no `contentDOM`). If we return a
    // DOM spec with a content hole for a leaf node, ProseMirror will throw:
    //   "RangeError: Content hole not allowed in a leaf node spec"
    // when serializing via DOMSerializer (e.g. editor.getHTML()).
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'comment-anchor',
        style: 'display: none;', // Completely invisible
      }),
    ];
  },

  addCommands() {
    return {
      insertCommentAnchors:
        (commentId: string) =>
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          ({ commands, state, chain, tr }) => {
            const { from, to } = state.selection;

            // Debug: Log selection info
            const $from = state.doc.resolve(from);
            const $to = state.doc.resolve(to);
            logger.debug('Selection info:', {
              from,
              to,
              selectedText: state.doc.textBetween(from, to),
              fromParent: $from.parent.type.name,
              toParent: $to.parent.type.name,
            });

            // For a range selection, insert start and end anchors
            if (from !== to) {
            // Use a custom transaction to insert anchors without splitting nodes
            // This preserves the parent node structure (e.g., headings stay as headings)
              return commands.command(({ tr, dispatch }) => {
                if (!dispatch) return true;

                // Create anchor nodes
                const startAnchor = state.schema.nodes[this.name].create({
                  id: `${commentId}:start`,
                  type: 'start',
                  commentId,
                });
                const endAnchor = state.schema.nodes[this.name].create({
                  id: `${commentId}:end`,
                  type: 'end',
                  commentId,
                });

                // Insert end anchor first (so positions don't shift)
                tr.insert(to, endAnchor);
                // Then insert start anchor
                tr.insert(from, startAnchor);

                logger.debug('Inserted anchors via transaction at positions:', { from, to });
                return true;
              });
            }

            // For a point selection, insert a single point anchor
            return commands.command(({ tr, dispatch }) => {
              if (!dispatch) return true;

              const pointAnchor = state.schema.nodes[this.name].create({
                id: `${commentId}:point`,
                type: 'point',
                commentId,
              });

              tr.insert(from, pointAnchor);
              return true;
            });
          },

      removeCommentAnchors:
        (commentId: string) =>
          ({ state, tr, dispatch }) => {
            let found = false;

            // Find and remove all anchors for this comment
            state.doc.descendants((node, pos) => {
              if (node.type.name === this.name && node.attrs.commentId === commentId) {
                found = true;
                tr.delete(pos, pos + node.nodeSize);
              }
            });

            if (found && dispatch) {
              dispatch(tr);
              return true;
            }

            return false;
          },

      insertPointAnchor:
        (commentId: string) =>
          ({ commands, state }) => {
            const { from } = state.selection;

            return commands.insertContentAt(from, {
              type: this.name,
              attrs: {
                id: `${commentId}:point`,
                type: 'point',
                commentId,
              },
            });
          },
    };
  },

  // Custom serialization for markdown
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span');
      dom.style.display = 'none';
      dom.className = 'comment-anchor';

      // Add the data attributes from the node
      if (node.attrs.id) {
        dom.setAttribute('data-anchor-id', node.attrs.id);
      }
      if (node.attrs.type) {
        dom.setAttribute('data-anchor-type', node.attrs.type);
      }
      if (node.attrs.commentId) {
        dom.setAttribute('data-comment-id', node.attrs.commentId);
      }

      return {
        dom,
        contentDOM: null,
        ignoreMutation: () => true,
      };
    };
  },
});

/**
 * Helper to find anchor positions in the document
 */
export function findCommentAnchors(
  doc: ProseMirrorNode,
  commentId: string,
): { start?: number; end?: number; point?: number } {
  const result: { start?: number; end?: number; point?: number } = {};

  doc.descendants((node, pos) => {
    if (node.type.name === 'commentAnchor' && node.attrs.commentId === commentId) {
      const anchorType = node.attrs.type;
      if (anchorType === 'start') {
        result.start = pos;
      } else if (anchorType === 'end') {
        result.end = pos;
      } else if (anchorType === 'point') {
        result.point = pos;
      }
    }
  });

  return result;
}

/**
 * Helper to get all comment IDs that have anchors in the document
 */
export function getAllAnchoredCommentIds(doc: ProseMirrorNode): Set<string> {
  const commentIds = new Set<string>();

  doc.descendants((node) => {
    if (node.type.name === 'commentAnchor' && node.attrs.commentId) {
      commentIds.add(node.attrs.commentId);
    }
  });

  return commentIds;
}
