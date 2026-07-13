import { Heading } from '@tiptap/extension-heading';
import { SvelteNodeViewRenderer } from '$lib/utils/tiptap/svelte-node-view';
import HeadingNodeView from './HeadingNodeView.svelte';

export interface CustomHeadingOptions {
  levels: number[];
  HTMLAttributes: Record<string, any>;
}

/**
 * Custom Heading extension for TipTap
 *
 * Features:
 * - Custom node view with Svelte component (HeadingNodeView)
 * - "Start all tasks" button for sections with incomplete tasks
 * - Shows button on hover
 */
export const CustomHeading = Heading.extend<CustomHeadingOptions>({
  name: 'heading',

  addOptions() {
    return {
      levels: [1, 2, 3, 4, 5, 6],
      HTMLAttributes: {},
      ...this.parent?.(),
    };
  },

  addNodeView() {
    return SvelteNodeViewRenderer(HeadingNodeView);
  },
});

export default CustomHeading;
