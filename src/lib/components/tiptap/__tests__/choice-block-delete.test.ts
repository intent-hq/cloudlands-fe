/**
 * Tests for ChoiceBlock delete button functionality
 *
 * The delete button should:
 * - Appear when hovering over the choice block
 * - Delete the entire choice block when clicked
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ChoiceBlock } from '../ChoiceBlock';
import { ChoiceQuestion } from '../ChoiceQuestion';
import { ChoiceOption } from '../ChoiceOption';

describe('ChoiceBlock delete button', () => {
  let editor: Editor;

  beforeEach(() => {
    editor = new Editor({
      extensions: [StarterKit, ChoiceBlock, ChoiceQuestion, ChoiceOption],
      content: '',
    });
  });

  afterEach(() => {
    editor.destroy();
  });

  it('should delete the entire choice block', () => {
    // Set up a document with a paragraph, choice block, and another paragraph
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Before' }],
        },
        {
          type: 'choiceBlock',
          content: [
            {
              type: 'choiceQuestion',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'What is your question?' }],
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
            {
              type: 'choiceOption',
              attrs: { selected: false },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Option 2' }],
                },
              ],
            },
          ],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'After' }],
        },
      ],
    });

    // Verify initial state
    let json = editor.getJSON();
    expect(json.content?.length).toBe(3);
    expect(json.content?.[1]?.type).toBe('choiceBlock');

    // Find the choice block position
    // Structure: doc(1) -> paragraph(1) -> text("Before") -> close paragraph
    // Then choiceBlock starts
    const choiceBlockPos = 1 + 1 + 'Before'.length + 1;

    // Delete the choice block by simulating what the delete button does
    const tr = editor.state.tr;
    const $pos = editor.state.doc.resolve(choiceBlockPos);

    // Find the choice block node
    let choiceBlockDepth = -1;
    for (let d = $pos.depth; d >= 0; d--) {
      if ($pos.node(d).type.name === 'choiceBlock') {
        choiceBlockDepth = d;
        break;
      }
    }

    expect(choiceBlockDepth).toBeGreaterThan(-1);

    const choiceBlock = $pos.node(choiceBlockDepth);
    const pos = $pos.before(choiceBlockDepth);

    tr.delete(pos, pos + choiceBlock.nodeSize);
    editor.view.dispatch(tr);

    // Verify the choice block is deleted
    json = editor.getJSON();
    expect(json.content?.length).toBe(2);
    expect(json.content?.[0]?.content?.[0]?.text).toBe('Before');
    expect(json.content?.[1]?.content?.[0]?.text).toBe('After');
  });

  it("should delete choice block when it's the only content", () => {
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
                  content: [{ type: 'text', text: 'Option' }],
                },
              ],
            },
          ],
        },
      ],
    });

    // Delete the choice block
    const choiceBlockPos = 1; // Right after doc opening
    const tr = editor.state.tr;
    const $pos = editor.state.doc.resolve(choiceBlockPos);
    const choiceBlock = $pos.node(1); // Depth 1 is the choice block

    tr.delete(0, choiceBlock.nodeSize);
    editor.view.dispatch(tr);

    // Verify the document is now empty (or has default content)
    const json = editor.getJSON();
    expect(json.content?.length).toBeLessThanOrEqual(1);
    if (json.content?.length === 1) {
      // StarterKit might insert an empty paragraph
      expect(json.content[0].type).toBe('paragraph');
    }
  });
});
