import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processHTMLToMarkdown, processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { SourceJournal } from './source-journal';
import { DocumentSession } from './document-session';
import { scanTables } from './table-source';

beforeAll(() => store.init());
afterAll(() => store.dispose());
for (const plain of [false, true])
  for (const nextRow of [false, true])
    for (const variant of ['write-failure', 'journal-failure', 'stale', 'large'] as const) {
      const backward = true;
      it(`preserves native text paste across cells: plain=${plain}, nextRow=${nextRow}, variant=${variant}`, async () => {
        const tailRows =
          variant === 'large'
            ? Array.from(
                { length: 160 },
                (_, r) => `| keep${r} a | **marked${r}** | last${r} |`,
              ).join('\n') + '\n'
            : '';
        const source =
          '| H | K | J |\n| :--- | :---: | ---: |\n| alpha LEFT | middle | beta RIGHT |\n| gamma LEFT | second | delta RIGHT |\n' +
          tailRows +
          '\nTail';
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
        const service = new SourceJournal(() => source, 1),
          session = new DocumentSession(service, document.createElement('div'));
        const restores: Array<() => void> = [];
        try {
          const table = scanTables(source)[0],
            first = table.rows[1].cells[0],
            last = table.rows[nextRow ? 2 : 1].cells[2];
          const states = new Map<string, string>();
          native.state.doc.firstChild!.forEach((row, _ro, r) =>
            row.forEach((cell, _co, c) =>
              states.set(`cell:${table.rows[r].cells[c].from}`, JSON.stringify(cell.toJSON())),
            ),
          );
          Object.assign(service, { tableStates: states });
          let a = -1,
            h = -1;
          native.state.doc.descendants((node, pos) => {
            if (node.type.name === 'paragraph' && node.textContent === 'alpha LEFT')
              a = pos + 1 + 6;
            if (
              node.type.name === 'paragraph' &&
              node.textContent === (nextRow ? 'delta RIGHT' : 'beta RIGHT')
            )
              h = pos + 1 + (nextRow ? 5 : 4);
          });
          expect(a).toBeGreaterThan(0);
          expect(h).toBeGreaterThan(a);
          native.view.dispatch(
            native.state.tr.setSelection(
              TextSelection.create(native.state.doc, backward ? h : a, backward ? a : h),
            ),
          );
          expect(native.state.selection).toBeInstanceOf(TextSelection);
          const initial = native.getJSON(),
            initialSelection = native.state.selection.toJSON();
          const firstPoint = { cell: first.from, block: 0, offset: 6 },
            lastPoint = { cell: last.from, block: 0, offset: nextRow ? 5 : 4 };
          session.selection = {
            anchor: backward ? last.body + lastPoint.offset : first.body + 6,
            head: backward ? first.body + 6 : last.body + lastPoint.offset,
            revision: service.revision,
            affinity: 1,
            table: {
              kind: 'text',
              anchor: backward ? lastPoint : firstPoint,
              head: backward ? firstPoint : lastPoint,
            },
          };
          const before = structuredClone(session.selection);
          await session.seek(first.body);
          const input = {
            'text/plain': plain ? 'NEW **bold** | slash\\\nlast' : '',
            'text/html': plain
              ? ''
              : '<p><strong>NEW</strong></p><p></p><p><code>a|b\\c</code></p>',
          };
          if (variant === 'large') {
            if (plain) input['text/plain'] = '文🌍 '.repeat(1800) + input['text/plain'];
            else
              input['text/html'] =
                '<p><strong>' + '文🌍 '.repeat(1800) + '</strong></p>' + input['text/html'];
          }
          const paste = (editor: Editor, external = false) => {
            const event = new Event('paste', { bubbles: true, cancelable: true });
            Object.defineProperty(event, 'clipboardData', {
              value: {
                files: [],
                getData: (mime: string) => {
                  if (external) throw new Error('Renderer read whole input');
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
          expect(native.getJSON()).toEqual(initial);
          expect(native.state.selection.toJSON()).toEqual(initialSelection);
          expect(native.commands.redo()).toBe(true);
          expect(native.getJSON()).toEqual(expected);
          expect(native.state.selection.toJSON()).toEqual(expectedSelection);
          const old = session.editor!;
          const oldDoc = old.getJSON(),
            oldSelection = old.state.selection.toJSON(),
            revision = service.revision,
            oldMetadata = [...states];
          session.clipboardInput = service.openClipboardInput(input);
          if (variant === 'write-failure') {
            const stage = service.stage.bind(service);
            const spy = vi.spyOn(service, 'stage').mockImplementation((splice, history) => {
              stage(splice, history);
              throw new Error('injected range source failure');
            });
            restores.push(() => spy.mockRestore());
          }
          if (variant === 'journal-failure') {
            const spy = vi.spyOn(service, 'record').mockImplementationOnce(() => {
              throw new Error('injected range journal failure');
            });
            restores.push(() => spy.mockRestore());
          }
          if (variant === 'stale') {
            const read = service.clipboardInput.page.bind(service.clipboardInput);
            const spy = vi.spyOn(service.clipboardInput, 'page').mockImplementation((id, index) => {
              const page = read(id, index);
              if (index === 0)
                service.apply({ from: service.length, to: service.length, insert: '\n\nREMOTE' });
              return page;
            });
            restores.push(() => spy.mockRestore());
          }
          paste(old, true);
          restores.splice(0).forEach((restore) => restore());
          if (variant !== 'large') {
            expect(session.error).toMatch(/failure|stale/i);
            expect(service.region(0)).toBe(source + (variant === 'stale' ? '\n\nREMOTE' : ''));
            expect(service.revision).toBe(revision + (variant === 'stale' ? 1 : 0));
            expect([...(Reflect.get(service, 'tableStates') as Map<string, string>)]).toEqual(
              oldMetadata,
            );
            expect(service.depth).toBe(0);
            expect(session.selection).toEqual(before);
            expect(session.editor).toBe(old);
            expect(old.getJSON()).toEqual(oldDoc);
            expect(old.state.selection.toJSON()).toEqual(oldSelection);
            expect(service.clipboardInput.retainedBytes).toBe(0);
            expect(service.clipboardInputSink.stagingBytes).toBe(0);
            return;
          }
          expect(session.error).toBe('');
          const saved = service.region(0);
          expect(await processMarkdownToHTML(saved)).toBe(
            await processMarkdownToHTML(processHTMLToMarkdown(native.getHTML())),
          );
          await expect.poll(() => old.isDestroyed).toBe(true);
          const inspect = () => {
            const metadata = Reflect.get(service, 'tableStates') as Map<string, string>;
            const index = scanTables(service.region(0), (from) => {
              const value = metadata.get(`cell:${from}`);
              return value ? JSON.parse(value) : undefined;
            })[0];
            expect(
              index.rows.map((row) =>
                row.cells.map((cell) => JSON.parse(metadata.get(`cell:${cell.from}`)!)),
              ),
            ).toEqual(
              native.state.doc.firstChild!.toJSON().content!.map((row) => row.content ?? []),
            );
          };
          inspect();
          const logicalPoint = ($pos: typeof native.state.selection.$head) => {
            const index = scanTables(saved)[0];
            let found: { cell: number; block: number; offset: number } | undefined;
            native.state.doc.firstChild!.forEach((row, ro, r) =>
              row.forEach((cell, co, c) => {
                const pos = 2 + ro + co;
                if ($pos.pos > pos && $pos.pos < pos + cell.nodeSize)
                  found = {
                    cell: index.rows[r].cells[c].from,
                    block: $pos.index(3),
                    offset: $pos.parentOffset,
                  };
              }),
            );
            expect(found).toBeDefined();
            return found;
          };
          expect(session.selection.table).toEqual({
            kind: 'text',
            anchor: logicalPoint(native.state.selection.$anchor),
            head: logicalPoint(native.state.selection.$head),
          });
          expect(saved.slice(saved.indexOf('| keep0 a'))).toBe(tailRows + '\nTail');
          expect(saved.slice(0, saved.indexOf('| alpha '))).toBe(
            source.slice(0, source.indexOf('| alpha ')),
          );
          const after = structuredClone(session.selection.table);
          session.save();
          await session.seek(0);
          await session.history();
          expect(service.region(0)).toBe(source);
          expect(session.selection.table).toEqual(before.table);
          await session.history(true);
          expect(service.region(0)).toBe(saved);
          expect(session.selection.table).toEqual(after);
          inspect();
          expect(service.depth).toBe(1);
          const resources = session.snapshot();
          expect(resources.externalClipboardInput.maxBackingRangeFitNodes).toBeGreaterThan(4096);
          expect(
            resources.externalClipboardInput.maxBackingRangeFitSerializedBytes,
          ).toBeGreaterThan(16384);
          expect(resources.externalClipboardInput.maxBackingRangePlanBytes).toBeGreaterThan(16384);
          expect(resources.externalClipboardInput.retainedBytes).toBe(0);
          expect(resources.externalClipboardInput.stagingBytes).toBe(0);
          expect(session.clipboardRelay.maxPageBytes).toBeLessThanOrEqual(4096);
          expect(service.maxTableWriteBytes).toBeLessThanOrEqual(4096);
          expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
        } finally {
          restores.forEach((restore) => restore());
          native.destroy();
          session.destroy();
        }
      });
    }
