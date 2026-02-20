/**
 * Tests for Enter key behavior in ChoiceOption nodes
 *
 * When pressing Enter inside a choice option, it should:
 * 1. Split the current option at the cursor position
 * 2. Create a new option below with the text after the cursor
 * 3. Leave the text before the cursor in the current option
 * 4. Move the cursor to the beginning of the new option
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ChoiceBlock } from '../ChoiceBlock';
import { ChoiceQuestion } from '../ChoiceQuestion';
import { ChoiceOption } from '../ChoiceOption';

describe('ChoiceOption Enter key behavior', () => {
  let editor: Editor;

  beforeEach(() => {
    editor = new Editor({
      extensions: [
        // Put our extensions first so they have priority
        ChoiceOption,
        ChoiceQuestion,
        ChoiceBlock,
        StarterKit,
      ],
      content: '',
    });
  });

  afterEach(() => {
    editor.destroy();
  });

  it('should split option at cursor position when pressing Enter', () => {
    // Set up a choice block with one option
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'choiceBlock',
          content: [
            {
              type: 'choiceQuestion',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Question?' }],
                },
              ],
            },
            {
              type: 'choiceOption',
              attrs: { selected: false },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Option text here' }],
                },
              ],
            },
          ],
        },
      ],
    });

    // Position cursor in the middle of "Option text here" (after "Option ")
    // The document structure is:
    // doc -> choiceBlock -> choiceQuestion -> paragraph -> text("Question?")
    //                    -> choiceOption -> paragraph -> text("Option text here")
    //
    // Position calculation:
    // - Start of doc: 0
    // - Start of choiceBlock: 1
    // - Start of choiceQuestion: 2
    // - Start of paragraph in question: 3
    // - Text starts at: 3
    // - End of "Question?" text: 3 + 9 = 12
    // - End of paragraph in question: 13
    // - End of choiceQuestion: 14
    // - Start of choiceOption: 15
    // - Start of paragraph in option: 16
    // - Text starts at: 16
    // - Position after "Option " (7 chars): 16 + 7 = 23
    const cursorPos = 23;
    editor.commands.setTextSelection(cursorPos);

    // Press Enter by simulating the actual keyboard event
    const { view } = editor;
    const event = new KeyboardEvent('keydown', { key: 'Enter' });
    view.someProp('handleKeyDown', (f) => f(view, event));

    // Check the result
    const json = editor.getJSON();
    const choiceBlock = json.content?.[0];

    expect(choiceBlock?.type).toBe('choiceBlock');
    expect(choiceBlock?.content?.length).toBe(3); // question + 2 options

    // First option should have "Option "
    const firstOption = choiceBlock?.content?.[1];
    expect(firstOption?.type).toBe('choiceOption');
    expect(firstOption?.content?.[0]?.content?.[0]?.text).toBe('Option ');

    // Second option should have "text here"
    const secondOption = choiceBlock?.content?.[2];
    expect(secondOption?.type).toBe('choiceOption');
    expect(secondOption?.content?.[0]?.content?.[0]?.text).toBe('text here');
  });

  it('should create empty option when pressing Enter at end of option', () => {
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'choiceBlock',
          content: [
            {
              type: 'choiceQuestion',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Question?' }],
                },
              ],
            },
            {
              type: 'choiceOption',
              attrs: { selected: false },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Option 1' }],
                },
              ],
            },
          ],
        },
      ],
    });

    // Position cursor at end of "Option 1"
    // Following the same structure as above:
    // Position after "Option 1" (8 chars): 16 + 8 = 24
    const cursorPos = 24;
    editor.commands.setTextSelection(cursorPos);

    // Press Enter by simulating the actual keyboard event
    const { view } = editor;
    const event = new KeyboardEvent('keydown', { key: 'Enter' });
    view.someProp('handleKeyDown', (f) => f(view, event));

    // Check the result
    const json = editor.getJSON();
    const choiceBlock = json.content?.[0];

    expect(choiceBlock?.content?.length).toBe(3); // question + 2 options

    // First option should still have "Option 1"
    const firstOption = choiceBlock?.content?.[1];
    expect(firstOption?.content?.[0]?.content?.[0]?.text).toBe('Option 1');

    // Second option should be empty
    const secondOption = choiceBlock?.content?.[2];
    expect(secondOption?.type).toBe('choiceOption');
    expect(secondOption?.content?.[0]?.content).toBeUndefined(); // Empty paragraph
  });
});
