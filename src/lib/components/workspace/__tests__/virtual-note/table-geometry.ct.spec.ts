import { test, expect } from '../../../../../test/ct-test';
import Harness from './DocumentProofHarness.svelte';
import { settled, type Host } from './paragraph-browser';

const source =
  '| ' +
  Array.from({ length: 100 }, (_, c) => `H${c}`).join(' | ') +
  ' |\n| ' +
  Array(100).fill('---').join(' | ') +
  ' |\n' +
  Array.from(
    { length: 240 },
    (_, r) =>
      '| ' +
      Array.from({ length: 100 }, (_, c) =>
        r === 99 && c === 44 ? 'W'.repeat(1800) : `r${r}c${c}`,
      ).join(' | ') +
      ' |',
  ).join('\n');

test('encountered offscreen text corrects row height while the visible caret keeps its pixel anchor', async ({
  mount,
  page,
}, info) => {
  await mount(Harness, { props: { sourceOverride: source } });
  const root = page.getByTestId('proof');
  await expect(root.locator('.tiptap')).toHaveCount(1);
  await root.evaluate(async (el) => {
    const p = (el as Host).proof;
    await p.seek(p.service.region(0).indexOf('r101c42'));
    const at = p.service.region(0).indexOf('r101c42') + 3;
    p.editor!.commands.setTextSelection(p.projection!.pmAt(at));
    p.editor!.view.focus();
  });
  await settled(page);
  const before = await root.evaluate((el) => {
    const p = (el as Host).proof;
    return {
      point: p.selection,
      coords: p.editor!.view.coordsAtPos(p.editor!.state.selection.head),
      doc: p.editor!.getJSON(),
      width: p.tableColumnWidth,
      window: p.projection!.table!.window,
    };
  });
  // The selected logical row is102; load row100 above it without moving the caret.
  await root.evaluate((el) => {
    const p = (el as Host).proof,
      s = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
    s.scrollTop = 41 * 100;
    s.scrollLeft = p.tableColumnWidth * 40;
  });
  await expect
    .poll(() =>
      root.evaluate((el) => {
        const p = (el as Host).proof;
        return p.projection!.table!.window.cells.some((c) => c.row === 100 && c.column === 40);
      }),
    )
    .toBe(true);
  const anchored = await root.evaluate((el) => {
    const p = (el as Host).proof;
    return {
      point: p.selection,
      coords: p.editor!.view.coordsAtPos(p.editor!.state.selection.head),
      geometry: p.projection!.table!.window.geometry,
    };
  });
  await root.evaluate((el) => {
    const p = (el as Host).proof,
      s = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
    s.scrollLeft = p.tableColumnWidth * 40 + p.tableColumnWidth - 1;
  });
  await expect
    .poll(() =>
      root.evaluate((el) => {
        const p = (el as Host).proof;
        return p.projection!.table!.window.cells.some((c) => c.row === 100 && c.column === 44);
      }),
    )
    .toBe(true);
  await settled(page);
  const after = await root.evaluate((el) => {
    const p = (el as Host).proof;
    return {
      point: p.selection,
      native: p.projection!.table!.pointAt(p.editor!.state.selection.head),
      coords: p.editor!.view.coordsAtPos(p.editor!.state.selection.head),
      geometry: p.projection!.table!.window.geometry,
      stats: p.snapshot(),
      error: p.error,
    };
  });
  await info.attach('table-height-anchor.json', {
    body: JSON.stringify({ before, anchored, after }),
    contentType: 'application/json',
  });
  expect(after.error).toBe('');
  expect(after.geometry!.heights[0]).toBeGreaterThan(41);
  expect(after.point.table).toEqual(anchored.point.table);
  expect(after.native).toEqual(anchored.point.table!.head);
  expect(Math.abs(after.coords.top - anchored.coords.top)).toBeLessThanOrEqual(1);
  expect(after.stats.maxSourceContextBytes).toBeLessThanOrEqual(4096);
  expect(after.stats.pmNodes).toBeLessThanOrEqual(256);
});

test('viewport resize and font changes preserve logical and pixel caret anchors', async ({
  mount,
  page,
}, info) => {
  await mount(Harness, {
    props: {
      sourceOverride:
        '| H | R |\n| --- | --- |\n| ' + 'word '.repeat(120) + 'TARGET tail | right |',
    },
  });
  const root = page.getByTestId('proof');
  await expect(root.locator('.tiptap')).toHaveCount(1);
  await root.evaluate(async (el) => {
    const p = (el as Host).proof,
      at = p.service.region(0).indexOf('TARGET') + 2;
    await p.seek(at);
    p.editor!.commands.setTextSelection(p.projection!.pmAt(at));
    p.editor!.view.focus();
  });
  await settled(page);
  const snapshot = () =>
    root.evaluate((el) => {
      const p = (el as Host).proof;
      return {
        point: p.selection.table,
        coords: p.editor!.view.coordsAtPos(p.editor!.state.selection.head),
        geometry: p.projection!.table!.window.geometry,
        stats: p.snapshot(),
      };
    });
  const before = await snapshot();
  await root.evaluate((el) => {
    el.querySelector<HTMLElement>('[data-testid="editor-host"]')!.parentElement!.style.width =
      '620px';
  });
  await expect.poll(() => root.evaluate((el) => (el as Host).proof.tableColumnWidth)).toBe(310);
  await settled(page);
  const resized = await snapshot();
  await root.evaluate((el) => {
    const p = (el as Host).proof;
    p.editor!.view.dom.style.fontSize = '20px';
    p.editor!.view.dom.style.lineHeight = '30px';
  });
  await expect
    .poll(() =>
      root.evaluate((el) =>
        (el as Host).proof.projection!.table!.window.geometry!.font.includes('20px|30px'),
      ),
    )
    .toBe(true);
  await settled(page);
  const changedFont = await snapshot();
  await info.attach('table-resize-font-anchor.json', {
    body: JSON.stringify({ before, resized, changedFont }),
    contentType: 'application/json',
  });
  for (const after of [resized, changedFont]) {
    expect(after.point).toEqual(before.point);
    expect(Math.abs(after.coords.top - before.coords.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.coords.left - before.coords.left)).toBeLessThanOrEqual(1);
    expect(after.stats.maxSourceContextBytes).toBeLessThanOrEqual(4096);
  }
});
