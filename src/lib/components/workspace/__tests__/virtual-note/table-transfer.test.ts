import { TableSourceView } from './table-source-view';
import { SourceProjection } from './source-projection';
import { tableRuns } from './table-source';
import { expect, it } from 'vitest';
import { bytes } from './bounded-note-service';
import { cloneTableWindow, packTableWindow } from './table-payload';
import { encodeTablePages, decodeTablePages } from './table-transfer';
import type { TableWindow } from './table-source';

function fixture(raw: string): TableWindow {
  return packTableWindow({
    revision: 7,
    from: 0,
    to: 200000,
    rows: 50,
    columns: 40,
    row: 20,
    column: 3,
    cells: [
      {
        row: 20,
        column: 3,
        from: 100,
        body: 102,
        to: 100000,
        end: 99998,
        first: 60000,
        last: 60000 + raw.length,
        raw,
        align: 'right',
        runs: [{ from: 60000, to: 60000 + raw.length, text: raw, marks: [], offset: 59898 }],
      },
    ],
  });
}

for (const text of ['ascii '.repeat(900), '界'.repeat(1800), '🌍'.repeat(1200), '\\|"'.repeat(500)])
  it(`transfers and restores bounded table fragments as decoded 4KiB pages (${text.codePointAt(0)})`, () => {
    const window = fixture(text);
    const pages = encodeTablePages(window);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.length).toBeLessThanOrEqual(4);
    for (const page of pages) expect(bytes(JSON.stringify(page))).toBeLessThanOrEqual(4096);
    const wire = JSON.parse(JSON.stringify(pages));
    const received = decodeTablePages(wire, 7);
    expect(JSON.stringify(received)).toBe(JSON.stringify(window));
    expect(received.cells[0].raw).toBe(text);
    expect(received.cells[0].runs[0].offset).toBe(59898);
    expect(bytes(JSON.stringify(received)) + bytes(text)).toBeLessThanOrEqual(16384);
  });

it('rejects missing, reordered, mixed-revision and oversized transfer pages', () => {
  const pages = encodeTablePages(fixture('x'.repeat(5400)));
  expect(() => decodeTablePages(pages.slice(1), 7)).toThrow();
  expect(() => decodeTablePages([...pages].reverse(), 7)).toThrow();
  expect(() => decodeTablePages(pages, 8)).toThrow('Stale');
  expect(() =>
    decodeTablePages(
      pages.map((p, i) => (i ? { ...p, revision: 8 } : p)),
      7,
    ),
  ).toThrow();
  expect(() => decodeTablePages([{ ...pages[0], payload: 'x'.repeat(4096) }], 7)).toThrow();
  expect(() => encodeTablePages(fixture('x'.repeat(17000)))).toThrow();
});

it('derives dense canonical marks from bounded source without repeating every mark record', () => {
  const raw = 'START ' + '**bold** _italic_ `code` \\| \\\\ '.repeat(190) + ' END';
  const original = cloneTableWindow(fixture(raw));
  let offset = 1000;
  original.cells[0].runs = tableRuns(raw, 60000).map((run) => {
    const mapped = { ...run, offset };
    offset += run.text.length;
    return mapped;
  });
  const packed = packTableWindow(original);
  expect(bytes(JSON.stringify(packed)) + bytes(raw)).toBeLessThanOrEqual(16384);
  const restored = decodeTablePages(JSON.parse(JSON.stringify(encodeTablePages(packed))), 7);
  expect(restored.cells[0].runs).toEqual(original.cells[0].runs);
  expect(restored.cells[0].raw).toBe(raw);
});

it('pages dense native paragraph contexts with exact offsets, marks and empty blocks', () => {
  const first = '**bold** _italic_ `code` \\| \\\\ '.repeat(95);
  const raw = first + 'BOUNDARY ' + first;
  const original = cloneTableWindow(fixture(raw));
  const cell = original.cells[0],
    seam = cell.first + first.length;
  let offset = 1000;
  cell.runs = tableRuns(raw, cell.first)
    .flatMap((run) => {
      if (run.from < seam && run.to > seam) {
        const split = seam - run.from;
        return [
          { ...run, to: seam, text: run.text.slice(0, split) },
          { ...run, from: seam, text: run.text.slice(split) },
        ];
      }
      return [run];
    })
    .map((run) => {
      const block = run.from < seam ? 0 : 2;
      if (run.from === seam) offset = 0;
      const mapped = { ...run, offset, block };
      offset += run.text.length;
      return mapped;
    });
  cell.blocks = [
    { index: 0, from: cell.first, to: seam },
    { index: 1, from: seam, to: seam },
    { index: 2, from: seam, to: cell.last },
  ];
  cell.blockCount = 3;
  const packed = packTableWindow(original);
  const pages = encodeTablePages(packed);
  expect(pages.length).toBeLessThanOrEqual(4);
  for (const page of pages) expect(bytes(JSON.stringify(page))).toBeLessThanOrEqual(4096);
  expect(bytes(JSON.stringify(packed)) + bytes(raw)).toBeLessThanOrEqual(16384);
  const restored = decodeTablePages(JSON.parse(JSON.stringify(pages)), 7);
  expect(restored.cells[0].runs).toEqual(cell.runs);
  expect(restored.cells[0].blocks).toEqual(cell.blocks);
});

it('requires an explicit packed-cell owner on both transfer ends and charges its exact descriptor', () => {
  const raw = '漢'.repeat(3500);
  const copied = fixture(raw);
  expect(() => encodeTablePages(copied)).toThrow('budget');
  const owner = { ...copied, sourceOwnership: 'packed-cells' as const };
  expect(() => encodeTablePages(owner)).toThrow('ownership');
  const pages = encodeTablePages(owner, 'packed-cells');
  expect(() => decodeTablePages(pages, 7)).toThrow('ownership');
  const decoded = decodeTablePages(pages, 7, 'packed-cells');
  const view = new TableSourceView(decoded);
  const reference = {
    kind: 'packed-cells',
    revision: 7,
    from: 60000,
    to: 63500,
    length: 3500,
    ranges: [[0, 60000, 63500]],
  };
  expect(JSON.stringify(view)).toBe(JSON.stringify(reference));
  expect(view.payloadBytes).toBe(new TextEncoder().encode(JSON.stringify(reference)).length);
  expect(view.logicalBytes).toBe(new TextEncoder().encode(raw).length);
  expect(bytes(JSON.stringify(decoded)) + view.payloadBytes).toBeLessThanOrEqual(16384);
  const context = { revision: 7, from: 60000, to: 63500, before: [], after: [], table: decoded };
  expect(() => new SourceProjection(raw, 60000, context)).toThrow('Copied source');
  const projection = new SourceProjection(view, 60000, context);
  expect(projection.table!.window).toBe(decoded);
  expect(projection.sourcePayload).toBe(view);
  expect(() => projection.source).toThrow('packed cell source');
});
