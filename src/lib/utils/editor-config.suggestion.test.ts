/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createEditorConfig } from './editor-config';
import { applySuggestionDecision } from '$lib/components/workspace/note-with-comments/suggestion-actions';

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function createNoteEditor(content: string, onSuggestionClick = vi.fn(), editable = true) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const config = createEditorConfig({
    element,
    content,
    editable,
    onUpdate: () => {},
    onSuggestionClick,
    workspace: { id: 'workspace-1' },
    useMarkdown: true,
    enableMentions: true,
    enableNotePrimitives: true,
  });
  editor = new Editor(config);
  return { editor, config, element, onSuggestionClick };
}

function clickSuggestion(
  config: ReturnType<typeof createNoteEditor>['config'],
  element: HTMLElement,
) {
  const target = element.querySelector('.suggestion') as HTMLElement;
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'target', { value: target });
  return { handled: config.editorProps?.handleClick?.(editor!.view, 0, event), target };
}

const suggestionHtml = (type: string, text: string) =>
  `<p>Keep <span data-suggestion-id="suggestion-1" data-suggestion-type="${type}" ` +
  `data-suggestion-author="Agent" data-suggestion-reason="Clearer" ` +
  `data-suggestion-original="original">${text}</span> text</p>`;

describe('note editor inline suggestions', () => {
  it.each([
    ['addition', 'accept', 'proposed', 'Keep proposed text'],
    ['addition', 'reject', 'proposed', 'Keep  text'],
    ['deletion', 'accept', 'original', 'Keep  text'],
    ['deletion', 'reject', 'original', 'Keep original text'],
    ['modification', 'accept', 'proposed', 'Keep proposed text'],
    ['modification', 'reject', 'proposed', 'Keep original text'],
  ] as const)(
    'renders a %s suggestion, routes its click, and applies %s',
    async (type, decision, text, expectedText) => {
      const { config, element, onSuggestionClick } = createNoteEditor(suggestionHtml(type, text));

      expect(element.querySelector(`.suggestion.suggestion-${type}`)?.textContent).toBe(text);

      const { handled, target } = clickSuggestion(config, element);
      expect(handled).toBe(true);
      expect(onSuggestionClick).toHaveBeenCalledWith(
        {
          id: 'suggestion-1',
          type,
          author: 'Agent',
          reason: 'Clearer',
          originalText: 'original',
        },
        target,
      );

      const persist = vi.fn(async () => {});
      const [suggestion] = onSuggestionClick.mock.calls[0];
      await expect(
        applySuggestionDecision(editor!, suggestion.id, decision, persist),
      ).resolves.toBe(true);

      expect(persist).toHaveBeenCalledTimes(1);
      expect(editor!.getText()).toBe(expectedText);
      expect(element.querySelector('.suggestion')).toBeNull();
    },
  );

  it('keeps text typed at the end of a suggestion out of the suggestion', async () => {
    const { element } = createNoteEditor(suggestionHtml('addition', 'proposed'));
    const end = editor!.getText().indexOf(' text') + 1;

    editor!.view.dispatch(editor!.state.tr.insertText(' today', end));
    expect(element.querySelector('.suggestion')?.textContent).toBe('proposed');

    await applySuggestionDecision(editor!, 'suggestion-1', 'reject', async () => {});
    expect(editor!.getText()).toBe('Keep  today text');
  });

  it('does not open suggestion decisions in a read-only note', () => {
    const { config, element, onSuggestionClick } = createNoteEditor(
      suggestionHtml('addition', 'proposed'),
      vi.fn(),
      false,
    );

    expect(clickSuggestion(config, element).handled).toBeFalsy();
    expect(onSuggestionClick).not.toHaveBeenCalled();
  });

  it('does not persist a decision for a suggestion that is no longer in the note', async () => {
    createNoteEditor('<p>Plain text</p>');
    const persist = vi.fn(async () => {});

    await expect(applySuggestionDecision(editor!, 'missing', 'accept', persist)).resolves.toBe(
      false,
    );
    expect(persist).not.toHaveBeenCalled();
  });
});
