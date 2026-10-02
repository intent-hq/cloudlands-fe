import { test, expect } from '../../../../../test/ct-test';
import type { Page } from '@playwright/test';
import Harness from './DocumentProofHarness.svelte';
import Pair from './ParagraphProofHarness.svelte';
import { focus, settled, type Host } from './paragraph-browser';

async function select(page: Page, side: string, needle: string, offset = 0) {
  await focus(page, side);
  await page
    .getByTestId(side)
    .getByTestId('proof')
    .evaluate(
      (el, { needle, offset }) => {
        const h = el as Host,
          e = h.proof?.editor ?? h.native;
        let at = -1;
        if (h.proof)
          at = h.proof.projection!.pmAt(h.proof.service.region(0).indexOf(needle) + offset);
        else
          e.state.doc.descendants((node, pos) => {
            if (node.type.name === 'paragraph' && node.textContent.includes(needle))
              at = pos + 1 + node.textContent.indexOf(needle) + offset;
          });
        if (at < 0) throw new Error('Native table fixture missing');
        e.commands.setTextSelection(at);
      },
      { needle, offset },
    );
  await settled(page);
}
async function compare(page: Page) {
  await settled(page);
  const result = await page.evaluate(() => {
    const p = (document.querySelector('[data-testid="bounded"] [data-testid="proof"]') as Host)
      .proof;
    const n = (document.querySelector('[data-testid="native"] [data-testid="proof"]') as Host)
      .native;
    return {
      actual: p.editor!.getJSON(),
      expected: n.getJSON(),
      selection: p.editor!.state.selection.toJSON(),
      nativeSelection: n.state.selection.toJSON(),
      error: p.error,
      stats: p.snapshot(),
    };
  });
  expect(result.error).toBe('');
  expect(result.actual).toEqual(result.expected);
  expect(result.selection).toEqual(result.nativeSelection);
  expect(result.stats.maxSourceContextBytes).toBeLessThanOrEqual(4096);
  expect(result.stats.pmNodes).toBeLessThanOrEqual(256);
  expect(result.stats.cacheBytes).toBeLessThanOrEqual(16384);
  return result;
}
const small = '| **H** | R |\n| :--- | ---: |\n| prefixTARGETsuffix | right |\n| bottom | last |';

test('native table typing, Enter, save and destroyed-view history retain exact live cells', async ({
  mount,
  page,
}, info) => {
  await mount(Pair, { props: { sourceOverride: small } });
  for (const side of ['native', 'bounded']) {
    await select(page, side, 'TARGET', 2);
    await page.keyboard.type('edit');
    await page.keyboard.press('Enter');
    await page.keyboard.type('tail');
  }
  const live = await compare(page);
  const result = await page
    .getByTestId('bounded')
    .getByTestId('proof')
    .evaluate(async (el) => {
      const p = (el as Host).proof,
        old = p.editor!;
      p.save();
      await p.seek(p.selection.head);
      return {
        destroyed: old.isDestroyed,
        doc: p.editor!.getJSON(),
        selection: p.editor!.state.selection.toJSON(),
        stats: p.snapshot(),
      };
    });
  expect(result.destroyed).toBe(true);
  expect(result.doc).toEqual(live.actual);
  expect(result.selection).toEqual(live.selection);
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page.keyboard.press('Control+z');
  }
  await compare(page);
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page.keyboard.press('Control+Shift+z');
  }
  await compare(page);
  await info.attach('table-live-history.json', {
    body: JSON.stringify({ live, result }),
    contentType: 'application/json',
  });
});

test('native table text copy, cut and paste retain clipboard, marks and untouched source', async ({
  mount,
  page,
  context,
}, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await mount(Pair, { props: { sourceOverride: small } });
  const copies = [];
  for (const side of ['native', 'bounded']) {
    await select(page, side, 'TARGET');
    for (let n = 0; n < 6; n++) {
      await page.keyboard.press('Shift+ArrowRight');
      await settled(page);
      expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
        'TARGET'.slice(0, n + 1),
      );
    }
    await page.keyboard.press('Control+c');
    copies.push(await page.evaluate(() => navigator.clipboard.readText()));
    await page.keyboard.press('Control+x');
  }
  expect(copies).toEqual(['TARGET', 'TARGET']);
  await compare(page);
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page.keyboard.press('Control+v');
  }
  const result = await compare(page);
  expect(
    await page
      .getByTestId('bounded')
      .getByTestId('proof')
      .evaluate((el) => (el as Host).proof.service.region(0)),
  ).toBe(small);
  await info.attach('table-clipboard.json', {
    body: JSON.stringify({ copies, result }),
    contentType: 'application/json',
  });
});

