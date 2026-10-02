import { test, expect } from '../../../../../test/ct-test';
import Pair from './ParagraphProofHarness.svelte';
import { settled, type Host } from './paragraph-browser';
import type { CellSelection } from '@tiptap/pm/tables';

const source =
  '| ' +
  Array.from({ length: 8 }, (_, c) => `H${c}`).join(' | ') +
  ' |\n| ' +
  Array(8).fill('---').join(' | ') +
  ' |\n' +
  Array.from(
    { length: 3 },
    (_, r) => '| ' + Array.from({ length: 8 }, (_, c) => `r${r}c${c}`).join(' | ') + ' |',
  ).join('\n');

test('native cell pointer selection crosses a projected column edge without disabling the drag', async ({
  mount,
  page,
}, info) => {
  await mount(Pair, { props: { sourceOverride: source } });
  const results = [];
  for (const side of ['native', 'bounded']) {
    const root = page.getByTestId(side).getByTestId('proof');
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
    await settled(page);
    const start = await point('r0c1');
    expect(
      await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.closest('td')?.textContent,
        start,
      ),
    ).toBe('r0c1');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    try {
      // Establish the native cell-drag anchor before scrolling its original
      // screen coordinates away; the native plugin initially resolves that point.
      const next = await point('r1c1');
      await page.mouse.move(next.x, next.y, { steps: 4 });
      await root.evaluate((el) => {
        const host = el.querySelector('[data-testid="editor-host"]')!;
        host.parentElement!.scrollLeft = 183 * 2;
      });
      await expect.poll(() => root.locator('td').allTextContents()).toContain('r1c4');
      const end = await point('r1c4');
      await page.mouse.move(end.x, end.y, { steps: 8 });
    } finally {
      await page.mouse.up();
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
    expect(result.anchor).toBe('r0c1');
    expect(result.head).toBe('r1c4');
    if (result.stats) expect(result.stats.maxSourceContextBytes).toBeLessThanOrEqual(4096);
  }
  expect(results[1].anchor).toBe(results[0].anchor);
  expect(results[1].head).toBe(results[0].head);
});
