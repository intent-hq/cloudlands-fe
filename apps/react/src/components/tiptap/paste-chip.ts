// Source: src/lib/components/tiptap/PasteChip.ts.
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { m } from '$shared/paraglide/messages.js';
import { PasteChipNodeView } from './paste-chip-node-view';

export interface PasteChipAttributes {
  content: string;
  lineCount: number;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pasteChip: {
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
    return [{ tag: 'span[data-type="paste-chip"]' }];
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
    return ReactNodeViewRenderer(PasteChipNodeView);
  },

  addCommands() {
    return {
      insertPasteChip:
        (attrs: PasteChipAttributes) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
