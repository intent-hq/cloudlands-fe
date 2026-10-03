import { expect, it } from 'vitest';
import { SourceJournal } from './source-journal';

const source =
  '| ' +
  Array.from({ length: 100 }, (_, c) => `H${c}`).join(' | ') +
  ' |\n| ' +
  Array(100).fill('---').join(' | ') +
  ' |\n' +
  Array.from(
    { length: 240 },
    (_, r) => '| ' + Array.from({ length: 100 }, (_, c) => `r${r}c${c}`).join(' | ') + ' |',
  ).join('\n');
it('admits a real viewport rectangle with all cell context inside the unchanged source budget', () => {
  const service = new SourceJournal(() => source, 1);
  const address = service.tableAddress(0, 100, 40);
  const window = service.tableWindow(address.source, undefined, undefined, {
    row: 100,
    column: 40,
    rowCount: 14,
    columnCount: 4,
  })!;
  expect(window.cells).toHaveLength(56);
  expect(window.cells[0].row).toBe(100);
  expect(window.cells[0].column).toBe(40);
  expect(window.cells.at(-1)!.row).toBe(113);
  expect(window.cells.at(-1)!.column).toBe(43);
  expect(
    new TextEncoder().encode(JSON.stringify(window) + window.cells.map((c) => c.raw).join(''))
      .length,
  ).toBeLessThanOrEqual(3072);
  for (const cell of window.cells) {
    expect(source.slice(cell.first, cell.last)).toBe(cell.raw);
    expect(cell.runs.map((r) => r.text).join('')).toBe(cell.raw);
  }
});

it('pages height estimates, retains encountered maxima and invalidates revision or font changes', () => {
  const service = new SourceJournal(() => source, 1);
  const heights = service.tableHeights;
  const key = { revision: service.revision, table: 0, width: 420, font: '14px/20px sans-serif' };
  const initial = heights.viewport(key, 241, 4100, 520);
  expect(initial.row).toBe(100);
  expect(initial.heights).toHaveLength(14);
  expect(initial.top).toBe(4100);
  const measured = heights.record(initial, [80, ...initial.heights.slice(1)]);
  expect(measured.total).toBe(initial.total + 39);
  expect(heights.record(measured, Array(14).fill(41)).heights[0]).toBe(80);
  expect(heights.viewport(key, 241, 4100, 520).heights[0]).toBe(80);
  expect(heights.viewport({ ...key, font: '18px/26px serif' }, 241, 4100, 520).heights[0]).toBe(41);
  service.apply({ from: 0, to: 0, insert: 'before\n\n' });
  expect(() => heights.record(measured, Array(14).fill(100))).toThrow('Stale table geometry');
  expect(heights.viewport({ ...key, revision: service.revision }, 241, 4100, 520).heights[0]).toBe(
    41,
  );
  expect(JSON.stringify(initial).length).toBeLessThan(400);
});

it('includes the encountered-height page in a full viewport admission', () => {
  const service = new SourceJournal(() => source, 1);
  const address = service.tableAddress(0, 100, 40);
  const window = service.tableViewportWindow(address.source, {
    top: 4100,
    left: 17040,
    width: 1280,
    height: 520,
    font: 'sans-serif|14px|20px|normal',
  })!;
  expect(window.cells).toHaveLength(56);
  expect(window.geometry!.row).toBe(100);
  expect(window.geometry!.heights).toHaveLength(14);
  const bytes = new TextEncoder().encode(
    JSON.stringify(window) + window.cells.map((c) => c.raw).join(''),
  ).length;
  expect(bytes).toBeLessThanOrEqual(3072);
});

it('includes the native drag anchor alongside visible cells under the unchanged admission budget', () => {
  const service = new SourceJournal(() => source, 1);
  const anchor = service.tableAddress(0, 101, 39);
  const address = service.tableAddress(0, 100, 40);
  const window = service.tableViewportWindow(address.source, {
    top: 4100,
    left: 17040,
    width: 1280,
    height: 520,
    font: 'sans-serif|14px|20px|normal',
    include: anchor.point.cell,
  })!;
  expect(window.cells.some((c) => c.from === anchor.point.cell)).toBe(true);
  expect(window.cells.some((c) => c.row === 113 && c.column === 43)).toBe(true);
  expect(window.cells).toHaveLength(70);
  expect(
    new TextEncoder().encode(JSON.stringify(window) + window.cells.map((c) => c.raw).join(''))
      .length,
  ).toBeLessThanOrEqual(4096);
});

it('admits partial first and last columns without leaving a one-pixel viewport hole', () => {
  const service = new SourceJournal(() => source, 1);
  const address = service.tableAddress(0, 100, 40);
  const window = service.tableViewportWindow(address.source, {
    top: 4100,
    left: 17465,
    width: 1280,
    height: 520,
    font: 'sans-serif|14px|20px|normal',
  })!;
  expect(window.cells).toHaveLength(70);
  expect(window.cells[0].column).toBe(40);
  expect(window.cells.at(-1)!.column).toBe(44);
  expect(
    new TextEncoder().encode(JSON.stringify(window) + window.cells.map((c) => c.raw).join(''))
      .length + 96,
  ).toBeLessThanOrEqual(4096);
});

