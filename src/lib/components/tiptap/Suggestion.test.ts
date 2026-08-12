/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Suggestion } from './Suggestion';

let editor: Editor | undefined;

function createSuggestionEditor(
  type: 'addition' | 'deletion' | 'modification',
  text: string,
  originalText?: string,
): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, Suggestion],
    content: `<p><span data-suggestion-id="suggestion-1" data-suggestion-type="${type}"${
      originalText ? ` data-suggestion-original="${originalText}"` : ''
    }>${text}</span></p>`,
  });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

describe('Suggestion decisions', () => {
  it.each([
    ['addition', 'accept', 'proposed'],
    ['addition', 'reject', ''],
    ['deletion', 'accept', ''],
    ['deletion', 'reject', 'original'],
    ['modification', 'accept', 'proposed'],
    ['modification', 'reject', 'original'],
  ] as const)('%s %s produces the expected document', (type, decision, expectedText) => {
    const currentText = type === 'deletion' ? 'original' : 'proposed';
    const instance = createSuggestionEditor(type, currentText, 'original');

    const applied =
      decision === 'accept'
        ? instance.commands.acceptSuggestion('suggestion-1')
        : instance.commands.rejectSuggestion('suggestion-1');

    expect(applied).toBe(true);
    expect(instance.getText()).toBe(expectedText);
    expect(instance.getHTML()).not.toContain('data-suggestion-id');
  });

  it('rejects one modification mark split by inline formatting as one replacement', () => {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, Suggestion],
      content:
        '<p><span data-suggestion-id="suggestion-1" data-suggestion-type="modification" data-suggestion-original="original">pro<strong>posed</strong></span></p>',
    });

    expect(editor.commands.rejectSuggestion('suggestion-1')).toBe(true);
    expect(editor.getText()).toBe('original');
    expect(editor.getHTML()).not.toContain('data-suggestion-id');
  });
});
