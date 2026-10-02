import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML, processHTMLToMarkdown } from '$lib/utils/markdown-processor';
import { SourceJournal } from './source-journal';
import { DocumentSession } from './document-session';

beforeAll(() => store.init());
afterAll(() => store.dispose());
const source = '| H | R |\n| :--- | ---: |\n| **left** | right |\n| bottom | last |';
for (const operation of [
  'verticalMerge',
  'verticalSplit',
  'toggleHeaderCell',
  'toggleHeaderRow',
  'toggleHeaderColumn',
] as const) {
  it(`retains native ${operation} cell structure, save policy and destroyed-view history`, async () => {
    const native = new Editor(
      createEditorConfig({
        element: document.createElement('div'),
        content: await processMarkdownToHTML(source),
        editable: true,
        useMarkdown: true,
        enableComments: false,
        enableMentions: false,
        onUpdate: () => {},
      }),
    );
    const service = new SourceJournal(() => source, 1);
    const session = new DocumentSession(service, document.createElement('div'));
    try {
      await session.seek(source.indexOf('left'));
      let before = native.getJSON();
      for (const editor of [native, session.editor!]) {
        const cells: number[] = [];
        editor.state.doc.descendants((n, pos) => {
          if (n.type.name === 'tableCell') cells.push(pos);
        });
        if (operation.startsWith('vertical')) {
          editor.view.dispatch(
            editor.state.tr.setSelection(
              CellSelection.create(editor.state.doc, cells[0], cells[2]),
            ),
          );
          expect(editor.commands.mergeCells()).toBe(true);
          if (operation === 'verticalSplit') expect(editor.commands.splitCell()).toBe(true);
        } else {
          editor.commands.setTextSelection(cells[0] + 2);
          if (editor === native) before = native.getJSON();
          expect(
            editor.commands[
              operation as 'toggleHeaderCell' | 'toggleHeaderRow' | 'toggleHeaderColumn'
            ](),
          ).toBe(true);
        }
      }
      const expected = native.getJSON();
      console.info(
        'Native grid structure control',
        JSON.stringify({
          operation,
          expected,
          actual: session.editor!.getJSON(),
          error: session.error,
          nativeSaved: processHTMLToMarkdown(native.getHTML()),
          source: service.region(0),
        }),
      );
      expect(session.error).toBe('');
      expect(session.editor!.getJSON()).toEqual(expected);
      const old = session.editor!;
      session.save();
      const saved = service.region(0);
      await session.seek(session.selection.head);
      expect(old.isDestroyed).toBe(true);
      expect(session.editor!.getJSON()).toEqual(expected);
      expect(service.region(0)).toBe(saved);
      await session.history();
      if (operation !== 'verticalSplit') {
        expect(session.editor!.getJSON()).toEqual(before);
        expect(service.region(0)).toBe(source);
      }
      await session.history(true);
      expect(session.editor!.getJSON()).toEqual(expected);
      expect(service.region(0)).toBe(saved);
      expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
      expect(service.stats.maxTableWriteBytes).toBeLessThanOrEqual(4096);
    } finally {
      native.destroy();
      session.destroy();
    }
  });
}