test('table widths remain stable through real horizontal and vertical viewport eviction', async ({
  mount,
  page,
}, info) => {
  const columns = 100,
    rows = 240;
  const source =
    '| ' +
    Array.from({ length: columns }, (_, c) => `H${c}`).join(' | ') +
    ' |\n| ' +
    Array(columns).fill('---').join(' | ') +
    ' |\n' +
    Array.from(
      { length: rows },
      (_, r) => '| ' + Array.from({ length: columns }, (_, c) => `r${r}c${c}`).join(' | ') + ' |',
    ).join('\n');
  await mount(Harness, { props: { sourceOverride: source } });
  const root = page.getByTestId('proof');
  await expect(root.locator('.tiptap')).toHaveCount(1);
  const before = await root.evaluate((el) => {
    const p = (el as Host).proof;
    return { width: p.tableColumnWidth, created: p.created };
  });
  await root.evaluate((el) => {
    const p = (el as Host).proof,
      scroller = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
    scroller.scrollLeft = p.tableColumnWidth * 40;
    scroller.scrollTop = 64 * 100;
  });
  await expect
    .poll(() =>
      root.evaluate((el) => {
        const p = (el as Host).proof;
        return (
          p.projection?.table?.window.cells.some((c) => c.row === 100 && c.column === 40) ?? false
        );
      }),
    )
    .toBe(true);
  const after = await root.evaluate((el) => {
    const p = (el as Host).proof;
    return {
      width: p.tableColumnWidth,
      stats: p.snapshot(),
      widths: Array.from(
        p.editor!.view.dom.querySelectorAll('th,td'),
        (cell) => cell.getBoundingClientRect().width,
      ),
      dom: p.editor!.view.dom.querySelectorAll('*').length,
      viewport: (() => {
        const scroller = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
        const rect = scroller.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          width: scroller.clientWidth,
          height: scroller.clientHeight,
        };
      })(),
      cells: Array.from(p.editor!.view.dom.querySelectorAll('th,td'), (cell) => {
        const rect = cell.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      }),
    };
  });
  await info.attach('table-scroll-geometry.json', {
    body: JSON.stringify({ before, after }),
    contentType: 'application/json',
  });
  expect(after.width).toBe(before.width);
  expect(after.stats.destroyed).toBeGreaterThan(0);
  expect(after.stats.maxSourceContextBytes).toBeLessThanOrEqual(4096);
  expect(after.stats.tableCells).toBeLessThanOrEqual(25);
  expect(after.dom).toBeLessThan(256);
  for (const width of after.widths) expect(Math.abs(width - before.width)).toBeLessThanOrEqual(1);
  await expect(root.locator('.tiptap')).toHaveCount(1);
  await info.attach('table-scroll-bounds.json', {
    body: JSON.stringify({
      before,
      after,
      mockRows: rows,
      mockColumns: columns,
      mockSourceBytes: new TextEncoder().encode(source).length,
    }),
    contentType: 'application/json',
  });
  await info.attach('table-scroll.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('oversized unbreakable cells wrap inside stable columns and resize keeps the logical caret', async ({
  mount,
  page,
}, info) => {
  const source =
    '| H | R |\n| --- | --- |\n| ' +
    'x'.repeat(120000) +
    'TARGET' +
    'y'.repeat(120000) +
    ' | right |';
  await mount(Harness, { props: { sourceOverride: source } });
  const root = page.getByTestId('proof');
  await expect(root.locator('.tiptap')).toHaveCount(1);
  await root.evaluate(async (el, at) => {
    const p = (el as Host).proof;
    await p.seek(at);
    p.editor!.commands.setTextSelection(p.projection!.pmAt(at));
  }, source.indexOf('TARGET'));
  const result = await root.evaluate((el) => {
    const p = (el as Host).proof,
      selection = structuredClone(p.selection),
      cell = p.editor!.view.dom.querySelector('td')!;
    const before = {
      width: cell.getBoundingClientRect().width,
      client: cell.clientWidth,
      scroll: cell.scrollWidth,
    };
    p.resizeTable(420);
    return {
      before,
      after: {
        width: cell.getBoundingClientRect().width,
        client: cell.clientWidth,
        scroll: cell.scrollWidth,
      },
      selection,
      actual: p.selection,
      stats: p.snapshot(),
    };
  });
  expect(result.actual).toEqual(result.selection);
  expect(result.before.scroll).toBeLessThanOrEqual(result.before.client + 1);
  expect(result.after.scroll).toBeLessThanOrEqual(result.after.client + 1);
  expect(result.after.width).toBeCloseTo(210, 0);
  expect(result.stats.maxSourceContextBytes).toBeLessThanOrEqual(4096);
  await info.attach('table-wrap-resize.json', {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
});
