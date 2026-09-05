import { Node, mergeAttributes } from '@tiptap/core';
import { SvelteNodeViewRenderer } from 'svelte-tiptap';
import type { DiffMapPrimitive } from '../../../shared/types/notes-primitives';
import DiffMapBlock from '../../components/notes/primitives/DiffMapBlock.svelte';
import { decodeBase64Unicode } from './index';

export interface DiffMapBlockOptions {
  HTMLAttributes: Record<string, unknown>;
  workspaceId?: string;
}

export const DiffMapBlockNode = Node.create<DiffMapBlockOptions>({
  name: 'diffmap_block',
  group: 'block',
  atom: true,
  draggable: true,

  addOptions() {
    return { HTMLAttributes: {}, workspaceId: undefined };
  },

  addAttributes() {
    return {
      id: { default: null },
      data: {
        default: null,
        renderHTML: (attributes) =>
          attributes.data ? { 'data-primitive': JSON.stringify(attributes.data) } : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-primitive-type="diffmap"]',
        getAttrs: (dom: HTMLElement) => {
          const encoded = dom.getAttribute('data-primitive-base64');
          const direct = dom.getAttribute('data-primitive');
          try {
            const primitive = JSON.parse(encoded ? decodeBase64Unicode(encoded) : (direct ?? ''));
            return { id: primitive.id, data: primitive };
          } catch {
            return false;
          }
        },
      },
      {
        tag: 'div[data-type="diffmap_block"]',
        getAttrs: (dom: HTMLElement) => {
          try {
            const primitive = JSON.parse(dom.getAttribute('data-primitive') ?? '');
            return { id: primitive.id, data: primitive };
          } catch {
            return false;
          }
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'diffmap_block' })];
  },

  addNodeView() {
    return SvelteNodeViewRenderer(DiffMapBlock);
  },

  addCommands() {
    return {
      insertDiffMapBlock:
        (primitive: DiffMapPrimitive) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { id: primitive.id, data: primitive },
          }),
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    diffMapBlock: {
      insertDiffMapBlock: (primitive: DiffMapPrimitive) => ReturnType;
    };
  }
}
