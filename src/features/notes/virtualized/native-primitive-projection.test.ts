import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/configured-store';
beforeAll(() => {
  store.init();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterAll(() => {
  store.dispose();
  vi.unstubAllGlobals();
});
import { Editor } from '@tiptap/core';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML, processHTMLToMarkdown } from '$lib/utils/markdown-processor';
import { projectNoteWindow } from './note-window-projection';
import type { NoteWindow } from './note-window-reader';

it.each([
  ['mermaid', 'flowchart TD\n A --> B\n', 'mermaidBlock'],
  ['diff', '-old\n+new\n', 'diffBlock'],
  ['diff title', '-café & old\n+世界 <new>\n', 'diffBlock'],
  ['mermaid title', 'flowchart LR\n A["café & 世界"] --> B\n', 'mermaidBlock'],
])(
  'matches the native %s node instead of treating its payload as literal code',
  async (language, body, type) => {
    const text = '```' + language + '\n' + body + '```';
    const native = new Editor(
      createEditorConfig({
        element: document.createElement('div'),
        content: await processMarkdownToHTML(text, { workspaceId: 'ws-a', preserveAnchors: true }),
        editable: false,
        useMarkdown: true,
        workspace: { id: 'ws-a' },
        enableNotePrimitives: true,
        enableMentions: true,
        onUpdate: () => {},
      }),
    );
    try {
      const window: NoteWindow = {
        scope: { backendId: 'b', workspaceId: 'ws-a', noteId: 'n', noteInstanceId: 'i' },
        sourceRevision: 'r',
        snapshotId: 's',
        sourceLength: text.length,
        text,
        range: { start: 0, end: text.length },
        documentEnd: true,
        mapBindings: [],
        context: [
          {
            kind: 'boundary',
            id: 'f',
            construct: 'codeBlock',
            sourceRange: { start: 0, end: text.length },
            continuationBefore: false,
            continuationAfter: false,
          },
        ],
        details: {
          f: {
            openingSource: '```' + language + '\n',
            closingSource: '```',
            info: language,
            codeStyle: 'fenced',
          },
        },
        cost: {
          sourceBytes: text.length,
          contextBytes: 0,
          wireBytes: 0,
          requests: 1,
          assemblyPeakBytes: 0,
        },
      };
      expect(native.state.doc.firstChild!.type.name).toBe(type);
      const projection = projectNoteWindow(window);
      expect(projection.content.content?.[0]).toEqual(native.getJSON().content?.[0]);
      expect(projection.sourceAt(0)).toBe(0);
      expect(projection.sourceAt(1)).toBe(text.length);
    } finally {
      native.destroy();
    }
  },
);

// These small controls capture schema entry BEFORE renderer decoding. A detached
// production Editor builds its real document without starting native NodeViews.
// They are semantic oracles, not bounded artifact storage or construction proof.
const diffBody = '-café & old\n+世界 <new>\n';
const mermaidBody = 'flowchart LR\n A["café & 世界"] --> B\n';
const base64 = (value: string) => Buffer.from(value, 'utf8').toString('base64');
const htmlText = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const htmlAttribute = (value: string) => htmlText(value).replaceAll('"', '&quot;');
const pair = (diff: string, mermaid: string) =>
  `<div data-type="diff-block" data-diff-code="${htmlAttribute(diff)}"></div><div data-type="mermaid-block" data-mermaid-code="${htmlAttribute(mermaid)}"></div>`;
const prePair = (diff: string, mermaid: string) =>
  `<pre><code class="language-diff">${htmlText(diff)}</code></pre><pre><code class="language-mermaid">${htmlText(mermaid)}</code></pre>`;
const primitiveEntries = {
  titledDiffFence: '```diff title\n' + diffBody + '```',
  titledMermaidFence: '```mermaid title\n' + mermaidBody + '```',
  mixedFences:
    '## Before\n\n```diff\n' + diffBody + '```\n\n```mermaid\n' + mermaidBody + '```\n\n**After**',
  adjacentHtmlBase64: pair(base64(diffBody), base64(mermaidBody)),
  adjacentHtmlPlainAttributes: pair(diffBody, mermaidBody),
  adjacentHtmlPlainWithoutArrow: pair('-old\n+new\n', 'graph TD\n A[Alpha]\n'),
  adjacentHtmlPreCodePlain: prePair(diffBody, mermaidBody),
  adjacentHtmlPreCodeBase64: prePair(base64(diffBody), base64(mermaidBody)),
  markdownBeforeHtmlAtoms:
    '## Before\n\n' + pair(base64(diffBody), base64(mermaidBody)) + '\n\n**After**',
};
it.each(Object.entries(primitiveEntries))(
  'records raw native primitive attributes for %s',
  async (name, source) => {
    const html = await processMarkdownToHTML(source, {
      workspaceId: 'ws-a',
      preserveAnchors: true,
    });
    const editor = new Editor({
      ...createEditorConfig({
        element: document.createElement('div'),
        content: html,
        editable: false,
        useMarkdown: true,
        workspace: { id: 'ws-a' },
        enableNotePrimitives: true,
        enableMentions: true,
        enableComments: false,
        onUpdate: () => {},
      }),
      element: null,
    });
    try {
      const atoms: Array<{ type: string; code: unknown; position: number }> = [];
      editor.state.doc.descendants((node, position) => {
        if (node.type.name === 'diffBlock' || node.type.name === 'mermaidBlock')
          atoms.push({ type: node.type.name, code: node.attrs.code, position });
      });
      expect({
        source,
        html,
        atoms,
        native: editor.getJSON(),
        rendered: editor.getHTML(),
        saved: processHTMLToMarkdown(editor.getHTML()),
      }).toMatchSnapshot(name);
    } finally {
      editor.destroy();
    }
  },
);
