/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { ChoiceBlock } from '$lib/components/tiptap/ChoiceBlock';
import { ChoiceQuestion } from '$lib/components/tiptap/ChoiceQuestion';
import { ChoiceOption } from '$lib/components/tiptap/ChoiceOption';
import { ChoiceBlockShortcuts } from '../choice-block-shortcuts';

describe('ChoiceBlockShortcuts', () => {
  let editor: Editor | null = null;
  let editorElement: HTMLElement;

  beforeEach(() => {
    // Create a container element for the editor
    editorElement = document.createElement('div');
    document.body.appendChild(editorElement);
  });

  afterEach(() => {
    if (editor) {
      editor.destroy();
      editor = null;
    }
    if (editorElement && editorElement.parentNode) {
      editorElement.parentNode.removeChild(editorElement);
    }
  });

  describe('Choice Block Command and Input Rule', () => {
    it('should insert a choice block using the command', () => {
      editor = new Editor({
        element: editorElement,
        extensions: [
          Document,
          Paragraph,
          Text,
          ChoiceBlock,
          ChoiceQuestion,
          ChoiceOption,
          ChoiceBlockShortcuts,
        ],
        content: '<p></p>',
      });

      // Use the command to insert a choice block
      editor.commands.insertChoiceBlock();

      // Get the document content
      const json = editor.getJSON();

      // Should have a choice block
      expect(json.content).toBeDefined();
      expect(json.content?.length).toBeGreaterThan(0);

      const firstNode = json.content?.[0];
      expect(firstNode?.type).toBe('choiceBlock');

      // Should have question and options
      expect(firstNode?.content).toBeDefined();
      expect(firstNode?.content?.length).toBe(3); // 1 question + 2 options

      // Check question
      const question = firstNode?.content?.[0];
      expect(question?.type).toBe('choiceQuestion');
      expect(question?.content?.[0]?.type).toBe('paragraph');
      expect(question?.content?.[0]?.content?.[0]?.text).toBe('Your question here?');

      // Check first option
      const option1 = firstNode?.content?.[1];
      expect(option1?.type).toBe('choiceOption');
      expect(option1?.attrs?.selected).toBe(false);
      expect(option1?.content?.[0]?.type).toBe('paragraph');
      expect(option1?.content?.[0]?.content?.[0]?.text).toBe('Option 1');

      // Check second option
      const option2 = firstNode?.content?.[2];
      expect(option2?.type).toBe('choiceOption');
      expect(option2?.attrs?.selected).toBe(false);
      expect(option2?.content?.[0]?.type).toBe('paragraph');
      expect(option2?.content?.[0]?.content?.[0]?.text).toBe('Option 2');
    });

    it('should select the question text after insertion for easy editing', () => {
      editor = new Editor({
        element: editorElement,
        extensions: [
          Document,
          Paragraph,
          Text,
          ChoiceBlock,
          ChoiceQuestion,
          ChoiceOption,
          ChoiceBlockShortcuts,
        ],
        content: '<p></p>',
      });

      // Use the command to insert a choice block
      editor.commands.insertChoiceBlock();

      // Check selection
      const { from, to } = editor.state.selection;
      const selectedText = editor.state.doc.textBetween(from, to);

      // Should have selected the question text
      expect(selectedText).toBe('Your question here?');
    });

    it('should work at the start of a document', () => {
      editor = new Editor({
        element: editorElement,
        extensions: [
          Document,
          Paragraph,
          Text,
          ChoiceBlock,
          ChoiceQuestion,
          ChoiceOption,
          ChoiceBlockShortcuts,
        ],
        content: '<p></p>',
      });

      // Use the command at the very start
      editor.commands.insertChoiceBlock();

      const json = editor.getJSON();
      expect(json.content?.[0]?.type).toBe('choiceBlock');
    });

    it('should work after existing content', () => {
      editor = new Editor({
        element: editorElement,
        extensions: [
          Document,
          Paragraph,
          Text,
          ChoiceBlock,
          ChoiceQuestion,
          ChoiceOption,
          ChoiceBlockShortcuts,
        ],
        content: '<p>Some existing text</p><p></p>',
      });

      // Move to the second paragraph
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);

      // Insert choice block
      editor.commands.insertChoiceBlock();

      const json = editor.getJSON();

      // Should have the original paragraph and the choice block
      expect(json.content?.length).toBe(2);

      // The second node should be the choice block
      expect(json.content?.[1]?.type).toBe('choiceBlock');
      expect(json.content?.[1]?.content?.length).toBe(3); // question + 2 options
    });
  });
});
