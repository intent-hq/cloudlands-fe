import { Node, mergeAttributes } from '@tiptap/core';
import { SvelteNodeViewRenderer } from 'svelte-tiptap';
import { ArtifactPrimitiveSchema } from '../../../shared/types/notes-primitives';
import ArtifactNodeView from '../../../features/artifacts/ArtifactNodeView.svelte';
import { decodeBase64Unicode } from './index';

export const ArtifactBlockNode = Node.create<{ workspaceId?: string }>({
  name: 'artifact_block',
  group: 'block',
  atom: true,
  draggable: true,
  addOptions() {
    return { workspaceId: undefined };
  },
  addAttributes() {
    return {
      id: { default: null },
      data: {
        default: null,
        renderHTML: (attrs) => ({ 'data-primitive': JSON.stringify(attrs.data) }),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-primitive-type="artifact"],div[data-type="artifact_block"]',
        getAttrs: (element: HTMLElement) => {
          try {
            const encoded = element.getAttribute('data-primitive-base64');
            const raw = encoded
              ? decodeBase64Unicode(encoded)
              : element.getAttribute('data-primitive');
            const result = ArtifactPrimitiveSchema.safeParse(JSON.parse(raw ?? 'null'));
            return result.success ? { id: result.data.id, data: result.data } : false;
          } catch {
            return false;
          }
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'artifact_block' })];
  },
  addNodeView() {
    return SvelteNodeViewRenderer(ArtifactNodeView);
  },
});
