import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processHTMLToMarkdown, processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { SourceJournal } from './source-journal';
import { DocumentSession } from './document-session';
import { scanTables } from './table-source';

beforeAll(() => store.init());
afterAll(() => store.dispose());
for (const origin of ['paragraph', 'cell', 'blockquote', 'nested-list'] as const)
  for (const range of [false, true]) {
    it(`retains native cell text paste fitting and history: origin=${origin}, range=${range}`, async () => {
      const source = '| H | K |\n| :--- | ---: |\n| **BEFORE** middle AFTER | untouched |\n\nTail';
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
      const paragraphs = '<p>literal **raw** <strong>B</strong></p><p><code>a|b\\c</code></p>';
      const donor = new Editor(
        createEditorConfig({
          element: document.createElement('div'),
          content:
            origin === 'cell'
              ? '<table><tbody><tr><td>' + paragraphs + '</td></tr></tbody></table><p>Tail</p>'
              : origin === 'blockquote'
                ? '<blockquote>' + paragraphs + '</blockquote>'
                : origin === 'nested-list'
                  ? '<ul><li><p>Outer</p><ul><li>' + paragraphs + '</li></ul></li></ul>'
                  : paragraphs,
          editable: true,
          useMarkdown: true,
          enableComments: false,
          enableMentions: false,
          onUpdate: () => {},
        }),
      );
      const service = new SourceJournal(() => source, 1),
        session = new DocumentSession(service, document.createElement('div'));
      try {
        const table = scanTables(source)[0],
          cell = table.rows[1].cells[0];
        let start = -1;
        native.state.doc.descendants((node, pos) => {
          if (node.type.name === 'paragraph' && node.textContent === 'BEFORE middle AFTER')
            start = pos + 1;
        });
        expect(start).toBeGreaterThan(0);
        native.commands.setTextSelection({ from: start + 7, to: start + (range ? 13 : 7) });
        const original = native.getJSON(),
          originalSelection = native.state.selection.toJSON();
        const offset = source.indexOf('middle');
        session.selection = {
          anchor: offset,
          head: offset + (range ? 6 : 0),
          revision: service.revision,
          affinity: 1,
          table: {
            kind: 'text',
            anchor: { cell: cell.from, block: 0, offset: 7 },
            head: { cell: cell.from, block: 0, offset: range ? 13 : 7 },
          },
        };
        const before = structuredClone(session.selection);
        await session.seek(cell.body);
        let donorStart = -1,
          donorEnd = -1;
        donor.state.doc.descendants((node, pos) => {
          if (
            node.type.name === 'paragraph' &&
            node.textContent !== 'Tail' &&
            node.textContent !== 'Outer'
          ) {
            if (donorStart < 0) donorStart = pos + 1;
            donorEnd = pos + node.nodeSize - 1;
          }
        });
        expect(donorStart).toBeGreaterThan(0);
        expect(donorEnd).toBeGreaterThan(donorStart);
        donor.commands.setTextSelection({ from: donorStart, to: donorEnd });
        const copied = donor.view.serializeForClipboard(donor.state.selection.content());
        const input = { 'text/plain': copied.text, 'text/html': copied.dom.innerHTML };
        expect(input['text/html']).toContain('data-pm-slice');
        const paste = (editor: Editor, external = false) => {
          const event = new Event('paste', { bubbles: true, cancelable: true });
          Object.defineProperty(event, 'clipboardData', {
            value: {
              files: [],
              getData: (mime: string) => {
                if (external) throw new Error('Renderer read complete clipboard');
                return input[mime as keyof typeof input] ?? '';
              },
            },
          });
          editor.view.dom.dispatchEvent(event);
          expect(event.defaultPrevented).toBe(true);
        };
        paste(native);
        const expected = native.getJSON(),
          expectedSelection = native.state.selection.toJSON();
        expect(native.commands.undo()).toBe(true);
        expect(native.getJSON()).toEqual(original);
        expect(native.state.selection.toJSON()).toEqual(originalSelection);
        expect(native.commands.redo()).toBe(true);
        expect(native.getJSON()).toEqual(expected);
        expect(native.state.selection.toJSON()).toEqual(expectedSelection);
        const old = session.editor!;
        session.clipboardInput = service.openClipboardInput(input);
        paste(old, true);
        expect(session.error).toBe('');
        const saved = service.region(0);
        expect(await processMarkdownToHTML(saved)).toBe(
          await processMarkdownToHTML(processHTMLToMarkdown(native.getHTML())),
        );
        await expect.poll(() => old.isDestroyed).toBe(true);
        const updated = scanTables(saved)[0].rows[1].cells[0];
        const metadata = Reflect.get(service, 'tableStates') as Map<string, string>;
        expect(JSON.parse(metadata.get(`cell:${updated.from}`)!)).toEqual(
          native.state.doc.firstChild!.child(1).child(0).toJSON(),
        );
        const head = native.state.selection.$head;
        expect(session.selection.table).toEqual({
          kind: 'text',
          anchor: { cell: updated.from, block: head.index(3), offset: head.parentOffset },
          head: { cell: updated.from, block: head.index(3), offset: head.parentOffset },
        });
        session.save();
        await session.seek(0);
        await session.history();
        expect(service.region(0)).toBe(source);
        expect(session.selection.table).toEqual(before.table);
        await session.history(true);
        expect(service.region(0)).toBe(saved);
        expect(service.depth).toBe(1);
        expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
      } finally {
        donor.destroy();
        native.destroy();
        session.destroy();
      }
    });
  }
