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
  ).toBeLessThanOrEqual(4096);
});
