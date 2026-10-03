import { test, expect } from '../../../../../test/ct-test';
import type { Page } from '@playwright/test';
import Harness from './ParagraphProofHarness.svelte';
import { focus, settled, type Host } from './paragraph-browser';
const prefix = 'plain café 🌍\n\n- parent\n  - child\n\n```text\nfenced café 🌍\n```\n\n';
const source =
  prefix +
  '| H | R |\n| --- | --- |\n' +
  Array.from({ length: 800 }, (_, i) => `| cell-${i} café 🌍 | repeated |\n`).join('') +
  '\nfollowing café 🌍 repeated';
async function capture(page: Page, side: string) {
  await settled(page);
  return page
    .getByTestId(side)
    .getByTestId('proof')
    .evaluate((el) => {
      const h = el as Host,
        e = h.proof?.editor ?? h.native,
        s = e.state.selection;
      const part =
        h.proof?.projection?.table ??
        h.proof?.projection?.mixed?.parts.find((p) => p.projection.table)?.projection.table;
      const cells = part?.window.cells.map((c) => ({ row: c.row, column: c.column, from: c.from }));
      const endpoint = (pos: number) => {
        const r = e.state.doc.resolve(pos);
        for (let d = 1; d <= r.depth; d++)
          if (r.node(d).type.name === 'table') {
            const row = r.index(d),
              column = r.index(d + 1);
            const rows = cells && [...new Set(cells.map((c) => c.row))];
            const logicalRow = rows?.[row] ?? row;
            const logicalColumn =
              cells?.filter((c) => c.row === logicalRow)[column]?.column ?? column;
            if (s.toJSON().type === 'cell')
              return { kind: 'cell', row: logicalRow, column: logicalColumn };
            return {
              kind: 'cell',
              row: logicalRow,
              column: logicalColumn,
              depth: r.depth - d,
              offset: r.parentOffset,
            };
          }
        return { kind: r.parent.type.name, text: r.parent.textContent, offset: r.parentOffset };
      };
      const json = s.toJSON() as { type: string; anchor?: number; head?: number };
      const renderedLogical = {
        type: json.type,
        anchor: endpoint(json.anchor ?? s.anchor),
        head: endpoint(json.head ?? s.head),
      };
      let logical = renderedLogical;
      const selected = part?.window.selected,
        bookmark = h.proof?.selection.table;
      if (
        json.type === 'cell' &&
        selected &&
        bookmark?.kind === 'cell' &&
        selected.anchor === bookmark.anchor.cell &&
        selected.head === bookmark.head.cell
      ) {
        const point = (anchor: boolean) => ({
          kind: 'cell',
          row: anchor !== selected.backwardRows ? selected.top : selected.bottom - 1,
          column: anchor !== selected.backwardColumns ? selected.left : selected.right - 1,
        });
        logical = { type: 'cell', anchor: point(true), head: point(false) };
      }
      const dom = window.getSelection()!;
      return {
        doc: e.getJSON(),
        selection: json,
        logical,
        renderedLogical,
        selectedCells: e.view.dom.querySelectorAll('.selectedCell').length,
        pm: { anchor: s.anchor, head: s.head },
        dom: {
          anchor: e.view.posAtDOM(dom.anchorNode!, dom.anchorOffset),
          head: e.view.posAtDOM(dom.focusNode!, dom.focusOffset),
        },
        cells,
        proseBefore:
          h.proof?.projection?.mixed?.parts.some(
            (p) => !p.projection.table && p.projection.start < part!.window.from,
          ) ?? false,
        proseAfter:
          h.proof?.projection?.mixed?.parts.some(
            (p) => !p.projection.table && p.projection.start >= part!.window.to,
          ) ?? false,
        error: h.proof?.error ?? '',
        stats: h.proof?.snapshot(),
      };
    });
}
for (const edge of ['before', 'after'] as const)
  for (const operation of ['Backspace', 'Delete', 'insert', 'paste'] as const) {
    test(`sparse table ${edge}: Chromium ${operation} and actual eviction`, async ({
      mount,
      page,
      context,
    }, info) => {
      if (operation === 'paste')
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await mount(Harness, { props: { sourceOverride: source } });
      await page
        .getByTestId('bounded')
        .getByTestId('proof')
        .evaluate(
          async (el, pos) => {
            await (el as Host).proof.seek(pos);
          },
          edge === 'before' ? 0 : source.length - 1,
        );
      const results = [];
      for (const side of ['native', 'bounded']) {
        await focus(page, side);
        await page
          .getByTestId(side)
          .getByTestId('proof')
          .evaluate(
            (el, { edge, operation }) => {
              const h = el as Host,
                e = h.proof?.editor ?? h.native;
              const roots: Array<{ pos: number; node: typeof e.state.doc }> = [];
              e.state.doc.forEach((node, pos) => roots.push({ node, pos }));
              const table = roots.findIndex((r) => r.node.type.name === 'table');
              const index = edge === 'before' ? table - 1 : table;
              const leftRoot = roots[index],
                rightRoot = roots[index + 1];
              let left = -1,
                right = -1;
              if (leftRoot.node.isTextblock) left = leftRoot.pos + leftRoot.node.nodeSize - 1;
              else
                leftRoot.node.descendants((node, pos) => {
                  if (node.isTextblock) left = leftRoot.pos + 1 + pos + node.nodeSize - 1;
                });
              if (rightRoot.node.isTextblock) right = rightRoot.pos + 1;
              else
                rightRoot.node.descendants((node, pos) => {
                  if (node.isTextblock && right < 0) right = rightRoot.pos + 1 + pos + 1;
                });
              e.commands.setTextSelection(
                operation === 'insert' || operation === 'paste'
                  ? { from: left - 1, to: right + 1 }
                  : operation === 'Backspace'
                    ? right
                    : left,
              );
            },
            { edge, operation },
          );
        if (operation === 'paste') {
          await page.evaluate(() => navigator.clipboard.writeText('PASTED'));
          await page.keyboard.press('Control+v');
        } else if (operation === 'insert') await page.keyboard.type('INSERTED');
        else await page.keyboard.press(operation);
        results.push(await capture(page, side));
      }
      await info.attach('sparse-native-results.json', {
        body: JSON.stringify(results),
        contentType: 'application/json',
      });
      const [native, bounded] = results;
      expect(bounded.error).toBe('');
      for (const result of results) expect(result.dom).toEqual(result.pm);
      const nativeDoc = native.doc;
      const tableIndex = nativeDoc.content!.findIndex((n) => n.type === 'table');
      const expected = {
        type: 'doc',
        content: nativeDoc.content!.flatMap((node, i) => {
          if (node.type !== 'table')
            return (i < tableIndex ? bounded.proseBefore : bounded.proseAfter) ? [node] : [];
          return [
            {
              ...node,
              content: [...new Set(bounded.cells!.map((c) => c.row))].map((row) => ({
                ...node.content![row],
                content: bounded
                  .cells!.filter((c) => c.row === row)
                  .map((c) => node.content![row].content![c.column]),
              })),
            },
          ];
        }),
      };
      expect(bounded.doc).toEqual(expected);
      expect(bounded.logical).toEqual(native.logical);
      if (native.logical.type === 'cell') {
        expect(bounded.selectedCells).toBe(bounded.cells!.length);
        for (const endpoint of ['anchor', 'head'] as const) {
          const expected = native.logical[endpoint] as { row: number; column: number };
          const rows = bounded.cells!.map((c) => c.row),
            columns = bounded.cells!.map((c) => c.column);
          expect(bounded.renderedLogical[endpoint]).toEqual({
            ...native.logical[endpoint],
            row: Math.max(Math.min(...rows), Math.min(Math.max(...rows), expected.row)),
            column: Math.max(Math.min(...columns), Math.min(Math.max(...columns), expected.column)),
          });
        }
      }
      expect(bounded.stats!.mounted).toBe(1);
      expect(bounded.stats!.maxSourceContextBytes).toBeLessThanOrEqual(16384);
      expect(bounded.stats!.maxSourceRead).toBeLessThanOrEqual(4096);
      expect(bounded.stats!.cachePages).toBeLessThanOrEqual(4);
      const destroyed = await page
        .getByTestId('bounded')
        .getByTestId('proof')
        .evaluate(async (el) => {
          const p = (el as Host).proof,
            old = p.editor!;
          p.save();
          await p.seek(p.selection.head);
          return old.isDestroyed;
        });
      expect(destroyed).toBe(true);
      await focus(page, 'bounded');
      const restored = await capture(page, 'bounded');
      await info.attach('sparse-native-restored.json', {
        body: JSON.stringify(restored),
        contentType: 'application/json',
      });
      expect(restored.logical).toEqual(native.logical);
      if (native.logical.type === 'cell')
        expect(restored.selectedCells).toBe(restored.cells!.length);
    });
  }

