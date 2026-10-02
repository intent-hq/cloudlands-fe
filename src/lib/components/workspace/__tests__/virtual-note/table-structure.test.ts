import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { SourceJournal } from './source-journal';
import { DocumentSession } from './document-session';

beforeAll(() => store.init());
afterAll(() => store.dispose());
const source = '| H | R |\n| :--- | ---: |\n| left | right |\n| bottom | last |';
for (const command of [
  'addRowAfter',
  'addColumnBefore',
  'deleteColumn',
  'deleteRow',
  'mergeCells',
  'splitCell',
] as const) {
  it(`preserves native ${command} structure through session eviction and history`, async () => {
    const service = new SourceJournal(() => source, 1);
    const session = new DocumentSession(service, document.createElement('div'));
    const config = createEditorConfig({
      element: document.createElement('div'),
      content: await processMarkdownToHTML(source),
      editable: true,
      useMarkdown: true,
      enableComments: false,
      enableMentions: false,
      onUpdate: () => {},
    });
    const native = new Editor(config);
    try {
      await session.seek(source.indexOf('left'));
      for (const editor of [native, session.editor!]) {
        const cells: number[] = [];
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === 'tableCell') cells.push(pos);
        });
        if (command === 'mergeCells' || command === 'splitCell')
          editor.view.dispatch(
            editor.state.tr.setSelection(
              CellSelection.create(editor.state.doc, cells[0], cells[1]),
            ),
          );
        else editor.commands.setTextSelection(cells[0] + 2);
        if (command === 'splitCell') expect(editor.commands.mergeCells()).toBe(true);
        expect(editor.commands[command]()).toBe(true);
      }
      expect(session.error).toBe('');
      expect(session.editor!.state.doc.toJSON()).toEqual(native.state.doc.toJSON());
      const live = native.state.doc.toJSON();
      const old = session.editor!;
      session.save();
      await session.seek(session.selection.head);
      expect(old.isDestroyed).toBe(true);
      expect(session.editor!.state.doc.toJSON()).toEqual(live);
      await session.history();
      expect(service.region(0)).toBe(source);
      await session.history(true);
      expect(session.editor!.state.doc.toJSON()).toEqual(live);
      expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(4096);
    } finally {
      session.destroy();
      native.destroy();
    }
  });
}
