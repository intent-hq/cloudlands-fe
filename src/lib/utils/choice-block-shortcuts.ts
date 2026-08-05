import { Extension, InputRule } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

import type { RawCommands } from '@tiptap/core';
import { m } from '$shared/paraglide/messages.js';

/**
 * Choice Block Shortcuts Extension
 *
 * Adds input rules and commands for quickly inserting choice blocks:
 * - Type ```choice and press space to insert a choice block with default content
 * - Use editor.commands.insertChoiceBlock() to insert programmatically
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    choiceBlockShortcuts: {
      insertChoiceBlock: () => ReturnType;
    };
  }
}

export const ChoiceBlockShortcuts = Extension.create({
  name: 'choiceBlockShortcuts',

  addCommands() {
    return {
      insertChoiceBlock:
        () =>
        ({ state, dispatch }: any) => {
          const { schema, tr } = state;
          const { $from } = state.selection;

          // Create the choice block with default structure
          const questionText = m.tiptap_choiceBlock_question_placeholder();
          const choiceBlock = schema.nodes.choiceBlock.create(null, [
            // Question node
            schema.nodes.choiceQuestion.create(null, [
              schema.nodes.paragraph.create(null, [schema.text(questionText)]),
            ]),
            // First option
            schema.nodes.choiceOption.create({ selected: false }, [
              schema.nodes.paragraph.create(null, [
                schema.text(m.tiptap_choiceBlock_option1_placeholder()),
              ]),
            ]),
            // Second option
            schema.nodes.choiceOption.create({ selected: false }, [
              schema.nodes.paragraph.create(null, [
                schema.text(m.tiptap_choiceBlock_option2_placeholder()),
              ]),
            ]),
          ]);

          // Replace the current block with the choice block
          const pos = $from.before($from.depth);
          tr.replaceRangeWith(pos, $from.after($from.depth), choiceBlock);

          // Set selection to the question text
          // The structure is: choiceBlock > choiceQuestion > paragraph > text
          const questionTextPos = pos + 3; // +1 choiceBlock, +1 choiceQuestion, +1 paragraph
          const questionTextEnd = questionTextPos + questionText.length;

          tr.setSelection(TextSelection.create(tr.doc, questionTextPos, questionTextEnd));

          if (dispatch) {
            dispatch(tr);
          }

          return true;
        },
    } as Partial<RawCommands>;
  },

  addInputRules() {
    return [
      // Convert ```choice into a choice block when followed by a space
      new InputRule({
        find: /```choice\s$/,
        handler: ({ state, range }: any) => {
          const { schema, tr } = state;

          // Delete the trigger text
          tr.delete(range.from, range.to);

          // Create the choice block with default structure
          const questionText = m.tiptap_choiceBlock_question_placeholder();
          const choiceBlock = schema.nodes.choiceBlock.create(null, [
            // Question node
            schema.nodes.choiceQuestion.create(null, [
              schema.nodes.paragraph.create(null, [schema.text(questionText)]),
            ]),
            // First option
            schema.nodes.choiceOption.create({ selected: false }, [
              schema.nodes.paragraph.create(null, [
                schema.text(m.tiptap_choiceBlock_option1_placeholder()),
              ]),
            ]),
            // Second option
            schema.nodes.choiceOption.create({ selected: false }, [
              schema.nodes.paragraph.create(null, [
                schema.text(m.tiptap_choiceBlock_option2_placeholder()),
              ]),
            ]),
          ]);

          // Insert the choice block
          tr.insert(range.from, choiceBlock);

          // Set selection to the question text
          // The structure is: choiceBlock > choiceQuestion > paragraph > text
          const questionTextPos = range.from + 3; // +1 choiceBlock, +1 choiceQuestion, +1 paragraph
          const questionTextEnd = questionTextPos + questionText.length;

          tr.setSelection(TextSelection.create(tr.doc, questionTextPos, questionTextEnd));

          return tr;
        },
      }),
    ];
  },
});
