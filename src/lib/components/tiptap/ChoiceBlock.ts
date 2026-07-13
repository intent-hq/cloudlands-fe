/**
 * Phase 2.1: ChoiceBlock Container Node
 *
 * This is a container node that holds choiceQuestion and choiceOption nodes.
 * It's non-atomic and allows nested content.
 *
 * For Phase 2.1, we start simple:
 * - Just a container with basic structure
 * - Allows paragraph content initially (for testing)
 * - Will be updated in later phases to restrict content to choiceQuestion/choiceOption
 *
 * This node corresponds to the ```choice block in markdown.
 */

import { Node } from '@tiptap/core';
import { SvelteNodeViewRenderer } from '$lib/utils/tiptap/svelte-node-view';
import ChoiceBlockNodeView from './ChoiceBlockNodeView.svelte';

export const ChoiceBlock = Node.create({
  name: 'choiceBlock',

  group: 'block',

  // Phase 2.4: Require proper structure - one question, one or more options
  content: 'choiceQuestion choiceOption+',

  // Not atomic - allows nested content
  atom: false,

  parseHTML() {
    return [
      {
        tag: 'div[data-type="choice-block"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      {
        ...HTMLAttributes,
        'data-type': 'choice-block',
        // Tailwind classes for container styling with dark mode support
        class: 'choice-block my-4 p-4 border border-muted rounded-lg bg-muted/30',
      },
      0, // Content goes here
    ];
  },

  addNodeView() {
    return SvelteNodeViewRenderer(ChoiceBlockNodeView);
  },
});
