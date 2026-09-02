import Image from '@tiptap/extension-image';
import { SvelteNodeViewRenderer } from '$lib/utils/tiptap/svelte-node-view';
import NoteImageNodeView from './NoteImageNodeView.svelte';

/** Note image extension with lightbox and image-action controls. */
export const NoteImage = Image.extend({
  addNodeView() {
    return SvelteNodeViewRenderer(NoteImageNodeView);
  },
});