for (const edge of ['before', 'after'] as const)
  test(`sparse table ${edge}: repeated native deletion, eviction and chronological history`, async ({
    mount,
    page,
  }, info) => {
    await mount(Harness, { props: { sourceOverride: source } });
    await page
      .getByTestId('bounded')
      .getByTestId('proof')
      .evaluate(
        async (el, at) => {
          await (el as Host).proof.seek(at);
        },
        edge === 'before' ? 0 : source.length - 1,
      );
    const results = [];
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page
        .getByTestId(side)
        .getByTestId('proof')
        .evaluate((el, edge) => {
          const h = el as Host,
            e = h.proof?.editor ?? h.native;
          const roots: Array<{ pos: number; node: typeof e.state.doc }> = [];
          e.state.doc.forEach((node, pos) => roots.push({ node, pos }));
          const table = roots.findIndex((r) => r.node.type.name === 'table');
          const root = roots[edge === 'before' ? table - 1 : table + 1];
          e.commands.setTextSelection(root.pos + (edge === 'before' ? root.node.nodeSize - 1 : 1));
        }, edge);
      await page.keyboard.press(edge === 'before' ? 'Delete' : 'Backspace');
      await settled(page);
      await page.keyboard.press(edge === 'before' ? 'Delete' : 'Backspace');
      results.push(await capture(page, side));
    }
    await info.attach('repeat-deletion-native.json', {
      body: JSON.stringify(results),
      contentType: 'application/json',
    });
    expect(results[1].error).toBe('');
    expect(results[1].doc).toEqual(results[0].doc);
    expect(results[1].logical).toEqual(results[0].logical);
    for (const result of results) expect(result.dom).toEqual(result.pm);
    expect(
      await page
        .getByTestId('bounded')
        .getByTestId('proof')
        .evaluate(async (el) => {
          const p = (el as Host).proof,
            old = p.editor!;
          p.save();
          await p.seek(p.selection.head);
          return old.isDestroyed;
        }),
    ).toBe(true);
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.press('Control+z');
      await settled(page);
    }
    const undone = await page
      .getByTestId('bounded')
      .getByTestId('proof')
      .evaluate((el) => (el as Host).proof.service.region(0));
    expect(undone).toBe(source);
    const redone = [];
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.press('Control+Shift+z');
      redone.push(await capture(page, side));
    }
    await info.attach('repeat-deletion-redone.json', {
      body: JSON.stringify(redone),
      contentType: 'application/json',
    });
    expect(redone[1].error).toBe('');
    expect(redone[1].doc).toEqual(redone[0].doc);
    expect(redone[1].logical).toEqual(redone[0].logical);
  });

