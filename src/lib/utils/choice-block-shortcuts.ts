import { Extension } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { InputRule } from '@tiptap/core';
import type { RawCommands } from '@tiptap/core';

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
            const choiceBlock = schema.nodes.choiceBlock.create(null, [
            // Question node
              schema.nodes.choiceQuestion.create(null, [
                schema.nodes.paragraph.create(null, [schema.text('Your question here?')]),
              ]),
              // First option
              schema.nodes.choiceOption.create({ selected: false }, [
                schema.nodes.paragraph.create(null, [schema.text('Option 1')]),
              ]),
              // Second option
              schema.nodes.choiceOption.create({ selected: false }, [
                schema.nodes.paragraph.create(null, [schema.text('Option 2')]),
              ]),
            ]);

            // Replace the current block with the choice block
            const pos = $from.before($from.depth);
            tr.replaceRangeWith(pos, $from.after($from.depth), choiceBlock);

            // Set selection to the question text
            // The structure is: choiceBlock > choiceQuestion > paragraph > text
            const questionTextPos = pos + 3; // +1 choiceBlock, +1 choiceQuestion, +1 paragraph
            const questionTextEnd = questionTextPos + 'Your question here?'.length;

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
          const choiceBlock = schema.nodes.choiceBlock.create(null, [
            // Question node
            schema.nodes.choiceQuestion.create(null, [
              schema.nodes.paragraph.create(null, [schema.text('Your question here?')]),
            ]),
            // First option
            schema.nodes.choiceOption.create({ selected: false }, [
              schema.nodes.paragraph.create(null, [schema.text('Option 1')]),
            ]),
            // Second option
            schema.nodes.choiceOption.create({ selected: false }, [
              schema.nodes.paragraph.create(null, [schema.text('Option 2')]),
            ]),
          ]);

          // Insert the choice block
          tr.insert(range.from, choiceBlock);

          // Set selection to the question text
          // The structure is: choiceBlock > choiceQuestion > paragraph > text
          const questionTextPos = range.from + 3; // +1 choiceBlock, +1 choiceQuestion, +1 paragraph
          const questionTextEnd = questionTextPos + 'Your question here?'.length;

          tr.setSelection(TextSelection.create(tr.doc, questionTextPos, questionTextEnd));

          return tr;
        },
      }),
    ];
  },
});
