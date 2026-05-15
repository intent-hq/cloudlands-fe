/**
 * TipTap Reference Block Node
 *
 * Custom TipTap node for reference primitives
 */

import {
  Node,
  mergeAttributes,
} from '@tiptap/core';
import { SvelteNodeViewRenderer } from 'svelte-tiptap';
import type { ReferencePrimitive } from '../../../shared/types/notes-primitives';
import ReferenceBlock from '../../components/notes/primitives/ReferenceBlock.svelte';
import { decodeBase64Unicode } from './index';

export interface ReferenceBlockOptions {
  HTMLAttributes: Record<string, any>;
  workspaceId?: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    referenceBlock: {
      /**
       * Insert a reference block
       */
      insertReferenceBlock: (primitive: ReferencePrimitive) => ReturnType;
      /**
       * Update a reference block
       */
      updateReferenceBlock: (id: string, updates: Partial<ReferencePrimitive>) => ReturnType;
    };
  }
}

export const ReferenceBlockNode = Node.create<ReferenceBlockOptions>({
  name: 'reference_block',

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

  parseHTML() {
    return [
      {
        tag: 'div[data-type="reference_block"]',
        getAttrs: (dom: HTMLElement) => {
          // Try base64 encoded data first (new format)
          const base64Data = dom.getAttribute('data-primitive-base64');
          if (base64Data) {
            try {
              const json = decodeBase64Unicode(base64Data);
              const primitive = JSON.parse(json);
              const id = dom.getAttribute('data-id');
              return {
                id: id || primitive.id,
                data: primitive,
              };
            } catch {
              // Failed to parse base64 reference primitive
            }
          }

          // Fall back to direct JSON (old format)
          const data = dom.getAttribute('data-primitive');
          const id = dom.getAttribute('data-id');
          if (data) {
            try {
              const primitive = JSON.parse(data);
              return {
                id: id || primitive.id,
                data: primitive,
              };
            } catch {
              // Failed to parse reference primitive
            }
          }
          // Return false to reject this node if no data
          // This prevents creating empty nodes that lose their data on save
          return false;
        },
      },
      {
        tag: 'div[data-primitive-type="reference"]',
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
              // Failed to parse base64 reference primitive
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
              // Failed to parse reference primitive
            }
          }
          return false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // No content hole (0) for atom nodes - they're leaf nodes without content
    const merged = mergeAttributes(HTMLAttributes, { 'data-type': 'reference_block' });
    return ['div', merged];
  },

  addNodeView() {
    return SvelteNodeViewRenderer(ReferenceBlock);
  },

  addCommands() {
    return {
      insertReferenceBlock:
        (primitive: ReferencePrimitive) =>
          ({ commands }) =>
            commands.insertContent({
              type: this.name,
              attrs: {
                id: primitive.id,
                data: primitive,
              },
            }),

      updateReferenceBlock:
        (id: string, updates: Partial<ReferencePrimitive>) =>
          ({ state, dispatch }) => {
            const { doc, tr } = state;
            let found = false;

            doc.descendants((node, pos) => {
              if (node.type.name === this.name && node.attrs.id === id) {
                const currentData = node.attrs.data as ReferencePrimitive;
                const updatedData = { ...currentData, ...updates };

                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  data: updatedData,
                });

                found = true;
                return false; // Stop searching
              }
            });

            if (found && dispatch) {
              dispatch(tr);
              return true;
            }

            return false;
          },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Delete with Backspace
      Backspace: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        const { $from } = selection;

        if ($from.parent.type.name === this.name) {
          return editor.commands.deleteSelection();
        }

        return false;
      },
    };
  },
});
