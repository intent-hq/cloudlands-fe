import { test, expect } from '../../../../../test/ct-test';
import Pair from './ParagraphProofHarness.svelte';
import { settled, type Host } from './paragraph-browser';
import type { CellSelection } from '@tiptap/pm/tables';

const tableSource = (rows: number) =>
  '| ' +
  Array.from({ length: 8 }, (_, c) => `H${c}`).join(' | ') +
  ' |\n| ' +
  Array(8).fill('---').join(' | ') +
  ' |\n' +
  Array.from(
    { length: rows },
    (_, r) => '| ' + Array.from({ length: 8 }, (_, c) => `r${r}c${c}`).join(' | ') + ' |',
  ).join('\n');

for (const gesture of [
  {
    name: 'column',
    rows: 3,
    start: 'r0c1',
    neighbor: 'r1c1',
    end: 'r1c4',
    initialTop: 0,
    top: 0,
    left: 366,
  },
  {
    name: 'forward row',
    rows: 60,
    start: 'r0c1',
    neighbor: 'r1c1',
    end: 'r14c1',
    initialTop: 0,
    top: 410,
    left: 0,
  },
  {
    name: 'backward row',
    rows: 60,
    start: 'r14c1',
    neighbor: 'r13c1',
    end: 'r1c1',
    initialTop: 410,
    top: 0,
    left: 0,
  },
])
  test(`native cell pointer selection crosses a projected ${gesture.name} edge without disabling the drag`, async ({
    mount,
    page,
  }, info) => {
    await mount(Pair, { props: { sourceOverride: tableSource(gesture.rows) } });
    const results = [];
    for (const side of ['native', 'bounded']) {
      const root = page.getByTestId(side).getByTestId('proof');
      const phases: unknown[] = [];
      const capture = async (phase: string) => {
        phases.push({
          phase,
          ...(await root.evaluate((el) => {
            const h = el as Host,
              editor = h.proof?.editor ?? h.native;
            const plugin = editor!.state.plugins.find((p) =>
              (p as unknown as { key: string }).key.startsWith('selectingCells'),
            );
            return {
              selection: editor!.state.selection.toJSON(),
              dragAnchor: plugin?.getState(editor!.state),
              logical: h.proof?.selection.table,
            };
          })),
        });
      };
      await expect(root.locator('.tiptap')).toHaveCount(1);
      if (side === 'native')
        await root.evaluate((el) => {
          const editor = (el as Host).native,
            dom = editor.view.dom;
          dom.classList.add('proof-table-projection');
          dom.style.setProperty('--proof-column-width', '183px');
          dom.style.setProperty('--proof-table-width', `${183 * 8}px`);
          dom.style.width = `${183 * 8}px`;
          Object.assign(dom.querySelector('table')!.parentElement!.style, {
            position: 'static',
            left: 'auto',
            transform: 'none',
            width: '100%',
            minWidth: '0',
            maxWidth: 'none',
            overflow: 'visible',
          });
        });
      const point = (text: string) =>
        root.evaluate((el, text) => {
          const h = el as Host,
            editor = h.proof?.editor ?? h.native;
          const cell = Array.from(editor!.view.dom.querySelectorAll('td')).find(
            (c) => c.textContent === text,
          )!;
          const node = cell.querySelector('p')!.firstChild!;
          const rect = editor!.view.coordsAtPos(editor!.view.posAtDOM(node, 1));
          return { x: rect.left, y: (rect.top + rect.bottom) / 2 };
        }, text);
      if (gesture.initialTop)
        await root.evaluate((el, top) => {
          el.querySelector('[data-testid="editor-host"]')!.parentElement!.scrollTop = top;
        }, gesture.initialTop);
      await expect.poll(() => root.locator('td').allTextContents()).toContain(gesture.start);
      await settled(page);
      const start = await point(gesture.start);
      expect(
        await page.evaluate(
          ({ x, y }) => document.elementFromPoint(x, y)?.closest('td')?.textContent,
          start,
        ),
      ).toBe(gesture.start);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      try {
        // Establish the native cell-drag anchor before scrolling its original
        // screen coordinates away; the native plugin initially resolves that point.
        const next = await point(gesture.neighbor);
        await page.mouse.move(next.x, next.y, { steps: 4 });
        await capture('established');
        await root.evaluate(
          (el, scroll) => {
            const host = el.querySelector('[data-testid="editor-host"]')!;
            host.parentElement!.scrollLeft = scroll.left;
            host.parentElement!.scrollTop = scroll.top;
          },
          { left: gesture.left, top: gesture.top },
        );
        await expect.poll(() => root.locator('td').allTextContents()).toContain(gesture.end);
        await capture('paged');
        const end = await point(gesture.end);
        await page.mouse.move(end.x, end.y, { steps: 8 });
        await capture('moved');
      } finally {
        await page.mouse.up();
        await capture('released');
        await info.attach(`table-${side}-pointer-phases.json`, {
          body: JSON.stringify(phases),
          contentType: 'application/json',
        });
      }
      await settled(page);
      const result = await root.evaluate((el) => {
        const h = el as Host,
          editor = h.proof?.editor ?? h.native;
        const selection = editor!.state.selection as CellSelection;
        return {
          type: selection.toJSON().type,
          anchor: selection.$anchorCell?.nodeAfter?.textContent,
          head: selection.$headCell?.nodeAfter?.textContent,
          stats: h.proof?.snapshot(),
        };
      });
      results.push({ side, ...result });
      await info.attach(`table-${side}-pointer.json`, {
        body: JSON.stringify(result),
        contentType: 'application/json',
      });
      expect(result.type).toBe('cell');
      expect(result.anchor).toBe(gesture.start);
      expect(result.head).toBe(gesture.end);
      if (result.stats) expect(result.stats.maxSourceContextBytes).toBeLessThanOrEqual(4096);
    }
    expect(results[1].anchor).toBe(results[0].anchor);
    expect(results[1].head).toBe(results[0].head);
  });
