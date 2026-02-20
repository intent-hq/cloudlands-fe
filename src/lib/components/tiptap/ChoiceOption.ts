/**
 * Phase 2.2: ChoiceOption Node (THE CRITICAL PIECE)
 *
 * This node represents a single option in a choice block.
 * It has:
 * - contentDOM for inline text editing (using paragraph content)
 * - selection state (boolean attribute)
 *
 * This is the node that validates the V2 architecture works.
 * Based on the POC that proved contentDOM editing works without focus loss.
 *
 * Key differences from V1:
 * - V1: Atomic node with text in attributes (caused focus loss)
 * - V2: Non-atomic node with text in contentDOM (no focus loss)
 */

import { Node } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { SvelteNodeViewRenderer } from '$lib/utils/tiptap/svelte-node-view';
import ChoiceOptionNodeView from './ChoiceOptionNodeView.svelte';

export const ChoiceOption = Node.create({
  name: 'choiceOption',

  group: 'block',

  // This is the key: content allows nested paragraph with text
  // This enables contentDOM and inline editing
  content: 'paragraph',

  // Not atomic - allows nested content
  atom: false,

  addAttributes() {
    return {
      selected: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-selected') === 'true',
        renderHTML: (attributes) => ({
          'data-selected': attributes.selected,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="choice-option"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      {
        ...HTMLAttributes,
        'data-type': 'choice-option',
        class: 'choice-option',
      },
      0, // Content goes here (the paragraph with text)
    ];
  },

  addNodeView() {
    return SvelteNodeViewRenderer(ChoiceOptionNodeView);
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state, view } = editor;
        const { $from } = state.selection;

        // Check if we're inside a choiceOption by looking at parent nodes
        let choiceOptionDepth = -1;
        for (let d = $from.depth; d >= 0; d--) {
          const node = d === 0 ? $from.doc : $from.node(d);
          if (node.type.name === 'choiceOption') {
            choiceOptionDepth = d;
            break;
          }
        }

        // If not in a choice option, let default behavior handle it
        if (choiceOptionDepth === -1) {
          return false;
        }

        // Get the choice option node and its position
        const choiceOption = $from.node(choiceOptionDepth);
        const choiceOptionPos = $from.before(choiceOptionDepth);

        // Get the paragraph inside the choice option
        const paragraph = choiceOption.firstChild;
        if (!paragraph || paragraph.type.name !== 'paragraph') return false;

        // Calculate position relative to the paragraph content
        const paragraphPos = choiceOptionPos + 1; // +1 to get inside choiceOption
        const relativePos = $from.pos - paragraphPos - 1; // -1 for paragraph node

        // Split the text content at cursor position
        const textContent = paragraph.textContent;
        const textBefore = textContent.substring(0, relativePos);
        const textAfter = textContent.substring(relativePos);

        // Create transaction
        const tr = state.tr;

        // Create the new paragraph for the current option with text before cursor
        const newParagraphBefore = state.schema.nodes.paragraph.create(
          null,
          textBefore ? state.schema.text(textBefore) : null,
        );

        // Create the new option with text after cursor
        const newParagraphAfter = state.schema.nodes.paragraph.create(
          null,
          textAfter ? state.schema.text(textAfter) : null,
        );

        const newOptionNode = state.schema.nodes.choiceOption.create(
          { selected: false },
          newParagraphAfter,
        );

        // Create a new choiceOption with the text before cursor
        const updatedOption = state.schema.nodes.choiceOption.create(
          choiceOption.attrs,
          newParagraphBefore,
        );

        // Replace the entire current option with the updated one
        const optionEnd = choiceOptionPos + choiceOption.nodeSize;
        tr.replaceWith(choiceOptionPos, optionEnd, updatedOption);

        // Insert the new option after the updated one
        // After replacement, the updated option ends at choiceOptionPos + updatedOption.nodeSize
        const insertPos = choiceOptionPos + updatedOption.nodeSize;
        tr.insert(insertPos, newOptionNode);

        // Set cursor to start of new option's paragraph content
        // The new option starts at insertPos
        // +1 for choiceOption node, +1 for paragraph node
        const newCursorPos = insertPos + 2;
        tr.setSelection(TextSelection.create(tr.doc, newCursorPos));

        view.dispatch(tr);
        return true;
      },
    };
  },
});
