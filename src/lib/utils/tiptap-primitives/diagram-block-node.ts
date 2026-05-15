/**
 * TipTap Diagram Block Node
 *
 * Custom TipTap node for diagram primitives
 */

import {
  Node,
  mergeAttributes,
} from '@tiptap/core';
import { SvelteNodeViewRenderer } from 'svelte-tiptap';
import type { DiagramPrimitive } from '../../../shared/types/notes-primitives';
import DiagramBlock from '../../components/notes/primitives/DiagramBlock.svelte';
import { decodeBase64Unicode } from './index';

export interface DiagramBlockOptions {
  HTMLAttributes: Record<string, any>;
  workspaceId?: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    diagramBlock: {
      /**
       * Insert a diagram block
       */
      insertDiagramBlock: (primitive: DiagramPrimitive) => ReturnType;
      /**
       * Update a diagram block
       */
      updateDiagramBlock: (id: string, updates: Partial<DiagramPrimitive>) => ReturnType;
    };
  }
}

export const DiagramBlockNode = Node.create<DiagramBlockOptions>({
  name: 'diagram_block',

  group: 'block',

  atom: true,

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      workspaceId: undefined,
    };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-id'),
        renderHTML: (attributes) => {
          if (!attributes.id) {
            return {};
          }
          return {
            'data-id': attributes.id,
          };
        },
      },
      data: {
        default: null,
        parseHTML: (element) => {
          const data = element.getAttribute('data-primitive');
          return data ? JSON.parse(data) : null;
        },
        renderHTML: (attributes) => {
          if (!attributes.data) {
            return {};
          }
          return {
            'data-primitive': JSON.stringify(attributes.data),
          };
        },
      },
    };
  },

  addCommands() {
    return {
      insertDiagramBlock:
        (primitive: DiagramPrimitive) =>
          ({ commands }) =>
            commands.insertContent({
              type: this.name,
              attrs: {
                id: primitive.id,
                data: primitive,
              },
            }),
      updateDiagramBlock:
        (id: string, updates: Partial<DiagramPrimitive>) =>
          ({ tr, state }) => {
            const { doc } = state;
            let updated = false;

            doc.descendants((node, pos) => {
              if (node.type.name === this.name && node.attrs.id === id) {
                const newData = { ...node.attrs.data, ...updates };
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  data: newData,
                });
                updated = true;
                return false;
              }
            });

            return updated;
          },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-primitive-type="diagram"]',
        getAttrs: (dom: HTMLElement) => {
          // Try base64 encoded data first (new format)
          const base64Data = dom.getAttribute('data-primitive-base64');
          if (base64Data) {
            try {
              const json = decodeBase64Unicode(base64Data);
              const primitive = JSON.parse(json);
              return {
                id: primitive.id,
                data: primitive,
              };
            } catch {
              // Failed to parse base64 diagram primitive
            }
          }

          // Fall back to direct JSON (old format)
          const data = dom.getAttribute('data-primitive');
          if (data) {
            try {
              const primitive = JSON.parse(data);
              return {
                id: primitive.id,
                data: primitive,
              };
            } catch {
              // Failed to parse diagram primitive
            }
          }
          return false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // No content hole (0) for atom nodes - they're leaf nodes without content
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'diagram_block' })];
  },

  addNodeView() {
    return SvelteNodeViewRenderer(DiagramBlock);
  },
});
