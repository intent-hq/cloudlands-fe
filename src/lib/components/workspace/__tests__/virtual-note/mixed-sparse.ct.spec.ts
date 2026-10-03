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
      const part = h.proof?.projection?.mixed?.parts.find((p) => p.projection.table)?.projection
        .table;
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
      const dom = window.getSelection()!;
      return {
        doc: e.getJSON(),
        selection: json,
        logical: {
          type: json.type,
          anchor: endpoint(json.anchor ?? s.anchor),
          head: endpoint(json.head ?? s.head),
        },
        pm: { anchor: s.anchor, head: s.head },
        dom: {
          anchor: e.view.posAtDOM(dom.anchorNode!, dom.anchorOffset),
          head: e.view.posAtDOM(dom.focusNode!, dom.focusOffset),
        },
        cells,
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
            return (edge === 'before' ? i < tableIndex : i > tableIndex) ? [node] : [];
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
      expect(restored.logical).toEqual(native.logical);
    });
  }
