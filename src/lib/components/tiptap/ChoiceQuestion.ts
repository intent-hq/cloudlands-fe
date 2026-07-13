/**
 * Phase 2.3: ChoiceQuestion Node
 *
 * This node represents the question text in a choice block.
 * It's simpler than choiceOption - just editable text, no selection state.
 *
 * Key features:
 * - contentDOM for inline text editing (using paragraph content)
 * - No attributes (just plain editable text)
 * - Uses the same pattern as ChoiceOption
 */

import { Node } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { SvelteNodeViewRenderer } from '$lib/utils/tiptap/svelte-node-view';
import ChoiceQuestionNodeView from './ChoiceQuestionNodeView.svelte';

export const ChoiceQuestion = Node.create({
  name: 'choiceQuestion',

  group: 'block',

  // Content allows nested paragraph with text (enables contentDOM)
  content: 'paragraph',

  // Not atomic - allows nested content
  atom: false,

  parseHTML() {
    return [
      {
        tag: 'div[data-type="choice-question"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      {
        ...HTMLAttributes,
        'data-type': 'choice-question',
        class: 'choice-question',
      },
      0, // Content goes here (the paragraph with text)
    ];
  },

  addNodeView() {
    return SvelteNodeViewRenderer(ChoiceQuestionNodeView);
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state } = this.editor;
        const result = this.editor.commands.command(({ tr, dispatch }) => {
          const { $from } = state.selection;

          // Check if we're inside a choiceQuestion
          let choiceQuestionDepth = -1;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'choiceQuestion') {
              choiceQuestionDepth = d;
              break;
            }
          }

          // If not in a choice question, let default behavior handle it
          if (choiceQuestionDepth === -1) {
            return false;
          }

          // Get the choice question node and its position
          const choiceQuestion = $from.node(choiceQuestionDepth);
          const choiceQuestionPos = $from.before(choiceQuestionDepth);

          // Get the paragraph inside the choice question
          const paragraph = choiceQuestion.firstChild;
          if (!paragraph) return false;

          // Calculate position inside the paragraph
          const paragraphStart = choiceQuestionPos + 1; // +1 to get inside choiceQuestion
          const cursorPosInParagraph = $from.pos - paragraphStart - 1; // -1 for paragraph node itself

          // Check if cursor is at the very start (position 0)
          if (cursorPosInParagraph === 0) {
            // Behavior 1: Insert a new paragraph ABOVE the choice block
            // Find the parent choiceBlock
            let choiceBlockDepth = -1;
            for (let d = $from.depth; d > 0; d--) {
              if ($from.node(d).type.name === 'choiceBlock') {
                choiceBlockDepth = d;
                break;
              }
            }

            if (choiceBlockDepth === -1) {
              // Not in a choiceBlock, let default behavior handle it
              return false;
            }

            const choiceBlockPos = $from.before(choiceBlockDepth);

            // Insert a new paragraph before the choice block
            const newParagraph = state.schema.nodes.paragraph.create();
            tr.insert(choiceBlockPos, newParagraph);

            // Set cursor in the new paragraph
            tr.setSelection(TextSelection.create(tr.doc, choiceBlockPos + 1));

            if (dispatch) {
              dispatch(tr);
            }
            return true;
          }

          // Behavior 2: Insert a new first option with text after cursor
          // Split the question text at cursor position
          const textBefore = paragraph.textContent.substring(0, cursorPosInParagraph);
          const textAfter = paragraph.textContent.substring(cursorPosInParagraph);

          // Replace the question paragraph content with text before cursor
          const paragraphPos = paragraphStart + 1; // +1 to get inside paragraph
          const paragraphEndPos = paragraphPos + paragraph.content.size;
          tr.replaceWith(
            paragraphPos,
            paragraphEndPos,
            textBefore ? state.schema.text(textBefore) : [],
          );

          // Create new option with text after cursor
          const newOptionNode = state.schema.nodeFromJSON({
            type: 'choiceOption',
            attrs: {
              selected: false,
            },
            content: [
              {
                type: 'paragraph',
                content: textAfter ? [{ type: 'text', text: textAfter }] : [],
              },
            ],
          });

          // Calculate where to insert the new option (right after the question)
          const textBeforeSize = textBefore.length;
          const newQuestionSize =
            1 + // choiceQuestion opening
            1 + // paragraph opening
            textBeforeSize + // text content
            1 + // paragraph closing
            1; // choiceQuestion closing

          const insertPos = choiceQuestionPos + newQuestionSize;

          // Insert the new option as the first option
          tr.insert(insertPos, newOptionNode);

          // Set cursor to start of new option's paragraph
          const newOptionParagraphPos = insertPos + 2; // +1 for choiceOption, +1 for paragraph
          tr.setSelection(TextSelection.create(tr.doc, newOptionParagraphPos));

          if (dispatch) {
            dispatch(tr);
          }
          return true;
        });

        return result;
      },
    };
  },
});
