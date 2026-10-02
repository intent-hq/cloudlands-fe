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

test('actual table glyph resizing preserves the native caret and invalidates row measurements', async ({
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
    const p = (el as Host).proof;
    const at = p.service.region(0).indexOf('TARGET') + 2;
    await p.seek(at);
    p.editor!.commands.setTextSelection(p.projection!.pmAt(at));
    p.editor!.view.focus();
  });
  await settled(page);
  const snapshot = () =>
    root.evaluate((el) => {
      const p = (el as Host).proof;
      return {
        native: p.projection!.table!.pointAt(p.editor!.state.selection.head),
        point: p.selection.table!.head,
        coords: p.editor!.view.coordsAtPos(p.editor!.state.selection.head),
        font: getComputedStyle(p.editor!.view.dom.querySelector('td')!).fontSize,
        geometry: p.projection!.table!.window.geometry,
        stats: p.snapshot(),
      };
    });
  const before = await snapshot();
  // Tables use rem sizing independently of the editor root's inline font size.
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '20px';
  });
  await settled(page);
  await expect
    .poll(() =>
      root.evaluate((el) =>
        (el as Host).proof.projection!.table!.window.geometry!.font.includes('|20px|'),
      ),
    )
    .toBe(true);
  const after = await snapshot();
  await info.attach('table-actual-font-anchor.json', {
    body: JSON.stringify({ before, after }),
    contentType: 'application/json',
  });
  expect(before.font).toBe('16px');
  expect(after.font).toBe('20px');
  expect(after.geometry!.font).not.toBe(before.geometry!.font);
  expect(after.native).toEqual(before.native);
  expect(after.native).toEqual(after.point);
  expect(Math.abs(after.coords.top - before.coords.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.coords.left - before.coords.left)).toBeLessThanOrEqual(1);
  expect(after.stats.maxSourceContextBytes).toBeLessThanOrEqual(4096);
});

test('horizontal and vertical revisits restore the native cell after actual view eviction', async ({
  mount,
  page,
}, info) => {
  await mount(Harness, { props: { sourceOverride: source } });
  const root = page.getByTestId('proof');
  await expect(root.locator('.tiptap')).toHaveCount(1);
  await root.evaluate(async (el) => {
    const p = (el as Host).proof,
      at = p.service.region(0).indexOf('r101c42') + 3;
    await p.seek(at);
    p.editor!.commands.setTextSelection(p.projection!.pmAt(at));
    p.editor!.view.focus();
  });
  await settled(page);
  const before = await root.evaluate((el) => {
    const p = (el as Host).proof;
    return { point: p.selection.table, destroyed: p.destroyed, width: p.tableColumnWidth };
  });
  const visits = [];
  for (let visit = 0; visit < 2; visit++) {
    for (const [row, column] of [
      [10, 10],
      [100, 40],
    ]) {
      await root.evaluate(
        (el, [row, column]) => {
          const p = (el as Host).proof,
            scroller = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
          scroller.scrollTop = row * 41;
          scroller.scrollLeft = column * p.tableColumnWidth;
        },
        [row, column],
      );
      await expect
        .poll(() =>
          root.evaluate(
            (el, [row, column]) =>
              (el as Host).proof.projection!.table!.window.cells.some(
                (c) => c.row === row && c.column === column,
              ),
            [row, column],
          ),
        )
        .toBe(true);
      await settled(page);
    }
    visits.push(
      await root.evaluate((el) => {
        const p = (el as Host).proof;
        return {
          point: p.selection.table,
          native: p.projection!.table!.pointAt(p.editor!.state.selection.head),
          stats: p.snapshot(),
          source: p.service.region(0),
        };
      }),
    );
  }
  await info.attach('table-revisit-native.json', {
    body: JSON.stringify({ before, visits }),
    contentType: 'application/json',
  });
  for (const visit of visits) {
    expect(visit.point).toEqual(before.point);
    expect(visit.native).toEqual(before.point!.head);
    expect(visit.stats.destroyed).toBeGreaterThan(before.destroyed);
    expect(visit.stats.tableColumnWidth).toBe(before.width);
    expect(visit.stats.maxSourceContextBytes).toBeLessThanOrEqual(4096);
    expect(visit.source).toBe(source);
  }
});

