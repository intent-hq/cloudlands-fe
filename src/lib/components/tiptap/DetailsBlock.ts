/**
 * TipTap Details Block Extension
 *
 * Custom TipTap nodes for collapsible <details>/<summary> blocks.
 * Renders markdown-style details sections with collapsible content.
 */

import { Node, mergeAttributes } from '@tiptap/core';

/**
 * Details Summary Node - the clickable header part
 */
export const DetailsSummary = Node.create({
  name: 'detailsSummary',

  group: 'block',

  content: 'inline*',

  defining: true,

  parseHTML() {
    return [{ tag: 'summary' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'summary',
      mergeAttributes(HTMLAttributes, {
        class: 'details-summary cursor-pointer font-semibold select-none',
      }),
      0,
    ];
  },
});

/**
 * Details Content Node - the collapsible content area
 */
export const DetailsContent = Node.create({
  name: 'detailsContent',

  group: 'block',

  content: 'block+',

  defining: true,

  parseHTML() {
    return [{ tag: 'div.details-content' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'details-content pl-4 pt-2' }), 0];
  },
});

/**
 * Details Block Node - the container wrapping summary and content
 */
export const DetailsBlock = Node.create({
  name: 'detailsBlock',

  group: 'block',

  content: 'detailsSummary detailsContent',

  defining: true,

  addAttributes() {
    return {
      open: {
        default: false,
        parseHTML: (element) => element.hasAttribute('open'),
        renderHTML: (attributes) => {
          if (!attributes.open) {
            return {};
          }
          return { open: '' };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'details' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'details',
      mergeAttributes(HTMLAttributes, {
        class: 'details-block my-2 rounded-md border border-border/50 p-3',
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {
      // Toggle details open/closed with Enter when cursor is in summary
      Enter: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        const { $from } = selection;

        // Check if we're in a summary node
        if ($from.parent.type.name === 'detailsSummary') {
          // Find the parent details block
          for (let depth = $from.depth; depth >= 0; depth--) {
            const node = $from.node(depth);
            if (node.type.name === 'detailsBlock') {
              const pos = $from.before(depth);
              return editor.commands.command(({ tr }) => {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  open: !node.attrs.open,
                });
                return true;
              });
            }
          }
        }

        return false;
      },
    };
  },
});
