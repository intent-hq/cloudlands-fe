import { test, expect } from '../../../../../test/ct-test';
import Pair from './ParagraphProofHarness.svelte';
import type { TableIndex } from './table-source';
import { focus, settled, type Host } from './paragraph-browser';

for (const plain of [false, true])
  for (const cross of [false, true]) {
    test(`native browser external paged paste preserves cells and history: plain=${plain}, cross=${cross}`, async ({
      mount,
      page,
    }, info) => {
      const source =
        '| H | K | J |\n| :--- | :---: | ---: |\n| alpha LEFT | middle | beta RIGHT |\n| gamma LEFT | second | delta RIGHT |\n\nTail';
      const input = {
        'text/plain': plain ? 'NEW **bold** | slash\\\nlast' : '',
        'text/html': plain ? '' : '<p><strong>NEW</strong></p><p></p><p><code>a|b\\c</code></p>',
      };
      await mount(Pair, { props: { sourceOverride: source } });
      const roots = {
        native: page.getByTestId('native').getByTestId('proof'),
        bounded: page.getByTestId('bounded').getByTestId('proof'),
      };
      await focus(page, 'native');
      const before = await roots.native.evaluate((el, cross) => {
        const editor = (el as Host).native;
        let a = -1,
          h = -1;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === 'paragraph' && node.textContent === 'alpha LEFT') {
            a = pos + 7;
            if (!cross) h = a;
          }
          if (cross && node.type.name === 'paragraph' && node.textContent === 'beta RIGHT')
            h = pos + 5;
        });
        if (a < 0 || h < 0) throw new Error('Native target missing');
        editor.commands.setTextSelection({ from: a, to: h });
        return { doc: editor.getJSON(), selection: editor.state.selection.toJSON() };
      }, cross);
      await roots.bounded.evaluate(
        async (el, { source, cross, doc }) => {
          const p = (el as Host).proof;
          const index = (
            Reflect.get(p.service, 'tableIndex') as (source: string, start: number) => TableIndex[]
          ).call(p.service, source, 0)[0];
          // Complete initial native tree is a backing fixture/oracle, not a renderer payload.
          const states = new Map<string, string>();
          doc.content![0].content!.forEach((row, r) =>
            row.content!.forEach((cell, c) =>
              states.set(`cell:${index.rows[r].cells[c].from}`, JSON.stringify(cell)),
            ),
          );
          Object.assign(p.service, { tableStates: states });
          const first = index.rows[1].cells[0],
            last = index.rows[1].cells[cross ? 2 : 0];
          p.selection = {
            anchor: first.body + 6,
            head: last.body + (cross ? 4 : 6),
            affinity: 1,
            revision: p.service.revision,
            table: {
              kind: 'text',
              anchor: { cell: first.from, block: 0, offset: 6 },
              head: { cell: last.from, block: 0, offset: cross ? 4 : 6 },
            },
          };
          await p.seek(first.body);
          Object.assign(el, {
            pasteOldView: p.editor,
            selectionBefore: structuredClone(p.selection.table),
          });
        },
        { source, cross, doc: before.doc },
      );
      for (const side of ['native', 'bounded'] as const) {
        await roots[side].evaluate(
          (el, { input, external }) => {
            const h = el as Host,
              e = h.proof?.editor ?? h.native;
            if (external) h.proof.clipboardInput = h.proof.service.openClipboardInput(input);
            const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
            Object.defineProperty(event, 'clipboardData', {
              value: {
                files: [],
                getData: (mime: string) => {
                  if (external) throw new Error('Renderer read complete input');
                  return input[mime as keyof typeof input] ?? '';
                },
              },
            });
            e.view.dom.dispatchEvent(event);
            if (!event.defaultPrevented) throw new Error('Paste event was not handled');
          },
          { input, external: side === 'bounded' },
        );
      }
      await settled(page);
      const expected = await roots.native.evaluate((el) => {
        const h = el as Host & { nativeMarkdown: () => string };
        return {
          doc: h.native.getJSON(),
          selection: h.native.state.selection.toJSON(),
          markdown: h.nativeMarkdown(),
          block: h.native.state.selection.$head.index(3),
          offset: h.native.state.selection.$head.parentOffset,
        };
      });
      const compare = async (phase: string) => {
        const actual = await roots.bounded.evaluate(async (el) => {
          const h = el as Host & { pasteOldView: { isDestroyed: boolean } },
            p = h.proof;
          const source = p.service.region(0),
            states = Reflect.get(p.service, 'tableStates') as Map<string, string>;
          const index = (
            Reflect.get(p.service, 'tableIndex') as (source: string, start: number) => TableIndex[]
          ).call(p.service, source, 0)[0];
          return {
            source,
            live: index.rows.map((row) =>
              row.cells.map((cell) => JSON.parse(states.get(`cell:${cell.from}`)!)),
            ),
            point: p.selection.table!.head,
            error: p.error,
            stats: p.snapshot(),
            destroyed: h.pasteOldView.isDestroyed,
            canonical: (await h.parseSource(source)).doc,
          };
        });
        const canonical = await roots.native.evaluate(
          async (el, source) => (el as Host).parseSource(source),
          expected.markdown,
        );
        await info.attach(`paged-paste-${phase}.json`, {
          body: JSON.stringify({ expected, actual }),
          contentType: 'application/json',
        });
        expect(actual.error).toBe('');
        expect(actual.live).toEqual(
          expected.doc.content![0].content!.map((row) => row.content ?? []),
        );
        expect(actual.canonical).toEqual(canonical.doc);
        expect(actual.point.block).toBe(expected.block);
        expect(actual.point.offset).toBe(expected.offset);
        expect(actual.destroyed).toBe(true);
        expect(actual.source.endsWith('\n\nTail')).toBe(true);
        expect(actual.stats.maxSourceContextBytes).toBeLessThanOrEqual(16384);
        expect(actual.stats.cacheBytes).toBeLessThanOrEqual(16384);
        expect(actual.stats.pmNodes).toBeLessThanOrEqual(4096);
        expect(actual.stats.maxTableTransferPageBytes).toBeLessThanOrEqual(4096);
        expect(actual.stats.externalClipboardInput.stagingBytes).toBe(0);
        expect(actual.stats.externalClipboardInput.retainedBytes).toBe(0);
        return actual.source;
      };
      const saved = await compare('paste');
      await roots.bounded.evaluate(async (el) => {
        const p = (el as Host).proof;
        p.save();
        await p.seek(p.service.length - 2);
        await p.seek(0);
      });
      for (const side of ['native', 'bounded'] as const) {
        await focus(page, side);
        await page.keyboard.press('Control+z');
        await settled(page);
      }
      expect(await roots.native.evaluate((el) => (el as Host).native.getJSON())).toEqual(
        before.doc,
      );
      expect(
        await roots.native.evaluate((el) => (el as Host).native.state.selection.toJSON()),
      ).toEqual(before.selection);
      const undone = await roots.bounded.evaluate((el) => {
        const h = el as Host & { selectionBefore: unknown };
        return {
          source: h.proof.service.region(0),
          selection: h.proof.selection.table,
          before: h.selectionBefore,
        };
      });
      expect(undone.source).toBe(source);
      expect(undone.selection).toEqual(undone.before);
      for (const side of ['native', 'bounded'] as const) {
        await focus(page, side);
        await page.keyboard.press('Control+Shift+z');
        await settled(page);
      }
      expect(await roots.native.evaluate((el) => (el as Host).native.getJSON())).toEqual(
        expected.doc,
      );
      expect(await compare('redo')).toBe(saved);
    });
  }
