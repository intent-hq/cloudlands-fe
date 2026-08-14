/**
 * Regression tests for line-break doubling (intent-hq/monorepo#1151) and
 * newline loss on draft restore in the chat input serialization.
 *
 * The chat input convention (defined by plainTextToEditorHTML) is:
 * - every "\n" ↔ exactly one hardBreak (<br>), inside a single paragraph
 * - no paragraph splitting, so consecutive/leading/trailing newlines
 *   round-trip losslessly (blank lines are consecutive hardBreaks)
 *
 * These tests fail against the old behavior (editor.getText() with default
 * options drops hardBreaks; pasted single "\n"s became paragraph boundaries,
 * doubling into "\n\n"; and paragraph splitting dropped blank lines).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor, type Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Mention from '@tiptap/extension-mention';
import { Slice, Fragment } from '@tiptap/pm/model';
import {
  plainTextToEditorHTML,
  serializeEditorText,
  pastedTextToParagraphNodes,
} from '../editor-text-serialization';

/** Mirrors the chat input's plaintext-like StarterKit configuration */
function createEditor(extraExtensions: Extensions = []): Editor {
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
      ...extraExtensions,
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
      'a\n\n\nb',
      '\na',
      'a\n',
      'a\n\n',
      '\n\na',
      '\n',
      'line one\nline two\n\nsecond paragraph\nwith another line',
      '  indented line\nplain line',
      'word ',
      'word  ',
      'word  gap',
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

    it('pasting "a\\n\\n\\nb" preserves consecutive blank lines', () => {
      pastePlainText(editor, 'a\n\n\nb');
      expect(serializeEditorText(editor)).toBe('a\n\n\nb');
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

  it('keeps schema-level mention renderText serializers alongside the hardBreak override', () => {
    // Regression guard: editor.getText() merges schema serializers (from each
    // extension's renderText, e.g. mention/contextMention) with the explicit
    // textSerializers map, so passing { hardBreak } must not drop mention tokens.
    const mentionEditor = createEditor([
      Mention.extend({
        renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
      }),
    ]);
    try {
      mentionEditor
        .chain()
        .insertContent('see ')
        .insertContent({ type: 'mention', attrs: { id: 'file.ts', label: 'file.ts' } })
        .setHardBreak()
        .insertContent('next line')
        .run();
      expect(serializeEditorText(mentionEditor)).toBe('see @file.ts\nnext line');
    } finally {
      mentionEditor.destroy();
    }
  });
});