it('admits a wrapped-cell continuation alongside partial edge columns within the same hard budget', () => {
  const rich = source.replace('r99c44', 'W'.repeat(1800));
  const service = new SourceJournal(() => rich, 1);
  const address = service.tableAddress(0, 100, 40);
  const window = service.tableViewportWindow(address.source, {
    top: 4100,
    left: 17465,
    width: 1280,
    height: 520,
    font: 'sans-serif|14px|20px|normal',
  })!;
  expect(window.cells).toHaveLength(70);
  expect(
    window.cells.find((c) => c.row === 100 && c.column === 44)!.raw.length,
  ).toBeGreaterThanOrEqual(64);
  expect(
    new TextEncoder().encode(JSON.stringify(window) + window.cells.map((c) => c.raw).join(''))
      .length + 96,
  ).toBeLessThanOrEqual(16384);
});

it('uses bounded encountered text measurements to page oversized cell contents by scroll position', () => {
  const text = 'START ' + 'abcdefghij '.repeat(2500) + ' END';
  const source = `| H |\n| --- |\n| ${text} |`;
  const service = new SourceJournal(() => source, 1);
  const viewport = {
    top: 0,
    left: 0,
    width: 1280,
    height: 520,
    font: 'sans-serif|16px|24px|normal',
  };
  const initial = service.tableViewportWindow(source.indexOf('START'), viewport)!;
  const cell = initial.cells.find((c) => c.row === 1)!;
  expect(cell.raw).toContain('START');
  expect(cell.raw).not.toContain('END');
  // Unit model only; browser tests independently measure the real native glyphs.
  service.tableHeights.measureCells(initial, [
    { cell: cell.from, height: (cell.raw.length / 100) * 24, padding: 17 },
  ]);
  const middle = service.tableViewportWindow(cell.body, {
    ...viewport,
    top: initial.geometry!.total / 2,
  })!;
  const middleCell = middle.cells.find((c) => c.row === 1)!;
  expect(middleCell.first).toBeGreaterThan(cell.first);
  expect(middleCell.last).toBeLessThan(cell.end);
  const end = service.tableViewportWindow(cell.body, {
    ...viewport,
    top: initial.geometry!.total - 520,
  })!;
  expect(end.cells.find((c) => c.row === 1)!.raw).toContain('END');
  const back = service.tableViewportWindow(cell.body, viewport)!;
  expect(back.cells.find((c) => c.row === 1)!.raw).toContain('START');
  for (const window of [initial, middle, end, back]) {
    expect(
      new TextEncoder().encode(JSON.stringify(window) + window.cells.map((c) => c.raw).join(''))
        .length,
    ).toBeLessThanOrEqual(16384);
    const pages = service.transferTable(window);
    expect(pages.length).toBeLessThanOrEqual(4);
    for (const page of pages)
      expect(new TextEncoder().encode(JSON.stringify(page)).length).toBeLessThanOrEqual(4096);
  }
});

for (const measured of [456, 552])
  it(`prioritizes 520px visible coverage over overscan with a ${measured}px source span`, () => {
    const service = new SourceJournal(() => '| H |\n| --- |\n| ' + '漢字'.repeat(10000) + ' |', 1);
    const viewport = { top: 0, width: 1280, height: 520, font: 'model-short-span' };
    const initial = service.tableViewportWindow(16, viewport)!;
    const cell = initial.cells.find((c) => c.row === 1)!;
    service.tableHeights.measureCells(initial, [
      { cell: cell.from, height: ((cell.last - cell.first) * measured) / 2146, padding: 17 },
    ]);
    const top = 1900,
      rowTop = 41;
    const first = service.tableHeights.fragmentStart(
      initial.geometry!,
      cell,
      rowTop,
      top,
      520,
      2146,
    );
    const leading = top - rowTop - ((first - cell.body) * measured) / 2146;
    expect(leading).toBeLessThanOrEqual(Math.max(0, measured - 520) + measured / 2146);
    if (measured < 520) {
      const next = service.tableViewportWindow(
        cell.body,
        { ...viewport, top },
        undefined,
        undefined,
        'packed-cells',
      )!;
      expect(
        (next.cells.find((c) => c.row === 1)!.raw.length * measured) / 2146,
      ).toBeGreaterThanOrEqual(520);
    }
  });

it('reports a measured minimum that cannot fit instead of returning an underfilled crop', () => {
  const source = '| H |\n| --- |\n| ' + '漢'.repeat(20000) + ' |';
  const service = new SourceJournal(() => source, 1);
  expect(() =>
    service.tableViewportWindow(
      16,
      {
        top: 1000,
        width: 1280,
        height: 520,
        font: 'too-dense',
        minimum: { cell: service.tableAddress(0, 1, 0).point.cell, units: 8192 },
      },
      undefined,
      undefined,
      'packed-cells',
    ),
  ).toThrow('viewport uncovered');
});