for (const backward of [false, true])
  test(`sparse mixed Chromium partial cell clear ${backward ? 'backward' : 'forward'}`, async ({
    mount,
    page,
  }, info) => {
    const source =
      'before\n\n| A | B | <!--anchor:keep:start-->KEEP<!--anchor:keep:end--> |\n| --- | --- | --- |\n' +
      Array.from({ length: 800 }, (_, i) => `| row${i} | value${i} | untouched${i} |\n`).join('') +
      '\nafter';
    await mount(Harness, { props: { sourceOverride: source, anchors: true } });
    const results = [];
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page
        .getByTestId(side)
        .getByTestId('proof')
        .evaluate(async (el, backward) => {
          const h = el as Host;
          if (h.proof) {
            const p = h.proof,
              from = p.service.region(0).indexOf('| A');
            const first = p.service.tableAddress(from, 0, 0),
              last = p.service.tableAddress(from, 800, 1);
            const anchor = backward ? last : first,
              head = backward ? first : last;
            p.selection = {
              anchor: anchor.source,
              head: head.source,
              affinity: backward ? -1 : 1,
              revision: p.service.revision,
              table: { kind: 'cell', anchor: anchor.point, head: head.point },
            };
            await p.seek(backward ? 0 : p.service.length - 1);
          } else {
            const e = h.native,
              positions: number[] = [];
            e.state.doc.descendants((node, pos) => {
              if (node.type.name === 'tableCell' || node.type.name === 'tableHeader')
                positions.push(pos);
            });
            e.commands.setCellSelection({
              anchorCell: positions[backward ? 800 * 3 + 1 : 0],
              headCell: positions[backward ? 0 : 800 * 3 + 1],
            });
          }
        }, backward);
      await focus(page, side);
      await page.keyboard.press(backward ? 'Backspace' : 'Delete');
      results.push(await capture(page, side));
    }
    await info.attach('partial-clear-native.json', {
      body: JSON.stringify(results),
      contentType: 'application/json',
    });
    const [native, bounded] = results;
    expect(bounded.error).toBe('');
    expect(bounded.logical).toEqual(native.logical);
    for (const result of results) expect(result.dom).toEqual(result.pm);
    const tableIndex = native.doc.content!.findIndex((n) => n.type === 'table');
    const cropped = {
      type: 'doc',
      content: native.doc.content!.flatMap((node, i) =>
        node.type === 'table'
          ? [
              {
                ...node,
                content: [...new Set(bounded.cells!.map((c) => c.row))].map((row) => ({
                  ...node.content![row],
                  content: bounded
                    .cells!.filter((c) => c.row === row)
                    .map((c) => node.content![row].content![c.column]),
                })),
              },
            ]
          : (i < tableIndex ? bounded.proseBefore : bounded.proseAfter)
            ? [node]
            : [],
      ),
    };
    // The physical crop may end at a table. Ask the actual native configuration
    // to apply its trailing-node lifecycle to this independent oracle crop.
    await focus(page, 'native');
    await page
      .getByTestId('native')
      .getByTestId('proof')
      .evaluate((el, doc) => {
        (el as Host).native.commands.setContent(doc);
      }, cropped);
    const croppedNative = await capture(page, 'native');
    await info.attach('partial-clear-cropped-native.json', {
      body: JSON.stringify(croppedNative),
      contentType: 'application/json',
    });
    // Mixed prose windows preserve the native full-document context; a standalone
    // table window follows the previously approved isolated native lifecycle.
    expect(bounded.doc).toEqual(
      bounded.proseBefore || bounded.proseAfter ? cropped : croppedNative.doc,
    );
    const saved = await page
      .getByTestId('bounded')
      .getByTestId('proof')
      .evaluate(async (el) => {
        const p = (el as Host).proof,
          old = p.editor!;
        p.save();
        await p.seek(p.selection.head);
        return { source: p.service.region(0), destroyed: old.isDestroyed };
      });
    expect(saved.destroyed).toBe(true);
    expect(saved.source).toContain('<!--anchor:keep:start-->KEEP<!--anchor:keep:end-->');
    expect(saved.source).toContain('untouched400');
    await focus(page, 'bounded');
    await page.keyboard.press('Control+z');
    await settled(page);
    expect(
      await page
        .getByTestId('bounded')
        .getByTestId('proof')
        .evaluate((el) => (el as Host).proof.service.region(0)),
    ).toBe(source);
    await page.keyboard.press('Control+Shift+z');
    await settled(page);
    expect(
      await page
        .getByTestId('bounded')
        .getByTestId('proof')
        .evaluate((el) => (el as Host).proof.service.region(0)),
    ).toBe(saved.source);
  });

