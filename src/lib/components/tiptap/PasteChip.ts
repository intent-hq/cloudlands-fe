/**
 * Paste Chip Node
 *
 * An inline node that renders multi-line pasted text as a compact chip.
 * When the editor text is serialized, the full pasted content is included.
 *
 * Follows the same pattern as ContextMention.ts.
 */

import {
  Node,
  mergeAttributes,
} from '@tiptap/core';
import { SvelteNodeViewRenderer } from '$lib/utils/tiptap/svelte-node-view';
import PasteChipNodeView from './PasteChipNodeView.svelte';
import { m } from '$shared/paraglide/messages.js';

export interface PasteChipAttributes {
  /** The full pasted text content */
  content: string;
  /** Number of lines in the pasted text */
  lineCount: number;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pasteChip: {
      /** Insert a paste chip at the current position */
      insertPasteChip: (attrs: PasteChipAttributes) => ReturnType;
    };
  }
}

export const PasteChip = Node.create({
  name: 'pasteChip',

  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      content: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-content'),
        renderHTML: (attributes) => ({ 'data-content': attributes.content }),
      },
      lineCount: {
        default: 0,
        parseHTML: (element) => Number(element.getAttribute('data-line-count')) || 0,
        renderHTML: (attributes) => ({ 'data-line-count': String(attributes.lineCount) }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="paste-chip"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'paste-chip',
        class: 'paste-chip',
      }),
      m.tiptap_pasteChip_pastedLines_label({ count: HTMLAttributes['data-line-count'] || 0 }),
    ];
  },

  renderText({ node }) {
    return node.attrs.content || '';
  },

  addNodeView() {
    return SvelteNodeViewRenderer(PasteChipNodeView);
  },

  addCommands() {
    return {
      insertPasteChip:
        (attrs: PasteChipAttributes) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
          }),
    };
  },
});

