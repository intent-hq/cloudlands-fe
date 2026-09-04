/**
 * TipTap Mermaid Block Node
 *
 * Custom TipTap node for rendering mermaid diagrams in notes.
 * Converts ```mermaid code blocks into interactive rendered diagrams.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { SvelteNodeViewRenderer } from '$lib/utils/tiptap/svelte-node-view';
import MermaidBlockNodeView from './MermaidBlockNodeView.svelte';

export interface MermaidBlockOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mermaidBlock: {
      /**
       * Insert a mermaid block
       */
      insertMermaidBlock: (code: string) => ReturnType;
    };
  }
}

export const MermaidBlock = Node.create<MermaidBlockOptions>({
  name: 'mermaidBlock',

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
            'data-mermaid-code': attributes.code,
          };
        },
      },
    };
  },

  addCommands() {
    return {
      insertMermaidBlock:
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
        tag: 'div[data-type="mermaid-block"]',
        getAttrs: (element: HTMLElement) => {
          const code = element.getAttribute('data-mermaid-code') || '';
          return { code };
        },
      },
      // Also parse pre>code.language-mermaid for standard markdown code blocks
      {
        tag: 'pre',
        getAttrs: (element: HTMLElement) => {
          const codeEl = element.querySelector('code.language-mermaid');
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
        'data-type': 'mermaid-block',
      }),
    ];
  },

  addNodeView() {
    return SvelteNodeViewRenderer(MermaidBlockNodeView);
  },
});