for (const edge of ['before', 'after'] as const)
  for (const backward of [false, true])
    for (const gesture of ['shift', 'pointer'] as const)
      test(`sparse mixed ${edge} ${gesture} ${backward ? 'backward' : 'forward'} selection`, async ({
        mount,
        page,
      }, info) => {
        await mount(Harness, { props: { sourceOverride: source } });
        await focus(page, 'bounded');
        await page
          .getByTestId('bounded')
          .getByTestId('proof')
          .evaluate(
            async (el, at) => {
              await (el as Host).proof.seek(at);
            },
            edge === 'before' ? 0 : source.length - 1,
          );
        const results = [];
        for (const side of ['native', 'bounded']) {
          await focus(page, side);
          const endpoints = await page
            .getByTestId(side)
            .getByTestId('proof')
            .evaluate(
              (el, { edge, backward, gesture }) => {
                const h = el as Host,
                  e = h.proof?.editor ?? h.native;
                const roots: Array<{ pos: number; node: typeof e.state.doc }> = [];
                e.state.doc.forEach((node, pos) => roots.push({ node, pos }));
                const table = roots.findIndex((r) => r.node.type.name === 'table');
                const a = roots[edge === 'before' ? table - 1 : table],
                  b = roots[edge === 'before' ? table : table + 1];
                let left = -1,
                  right = -1;
                if (a.node.isTextblock) left = a.pos + a.node.nodeSize - 1;
                else
                  a.node.descendants((node, pos) => {
                    if (node.isTextblock) left = a.pos + 1 + pos + node.nodeSize - 1;
                  });
                if (b.node.isTextblock) right = b.pos + 1;
                else
                  b.node.descendants((node, pos) => {
                    if (node.isTextblock && right < 0) right = b.pos + 2 + pos;
                  });
                const first =
                    gesture === 'shift'
                      ? backward
                        ? right
                        : left
                      : backward
                        ? right + 1
                        : left - 1,
                  last = backward ? left - 1 : right + 1;
                e.chain().setTextSelection(first).scrollIntoView().run();
                return { first, last };
              },
              { edge, backward, gesture },
            );
          await settled(page);
          const prepared = await capture(page, side);
          await info.attach(`prepared-${side}.json`, {
            body: JSON.stringify({ endpoints, prepared }),
            contentType: 'application/json',
          });
          expect(prepared.pm).toEqual({ anchor: endpoints.first, head: endpoints.first });
          await page
            .getByTestId(side)
            .getByTestId('proof')
            .evaluate((el) => {
              const h = el as Host & { selectionTrace: unknown[] },
                e = h.proof?.editor ?? h.native;
              const trace = (h.selectionTrace = [] as unknown[]);
              const createSelection = e.view.props.createSelectionBetween;
              e.view.setProps({
                createSelectionBetween: (view, anchor, head) => {
                  trace.push({
                    kind: 'selectionBetween',
                    anchor: anchor.pos,
                    head: head.pos,
                    anchorParent: anchor.parent.type.name,
                    headParent: head.parent.type.name,
                  });
                  return createSelection?.(view, anchor, head) ?? null;
                },
              });

              const dom = () => {
                const d = window.getSelection()!;
                return {
                  anchor: e.view.posAtDOM(d.anchorNode!, d.anchorOffset),
                  head: e.view.posAtDOM(d.focusNode!, d.focusOffset),
                };
              };
              e.on('transaction', ({ transaction }) =>
                trace.push({
                  kind: 'transaction',
                  before: transaction.before.content.size,
                  selection: transaction.selection.toJSON(),
                  steps: transaction.steps.map((s) => s.toJSON()),
                  meta: Object.keys((transaction as unknown as { meta: object }).meta),
                }),
              );
              for (const name of ['keydown', 'keyup'])
                e.view.dom.addEventListener(
                  name,
                  (event) => {
                    const key = event as KeyboardEvent;
                    trace.push({
                      kind: name,
                      key: key.key,
                      shift: key.shiftKey,
                      selection: e.state.selection.toJSON(),
                      dom: dom(),
                      focused: e.view.hasFocus(),
                    });
                  },
                  true,
                );
            });
          if (gesture === 'shift')
            await page.keyboard.press(backward ? 'Shift+ArrowLeft' : 'Shift+ArrowRight');
          else {
            const coords = await page
              .getByTestId(side)
              .getByTestId('proof')
              .evaluate((el, p) => {
                const h = el as Host,
                  e = h.proof?.editor ?? h.native,
                  scroller = e.view.dom.parentElement!.parentElement!;
                const a = e.view.coordsAtPos(p.first),
                  b = e.view.coordsAtPos(p.last);
                scroller.scrollTop +=
                  (Math.min(a.top, b.top) + Math.max(a.bottom, b.bottom)) / 2 -
                  (scroller.getBoundingClientRect().top + scroller.clientHeight / 2);
                const point = (at: number) => {
                  const r = e.view.coordsAtPos(at);
                  return { x: r.left, y: (r.top + r.bottom) / 2 };
                };
                return { first: point(p.first), last: point(p.last) };
              }, endpoints);
            await page.mouse.move(coords.first.x, coords.first.y);
            await page.mouse.down();
            await page.mouse.move(coords.last.x, coords.last.y, { steps: 8 });
            await page.mouse.up();
          }
          results.push(await capture(page, side));
          const trace = await page
            .getByTestId(side)
            .getByTestId('proof')
            .evaluate((el) => (el as Host & { selectionTrace: unknown[] }).selectionTrace);
          await info.attach(`selection-trace-${side}.json`, {
            body: JSON.stringify(trace),
            contentType: 'application/json',
          });
        }
        await info.attach('sparse-selection.json', {
          body: JSON.stringify(results),
          contentType: 'application/json',
        });
        for (const result of results) {
          expect(result.error).toBe('');
          expect(result.dom).toEqual(result.pm);
        }
        expect(results[1].logical).toEqual(results[0].logical);
        expect(results[1].stats!.mounted).toBe(1);
        expect(results[1].stats!.maxSourceContextBytes).toBeLessThanOrEqual(16384);
        expect(results[1].stats!.cachePages).toBeLessThanOrEqual(4);
      });

