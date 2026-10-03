import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';
beforeAll(() => store.init());
afterAll(() => store.dispose());
async function native(source: string) {
  return new Editor(
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
}
for (const clipped of [false, true])
  for (const spelling of ['  ', ' \t ', 'literal-bold'])
    it(`matches native ${spelling} grammar and source affinity ${clipped ? 'clipped' : 'full'}`, async () => {
      const padding = clipped ? 'padding café 🌍 '.repeat(600) : '';
      const middle =
        spelling === 'literal-bold'
          ? '**leftHERE ' + padding + 'TARGET rightTHERE **'
          : 'leftHERE' + spelling + 'TARGET rightTHERE';
      const source = 'before ' + padding + middle + ' after ' + padding;
      const service = new SourceJournal(() => source, 1);
      const session = new DocumentSession(service, document.createElement('div'));
      const oracle = await native(source);
      try {
        const at = source.indexOf('TARGET');
        await session.seek(at);
        const editor = session.editor!,
          projection = session.projection!;
        const pm = projection.pmAt(at);
        expect(editor.state.doc.textBetween(pm, pm + 6)).toBe('TARGET');
        if (!clipped) expect(editor.getJSON()).toEqual(oracle.getJSON());
        else {
          const offsets: number[] = [];
          for (const boundary of [projection.start, projection.context!.to]) {
            const prefix = await native(source.slice(0, boundary) + 'CROP_SENTINEL');
            try {
              offsets.push(prefix.state.doc.firstChild!.textContent.indexOf('CROP_SENTINEL'));
            } finally {
              prefix.destroy();
            }
          }
          const paragraph = oracle.state.doc.firstChild!;
          expect(editor.state.doc.firstChild!.toJSON()).toEqual(
            paragraph.cut(offsets[0], Math.min(offsets[1], paragraph.content.size)).toJSON(),
          );
        }
        if (spelling === 'literal-bold') {
          expect(editor.state.doc.resolve(pm).marks()).toEqual([]);
          expect(oracle.state.doc.textContent).toContain('**leftHERE');
        } else {
          const space = pm - 1,
            rawStart = at - spelling.length;
          expect(editor.state.doc.textBetween(space, pm)).toBe(' ');
          expect(projection.sourceAt(space, -1)).toBe(rawStart);
          expect(projection.sourceAt(pm, 1)).toBe(at);
          expect(projection.pmAt(rawStart + 1, -1)).toBe(space);
          expect(projection.pmAt(rawStart + 1, 1)).toBe(spelling.length === 2 ? pm : space);
        }
        let oracleAt = -1;
        oracle.state.doc.descendants((node, pos) => {
          if (node.isText && node.text!.includes('TARGET'))
            oracleAt = pos + node.text!.indexOf('TARGET');
        });
        editor.commands.setTextSelection(pm + 6);
        oracle.commands.setTextSelection(oracleAt + 6);
        editor.commands.insertContent('X');
        oracle.commands.insertContent('X');
        expect(session.error).toBe('');
        const edited = source.slice(0, at + 6) + 'X' + source.slice(at + 6);
        expect(service.region(0)).toBe(edited);
        const fresh = await native(edited);
        try {
          expect(fresh.getJSON()).toEqual(oracle.getJSON());
        } finally {
          fresh.destroy();
        }
        session.save();
        const old = session.editor!;
        await session.seek(at);
        expect(old.isDestroyed).toBe(true);
        await session.history();
        expect(service.region(0)).toBe(source);
        await session.history(true);
        expect(service.region(0)).toBe(edited);
        expect(session.snapshot().mounted).toBe(1);
        expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
      } finally {
        session.destroy();
        oracle.destroy();
      }
    });
