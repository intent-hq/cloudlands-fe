/**
 * Regression tests for line-break doubling in the chat input serialization
 * (intent-hq/monorepo#1151).
 *
 * The chat input convention (defined by plainTextToEditorHTML) is:
 * - single visual line break (hardBreak / <br>) ↔ "\n"
 * - paragraph boundary (blank line) ↔ "\n\n"
 *
 * These tests fail against the old behavior (editor.getText() with default
 * options drops hardBreaks, and pasted single "\n"s became paragraph
 * boundaries, doubling into "\n\n").
 *
 * @vitest-environment jsdom
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  Slice,
  Fragment,
} from '@tiptap/pm/model';
import {
  plainTextToEditorHTML,
  serializeEditorText,
  pastedTextToParagraphNodes,
} from '../editor-text-serialization';

/** Mirrors the chat input's plaintext-like StarterKit configuration */
function createEditor(): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        horizontalRule: false,
        link: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        code: false,
        bold: false,
        italic: false,
        strike: false,
        blockquote: false,
        dropcursor: false,
      }),
    ],
    content: '',
  });
}

/** Simulates the fixed handlePaste path: paragraph nodes → open slice → replaceSelection */
function pastePlainText(editor: Editor, text: string): void {
  const { view } = editor;
  const paragraphs = pastedTextToParagraphNodes(view.state.schema, text);
  const slice = new Slice(Fragment.from(paragraphs), 1, 1);
  view.dispatch(view.state.tr.replaceSelection(slice));
}

describe('editor-text-serialization (#1151)', () => {
  let editor: Editor;

  beforeEach(() => {
    editor = createEditor();
  });

  afterEach(() => {
    editor.destroy();
    document.body.innerHTML = '';
  });

  it('serializes a hardBreak (Shift+Enter) to exactly one \\n', () => {
    editor.chain().insertContent('a').setHardBreak().insertContent('b').run();
    expect(serializeEditorText(editor)).toBe('a\nb');
  });

  it('serializes a paragraph boundary (blank line) to exactly \\n\\n', () => {
    editor.commands.setContent('<p>a</p><p>b</p>');
    expect(serializeEditorText(editor)).toBe('a\n\nb');
  });

  describe('round trip through plainTextToEditorHTML', () => {
    const cases = [
      'a\nb',
      'a\n\nb',
      'line one\nline two\n\nsecond paragraph\nwith another line',
      '  indented line\nplain line',
    ];

    for (const text of cases) {
      it(`round-trips ${JSON.stringify(text)} losslessly`, () => {
        editor.commands.setContent(plainTextToEditorHTML(text));
        expect(serializeEditorText(editor)).toBe(text);
      });
    }
  });

  describe('paste path (< 5 lines falls through to inline insertion)', () => {
    it('pasting "a\\nb" serializes back to "a\\nb" (not "a\\n\\nb")', () => {
      pastePlainText(editor, 'a\nb');
      expect(serializeEditorText(editor)).toBe('a\nb');
    });

    it('pasting "a\\n\\nb" preserves the blank line as "a\\n\\nb"', () => {
      pastePlainText(editor, 'a\n\nb');
      expect(serializeEditorText(editor)).toBe('a\n\nb');
    });

    it('normalizes CRLF line endings on paste', () => {
      pastePlainText(editor, 'a\r\nb');
      expect(serializeEditorText(editor)).toBe('a\nb');
    });

    it('pasting into existing text keeps surrounding content on the same lines', () => {
      editor.commands.setContent('<p>before after</p>');
      // Place the cursor between "before " and "after" (pos 1 + 'before '.length)
      editor.commands.setTextSelection(8);
      pastePlainText(editor, 'x\ny');
      expect(serializeEditorText(editor)).toBe('before x\nyafter');
    });
  });
});
