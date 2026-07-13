/**
 * TipTap Diff Block Node
 *
 * Custom TipTap node for rendering diff patches in notes.
 * Converts ```diff code blocks into rendered diff viewers.
 */

import {
  Node,
  mergeAttributes,
} from '@tiptap/core';
import { SvelteNodeViewRenderer } from '$lib/utils/tiptap/svelte-node-view';
import DiffBlockNodeView from './DiffBlockNodeView.svelte';

export interface DiffBlockOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    diffBlock: {
      /**
       * Insert a diff block
       */
      insertDiffBlock: (code: string) => ReturnType;
    };
  }
}

export const DiffBlock = Node.create<DiffBlockOptions>({
  name: 'diffBlock',

  group: 'block',

  // Atomic - the whole block is a single unit
  atom: true,

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      code: {
        default: '',
        renderHTML: (attributes) => {
          return {
            'data-diff-code': attributes.code,
          };
        },
      },
    };
  },

  addCommands() {
    return {
      insertDiffBlock:
        (code: string) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { code },
          }),
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="diff-block"]',
        getAttrs: (element: HTMLElement) => {
          const code = element.getAttribute('data-diff-code') || '';
          return { code };
        },
      },
      // Also parse pre>code.language-diff for standard markdown code blocks
      {
        tag: 'pre',
        getAttrs: (element: HTMLElement) => {
          const codeEl = element.querySelector('code.language-diff');
          if (!codeEl) return false;
          return { code: codeEl.textContent || '' };
        },
        priority: 100, // Higher priority than default code block
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'diff-block',
      }),
    ];
  },

  addNodeView() {
    return SvelteNodeViewRenderer(DiffBlockNodeView);
  },
});
