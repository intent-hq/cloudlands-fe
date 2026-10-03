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
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { projectNoteWindow } from './note-window-projection';
import type { NoteWindow } from './note-window-reader';

it.each([
  ['mermaid', 'flowchart TD\n A --> B\n', 'mermaidBlock'],
  ['diff', '-old\n+new\n', 'diffBlock'],
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