test('remote row insertion and deletion retain the active native cell and its pixel anchor', async ({
  mount,
  page,
}, info) => {
  await mount(Harness, { props: { sourceOverride: source } });
  const root = page.getByTestId('proof');
  await expect(root.locator('.tiptap')).toHaveCount(1);
  await root.evaluate(async (el) => {
    const p = (el as Host).proof,
      at = p.service.region(0).indexOf('r101c42') + 3;
    await p.seek(at);
    p.editor!.commands.setTextSelection(p.projection!.pmAt(at));
    p.editor!.view.focus();
  });
  await settled(page);
  const snapshot = () =>
    root.evaluate((el) => {
      const p = (el as Host).proof;
      return {
        native: p.projection!.table!.pointAt(p.editor!.state.selection.head),
        point: p.selection.table!.head,
        coords: p.editor!.view.coordsAtPos(p.editor!.state.selection.head),
        revision: p.projection!.table!.window.revision,
        stats: p.snapshot(),
      };
    });
  const before = await snapshot();
  const row = '| ' + Array(100).fill('remote').join(' | ') + ' |\n';
  const at = source.indexOf('| r0c0');
  await root.evaluate(
    (el, { at, row }) => {
      (el as Host).proof.remote({ from: at, to: at, insert: row });
    },
    { at, row },
  );
  await expect
    .poll(() => root.evaluate((el) => (el as Host).proof.projection!.table!.window.revision))
    .toBe(before.revision + 1);
  await settled(page);
  const inserted = await snapshot();
  await root.evaluate(
    (el, { at, row }) => {
      (el as Host).proof.remote({ from: at, to: at + row.length, insert: '' });
    },
    { at, row },
  );
  await expect
    .poll(() => root.evaluate((el) => (el as Host).proof.projection!.table!.window.revision))
    .toBe(before.revision + 2);
  await settled(page);
  const deleted = await snapshot();
  await info.attach('table-remote-anchor.json', {
    body: JSON.stringify({ before, inserted, deleted }),
    contentType: 'application/json',
  });
  expect(inserted.native).toEqual({ ...before.native, cell: before.native.cell + row.length });
  expect(deleted.native).toEqual(before.native);
  for (const after of [inserted, deleted]) {
    expect(after.native).toEqual(after.point);
    expect(Math.abs(after.coords.top - before.coords.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.coords.left - before.coords.left)).toBeLessThanOrEqual(1);
    expect(after.stats.maxSourceContextBytes).toBeLessThanOrEqual(4096);
  }
  expect(await root.evaluate((el) => (el as Host).proof.service.region(0))).toBe(source);
});

test('encountered row height survives horizontal eviction of its tall cell', async ({
  mount,
  page,
}, info) => {
  // Hold the admitted fragment constant: more visible rows can otherwise reduce
  // its byte allowance, legitimately changing the encountered height estimate.
  const heightSource = source
    .split('\n')
    .filter((_, i) => i < 2 || (i >= 101 && i <= 103))
    .join('\n');
  await mount(Harness, { props: { sourceOverride: heightSource } });
  const root = page.getByTestId('proof');
  await expect(root.locator('.tiptap')).toHaveCount(1);
  await root.evaluate(async (el) => {
    const p = (el as Host).proof;
    await p.seek(p.service.region(0).indexOf('W'.repeat(20)));
  });
  await settled(page);
  const snapshot = () =>
    root.evaluate((el) => {
      const p = (el as Host).proof,
        table = p.projection!.table!.window;
      const index = [...new Set(table.cells.map((c) => c.row))].indexOf(1);
      return {
        fragment: table.cells.find((c) => c.row === 1 && c.column === 44)?.raw,
        height: p.editor!.view.dom.querySelectorAll('tr')[index].getBoundingClientRect().height,
        geometry: table.geometry,
        stats: p.snapshot(),
        source: p.service.region(0),
      };
    });
  const before = await snapshot();
  await root.evaluate((el) => {
    const p = (el as Host).proof,
      scroller = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
    scroller.scrollLeft = p.tableColumnWidth * 40;
  });
  await expect
    .poll(() =>
      root.evaluate((el) =>
        (el as Host).proof.projection!.table!.window.cells.some((c) => c.column === 44),
      ),
    )
    .toBe(false);
  await settled(page);
  const hidden = await snapshot();
  await root.evaluate((el) => {
    const p = (el as Host).proof,
      scroller = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
    scroller.scrollLeft = p.tableColumnWidth * 44;
  });
  await expect
    .poll(() =>
      root.evaluate((el) =>
        (el as Host).proof.projection!.table!.window.cells.some(
          (c) => c.row === 1 && c.column === 44,
        ),
      ),
    )
    .toBe(true);
  await settled(page);
  const returned = await snapshot();
  await info.attach('table-retained-height.json', {
    body: JSON.stringify({ before, hidden, returned }),
    contentType: 'application/json',
  });
  expect(before.height).toBeGreaterThan(41);
  expect(returned.fragment).toBe(before.fragment);
  for (const after of [hidden, returned]) {
    expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
    expect(after.stats.maxSourceContextBytes).toBeLessThanOrEqual(4096);
    expect(after.source).toBe(heightSource);
  }
});
