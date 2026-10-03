import { expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
const cases = {
  multilineTrim: 'before `` A ` B\r\nC `` after',
  noTrimAllSpaces: 'before `   ` after',
  multipleDelimiters: 'before ```x `` y ` z``` after',
  giantOpening: 'before ' + '`'.repeat(100_001) + 'TARGET' + '`'.repeat(100_001) + ' after',
};
it.each(Object.entries(cases))(
  'records actual canonical inline-code mapping for %s',
  async (name, source) => {
    const html = await processMarkdownToHTML(source, {
      workspaceId: 'ws-a',
      preserveAnchors: true,
    });
    const editor = new Editor(
      createEditorConfig({
        element: document.createElement('div'),
        content: html,
        useMarkdown: true,
        editable: false,
        workspace: { id: 'ws-a' },
        enableMentions: true,
        enableNotePrimitives: true,
        onUpdate: () => {},
      }),
    );
    try {
      const spans: Array<{ text: string; marks: string[] }> = [];
      editor.state.doc.descendants((n) => {
        if (n.isText) spans.push({ text: n.text!, marks: n.marks.map((m) => m.type.name) });
      });
      expect({
        sourceLength: source.length,
        firstTarget: source.indexOf('TARGET'),
        spans,
      }).toMatchSnapshot(name);
    } finally {
      editor.destroy();
    }
  },
);
