import { mergeAttributes, Node } from '@tiptap/core';
import { SvelteNodeViewRenderer } from '$lib/utils/tiptap/svelte-node-view';
import NoteVideoNodeView from './NoteVideoNodeView.svelte';

interface NoteVideoOptions {
  workspaceId?: string;
}

/** Workspace video extension with fallback, actions, and lightbox controls. */
export const NoteVideo = Node.create<NoteVideoOptions>({
  name: 'video',
  group: 'block',
  atom: true,
  selectable: true,
  addOptions() {
    return { workspaceId: undefined as string | undefined };
  },
  addAttributes() {
    return {
      src: { default: null },
      name: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-name'),
        renderHTML: (attributes) => (attributes.name ? { 'data-name': attributes.name } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'video.markdown-video' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'video',
      mergeAttributes(HTMLAttributes, {
        class: 'markdown-video',
        controls: '',
        preload: 'metadata',
        playsinline: '',
      }),
    ];
  },
  addNodeView() {
    return SvelteNodeViewRenderer(NoteVideoNodeView);
  },
});
