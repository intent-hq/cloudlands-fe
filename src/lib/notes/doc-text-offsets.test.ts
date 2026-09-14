/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { docTextOffsets } from './doc-text-offsets';
import { createOffsetMapper } from './text-rebase';

let editor: Editor | undefined;

function makeEditor(content: string): Editor {
  editor?.destroy();
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit],
    content,
  });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

describe('docTextOffsets', () => {
  it('projects textblocks separated by a newline', () => {
    const { text } = docTextOffsets(
      makeEditor('<h1>Title</h1><p>Body <strong>bold</strong></p>').state.doc,
    );
    expect(text).toBe('Title\nBody bold');
  });

  it('round-trips positions inside text nodes across marks and blocks', () => {
    const doc = makeEditor('<h1>Title</h1><p>Body <strong>bold</strong> tail</p>').state.doc;
    const offsets = docTextOffsets(doc);
    for (let pos = 1; pos < doc.content.size; pos += 1) {
      const resolved = doc.resolve(pos);
      if (!resolved.parent.isTextblock) continue;
      expect(offsets.posOfOffset(offsets.offsetOfPos(pos))).toBe(pos);
    }
  });

  it('resolves the block separator to the preceding block end', () => {
    const doc = makeEditor('<p>ab</p><p>cd</p>').state.doc;
    const offsets = docTextOffsets(doc);
    expect(offsets.text).toBe('ab\ncd');
    expect(offsets.posOfOffset(2)).toBe(3);
    expect(offsets.posOfOffset(3)).toBe(5);
    expect(offsets.offsetOfPos(4)).toBe(2);
  });

  it('clamps out-of-range inputs', () => {
    const doc = makeEditor('<p>ab</p>').state.doc;
    const offsets = docTextOffsets(doc);
    expect(offsets.posOfOffset(-5)).toBe(1);
    expect(offsets.posOfOffset(99)).toBe(3);
    expect(offsets.offsetOfPos(99)).toBe(2);
  });

  it('maps a caret in the markdown source onto the rendered document and back', () => {
    const markdown = '# Title\n\nBody **bold** tail';
    const doc = makeEditor('<h1>Title</h1><p>Body <strong>bold</strong> tail</p>').state.doc;
    const offsets = docTextOffsets(doc);
    const toLocal = createOffsetMapper(markdown, offsets.text);
    const toBase = createOffsetMapper(offsets.text, markdown);

    // Caret between "bo" and "ld" in the markdown ("# Title\n\nBody **bo|ld** tail").
    const markdownCaret = markdown.indexOf('ld**');
    const pos = offsets.posOfOffset(toLocal(markdownCaret));
    expect(doc.textBetween(pos - 2, pos)).toBe('bo');
    expect(doc.textBetween(pos, pos + 2)).toBe('ld');
    expect(toBase(offsets.offsetOfPos(pos))).toBe(markdownCaret);
  });
});
