/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { createIntentLink } from '../tiptap-link-extension';

// Mirrors the chat input's Link configuration (TipTapEditor.svelte).
const createTestEditor = (element: HTMLElement, content = '<p></p>') =>
  new Editor({
    element,
    extensions: [
      StarterKit.configure({ link: false }),
      createIntentLink({
        openOnClick: false,
        linkOnPaste: true,
        shouldAutoLink: (url: string) => /^https?:\/\//.test(url) || url.startsWith('intent://'),
        HTMLAttributes: {
          class: 'text-primary underline',
        },
      }),
    ],
    content,
  });

/** Simulate typing: insert one character at a time through the editor view. */
function typeText(editor: Editor, text: string) {
  for (const char of text) {
    editor.view.dispatch(editor.state.tr.insertText(char));
  }
}

/** Collect the text segments that carry the link mark. */
function linkedSegments(editor: Editor): string[] {
  const segments: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.isText && node.marks.some((mark) => mark.type.name === 'link')) {
      segments.push(node.text ?? '');
    }
  });
  return segments;
}

describe('IntentLink autolink boundaries in the chat input', () => {
  let element: HTMLElement;
  let editor: Editor;

  beforeEach(() => {
    element = document.createElement('div');
    document.body.appendChild(element);
  });

  afterEach(() => {
    editor?.destroy();
    element.remove();
  });

  it('autolinks a typed URL with an explicit protocol once a space follows it', () => {
    editor = createTestEditor(element);

    typeText(editor, 'https://example.com/docs for now');

    expect(linkedSegments(editor)).toEqual(['https://example.com/docs']);
    expect(editor.getText()).toBe('https://example.com/docs for now');
  });

  it('does not extend the link mark when typing a space at the end of a link', () => {
    editor = createTestEditor(element);
    const url = 'https://example.com/docs';

    // Type the URL plus a trailing space so autolink applies the mark…
    typeText(editor, `${url} `);
    expect(linkedSegments(editor)).toEqual([url]);

    // …then remove the space, leaving the caret at the very end of the link
    // (the state a user is in while typing right after an autolinked URL).
    const urlEnd = 1 + url.length;
    editor.view.dispatch(editor.state.tr.delete(urlEnd, urlEnd + 1));

    typeText(editor, ' for now');

    expect(linkedSegments(editor)).toEqual([url]);
    expect(editor.getText()).toBe(`${url} for now`);
  });

  it('does not autolink bare TLD words like healthcheck.rs', () => {
    editor = createTestEditor(element);

    typeText(editor, 'healthcheck.rs and claim.rs ');

    expect(linkedSegments(editor)).toEqual([]);
  });

  it('keeps intent:// links applied via setLink working', () => {
    editor = createTestEditor(element, '<p>open the spec</p>');

    editor.commands.setTextSelection({ from: 1, to: 14 });
    editor.commands.setLink({ href: 'intent://local/note/spec' });

    expect(linkedSegments(editor)).toEqual(['open the spec']);
    expect(editor.getHTML()).toContain('href="intent://local/note/spec"');
  });

  it('keeps parsed link content highlighted (conversation-style rendering)', () => {
    editor = createTestEditor(
      element,
      '<p><a href="https://example.com/docs">https://example.com/docs</a> for now</p>',
    );

    expect(linkedSegments(editor)).toEqual(['https://example.com/docs']);
  });
});