for (const neighbor of ['paragraph', 'fence'] as const)
  for (const clipped of [false, true])
    test(`native raw boundary ${neighbor} ${clipped ? 'clipped' : 'complete'} header replacement`, async ({
      mount,
      page,
    }, info) => {
      const header = clipped ? '**wide 🌍** '.repeat(800).trim() : 'Long **header café 🌍**';
      const before = neighbor === 'fence' ? '```text\nbefore café 🌍\n```' : 'before **café 🌍**';
      const source =
        before +
        '\n\n| ' +
        header +
        ' | <!--anchor:keep:point-->KEEP |\n| --- | --- |\n' +
        Array.from({ length: 800 }, (_, i) => `| row${i} | value${i} |\n`).join('') +
        '\nafter café 🌍';
      await mount(Harness, { props: { sourceOverride: source, anchors: true } });
      const selected = [],
        edited = [];
      for (const side of ['native', 'bounded']) {
        await focus(page, side);
        await page
          .getByTestId(side)
          .getByTestId('proof')
          .evaluate(async (el) => {
            const h = el as Host;
            if (h.proof) await h.proof.seek(h.proof.service.length - 1);
            const e = h.proof?.editor ?? h.native;
            e.chain()
              .setTextSelection(e.state.doc.content.size - e.state.doc.lastChild!.nodeSize + 1)
              .scrollIntoView()
              .run();
          });
        await settled(page);
        await page.keyboard.press('Shift+ArrowLeft');
        await settled(page);
        selected.push(
          await page
            .getByTestId(side)
            .getByTestId('proof')
            .evaluate((el) => {
              const h = el as Host,
                p = h.proof,
                e = p?.editor ?? h.native,
                s = e.state.selection;
              const table =
                p?.projection?.table ??
                p?.projection?.mixed?.parts.find((part) => part.projection.table)?.projection.table;
              const paragraph = table?.paragraphs.find(
                (b) =>
                  b.cell.from === p.selection.table?.head.cell &&
                  b.block === p.selection.table?.head.block,
              );
              const dom = window.getSelection()!;
              const rect = e.view.coordsAtPos(s.head),
                viewport = e.view.dom.parentElement!.parentElement!.getBoundingClientRect();
              return {
                range: {
                  type: s.toJSON().type,
                  anchor: p?.selection.table?.anchor.offset ?? s.$anchor.parentOffset,
                  head: p?.selection.table?.head.offset ?? s.$head.parentOffset,
                },
                parent: s.$head.parent.toJSON(),
                crop: paragraph?.offset ?? 0,
                pm: { anchor: s.anchor, head: s.head },
                dom: {
                  anchor: e.view.posAtDOM(dom.anchorNode!, dom.anchorOffset),
                  head: e.view.posAtDOM(dom.focusNode!, dom.focusOffset),
                },
                visible: rect.bottom >= viewport.top && rect.top <= viewport.bottom,
                source: p?.service.region(0),
                error: p?.error ?? '',
                stats: p?.snapshot(),
              };
            }),
        );
        await page.keyboard.insertText('EDIT');
        await settled(page);
        edited.push(await capture(page, side));
      }
      await info.attach('raw-boundary-native-selection.json', {
        body: JSON.stringify({ selected, edited }),
        contentType: 'application/json',
      });
      expect(selected[1].range).toEqual(selected[0].range);
      expect(selected[1].source).toBe(source);
      const expectedCrop = await page
        .getByTestId('native')
        .getByTestId('proof')
        .evaluate(
          (el, data) => {
            const schema = (el as Host).native.schema;
            const full = schema.nodeFromJSON(data.parent),
              mounted = schema.nodeFromJSON(data.mounted);
            return full.cut(data.crop, data.crop + mounted.content.size).toJSON();
          },
          { parent: selected[0].parent, mounted: selected[1].parent, crop: selected[1].crop },
        );
      expect(selected[1].parent).toEqual(expectedCrop);
      for (const s of selected) {
        expect(s.dom).toEqual(s.pm);
        expect(s.visible).toBe(true);
        expect(s.error).toBe('');
      }
      expect(edited[1].error).toBe('');
      const saved = await page
        .getByTestId('bounded')
        .getByTestId('proof')
        .evaluate(async (el) => {
          const h = el as Host,
            p = h.proof,
            value = p.service.region(0),
            old = p.editor!;
          const fresh = await h.parseSource(value);
          p.save();
          await p.seek(p.service.length - 1);
          return { value, fresh: fresh.doc, destroyed: old.isDestroyed, stats: p.snapshot() };
        });
      expect(saved.fresh).toEqual(edited[0].doc);
      expect(saved.value).toContain('<!--anchor:keep:point-->KEEP');
      expect(saved.value.slice(saved.value.indexOf('| <!--anchor:keep:point-->'))).toBe(
        source.slice(source.indexOf('| <!--anchor:keep:point-->')),
      );
      expect(saved.value.startsWith(before + '\n\n| ')).toBe(true);
      expect(saved.destroyed).toBe(true);
      expect(saved.stats.maxSourceContextBytes).toBeLessThanOrEqual(16384);
      expect(saved.stats.cachePages).toBeLessThanOrEqual(4);
      expect(saved.stats.mounted).toBe(1);
      await focus(page, 'bounded');
      await page.keyboard.press('Control+z');
      await settled(page);
      expect(
        await page
          .getByTestId('bounded')
          .getByTestId('proof')
          .evaluate((el) => (el as Host).proof.service.region(0)),
      ).toBe(source);
      await page.keyboard.press('Control+Shift+z');
      await settled(page);
      expect(
        await page
          .getByTestId('bounded')
          .getByTestId('proof')
          .evaluate((el) => (el as Host).proof.service.region(0)),
      ).toBe(saved.value);
    });
