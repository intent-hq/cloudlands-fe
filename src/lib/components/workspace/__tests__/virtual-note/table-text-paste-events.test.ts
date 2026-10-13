import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processHTMLToMarkdown, processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { SourceJournal } from './source-journal';
import { DocumentSession } from './document-session';
import { scanTables } from './table-source';

beforeAll(() => store.init());
afterAll(() => store.dispose());
for (const plain of [false, true])
  for (const variant of [
    'backward',
    'write-failure',
    'journal-failure',
    'stale',
    'large',
    'inherited',
  ] as const) {
    const range = variant !== 'inherited';
    it(`retains native cell text paste fitting and event, rollback and resources: plain=${plain}, variant=${variant}`, async () => {
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
      const service = new SourceJournal(() => source, 1),
        session = new DocumentSession(service, document.createElement('div'));
      const restores: Array<() => void> = [];
      try {
        const table = scanTables(source)[0],
          cell = table.rows[1].cells[0];
        let start = -1;
        native.state.doc.descendants((node, pos) => {
          if (node.type.name === 'paragraph' && node.textContent === 'BEFORE middle AFTER')
            start = pos + 1;
        });
        expect(start).toBeGreaterThan(0);
        const fromOffset = variant === 'inherited' ? 3 : 7,
          toOffset = range ? 13 : fromOffset;
        const anchorOffset = variant === 'backward' ? toOffset : fromOffset,
          headOffset = variant === 'backward' ? fromOffset : toOffset;
        const { TextSelection } = await import('@tiptap/pm/state');
        native.view.dispatch(
          native.state.tr.setSelection(
            TextSelection.create(native.state.doc, start + anchorOffset, start + headOffset),
          ),
        );
        const original = native.getJSON(),
          originalSelection = native.state.selection.toJSON();
        const offset =
          variant === 'inherited' ? source.indexOf('BEFORE') + 3 : source.indexOf('middle');
        session.selection = {
          anchor: offset + (variant === 'backward' ? 6 : 0),
          head: offset + (range && variant !== 'backward' ? 6 : 0),
          revision: service.revision,
          affinity: 1,
          table: {
            kind: 'text',
            anchor: { cell: cell.from, block: 0, offset: anchorOffset },
            head: { cell: cell.from, block: 0, offset: headOffset },
          },
        };
        const before = structuredClone(session.selection);
        await session.seek(cell.body);
        const input = {
          'text/plain': plain ? 'literal **raw** | slash\\ 漢🌍\n\nlast' : '',
          'text/html': plain
            ? ''
            : '<p><strong>NEW</strong><code>a|b\\c</code></p><p></p><p><em>END</em></p>',
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
                if (external) throw new Error('Renderer read full clipboard input');
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
        const oldDoc = old.getJSON(),
          oldSelection = old.state.selection.toJSON(),
          revision = service.revision;
        const oldMetadata = [...(Reflect.get(service, 'tableStates') as Map<string, string>)];
        session.clipboardInput = service.openClipboardInput(input);
        if (variant === 'write-failure') {
          const stage = service.stage.bind(service);
          const spy = vi.spyOn(service, 'stage').mockImplementation((splice, history) => {
            stage(splice, history);
            throw new Error('injected text source failure');
          });
          restores.push(() => spy.mockRestore());
        }
        if (variant === 'journal-failure') {
          const spy = vi.spyOn(service, 'record').mockImplementationOnce(() => {
            throw new Error('injected text journal failure');
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
        if (variant.endsWith('failure') || variant === 'stale') {
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
        const updated = scanTables(saved)[0].rows[1].cells[0];
        expect(saved.slice(0, updated.body)).toBe(source.slice(0, cell.body));
        expect(saved.slice(updated.end)).toBe(source.slice(cell.end));
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
        const after = structuredClone(session.selection.table);
        session.save();
        await session.seek(0);
        await session.history();
        expect(service.region(0)).toBe(source);
        expect(session.selection.table).toEqual(before.table);
        await session.history(true);
        expect(service.region(0)).toBe(saved);
        expect(service.depth).toBe(1);
        expect(session.selection.table).toEqual(after);
        const snapshot = session.snapshot();
        expect(snapshot.externalClipboardInput.maxBackingTextFitNodes).toBeGreaterThan(0);
        expect(snapshot.externalClipboardInput.maxBackingTextFitSerializedBytes).toBeGreaterThan(0);
        expect(snapshot.externalClipboardInput.retainedBytes).toBe(0);
        expect(snapshot.externalClipboardInput.stagingBytes).toBe(0);
        expect(service.maxTableWriteBytes).toBeLessThanOrEqual(4096);
        if (variant === 'large')
          expect(snapshot.externalClipboardInput.maxBackingTextFitSerializedBytes).toBeGreaterThan(
            16384,
          );
        expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
      } finally {
        restores.forEach((restore) => restore());
        native.destroy();
        session.destroy();
      }
    });
  }
