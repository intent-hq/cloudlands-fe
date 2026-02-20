/**
 * TipTap Agent Action Block Node
 *
 * Custom TipTap node for agent action primitives
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { SvelteNodeViewRenderer } from 'svelte-tiptap';
import type { AgentActionPrimitive } from '../../../shared/types/notes-primitives';
import AgentActionBlock from '../../components/notes/primitives/AgentActionBlock.svelte';
import { decodeBase64Unicode } from './index';

export interface AgentActionBlockOptions {
  HTMLAttributes: Record<string, any>;
  workspaceId?: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    agentActionBlock: {
      /**
       * Insert an agent action block
       */
      insertAgentActionBlock: (primitive: AgentActionPrimitive) => ReturnType;
      /**
       * Update an agent action block
       */
      updateAgentActionBlock: (id: string, updates: Partial<AgentActionPrimitive>) => ReturnType;
    };
  }
}

export const AgentActionBlockNode = Node.create<AgentActionBlockOptions>({
  name: 'agent_action_block',

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
        tag: 'div[data-type="agent_action_block"]',
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
              // Failed to parse base64 agent action primitive
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
              // Failed to parse agent action primitive
            }
          }
          // Return false to reject this node if no data
          // This prevents creating empty nodes that lose their data on save
          return false;
        },
      },
      {
        tag: 'div[data-primitive-type="agent_action"]',
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
              // Failed to parse base64 agent action primitive
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
              // Failed to parse agent action primitive
            }
          }
          return false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // No content hole (0) for atom nodes - they're leaf nodes without content
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'agent_action_block' })];
  },

  addNodeView() {
    return SvelteNodeViewRenderer(AgentActionBlock);
  },

  addCommands() {
    return {
      insertAgentActionBlock:
        (primitive: AgentActionPrimitive) =>
          ({ commands }) =>
            commands.insertContent({
              type: this.name,
              attrs: {
                id: primitive.id,
                data: primitive,
              },
            }),

      updateAgentActionBlock:
        (id: string, updates: Partial<AgentActionPrimitive>) =>
          ({ state, dispatch }) => {
            const { doc, tr } = state;
            let found = false;

            doc.descendants((node, pos) => {
              if (node.type.name === this.name && node.attrs.id === id) {
                const currentData = node.attrs.data as AgentActionPrimitive;
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
      // Run action with Cmd+Enter
      'Mod-Enter': ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        const { $from } = selection;

        if ($from.parent.type.name === this.name) {
          // Trigger run action event
          const node = $from.parent;
          const primitive = node.attrs.data as AgentActionPrimitive;
          if (primitive) {
            // Dispatch custom event for running the action
            window.dispatchEvent(new CustomEvent('run-agent-action', { detail: primitive }));
            return true;
          }
        }

        return false;
      },
    };
  },
});
