import Image, { type ImageOptions } from '@tiptap/extension-image';
import { SvelteNodeViewRenderer } from '$lib/utils/tiptap/svelte-node-view';
import NoteImageNodeView from './NoteImageNodeView.svelte';

/** Note image extension with lightbox and image-action controls. */
interface NoteImageOptions extends ImageOptions {
  workspaceId?: string;
}

export const NoteImage = Image.extend<NoteImageOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      workspaceId: undefined as string | undefined,
    } as NoteImageOptions;
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      mediaUnsupported: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-media-unsupported'),
        renderHTML: (attributes) =>
          attributes.mediaUnsupported
            ? { 'data-media-unsupported': attributes.mediaUnsupported }
            : {},
      },
    };
  },

  addNodeView() {
    return SvelteNodeViewRenderer(NoteImageNodeView);
  },
});
