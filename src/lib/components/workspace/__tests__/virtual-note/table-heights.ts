import type { TableCellSource, TableWindow } from './table-source';
import { bytes } from './bounded-note-service';
export type HeightKey = { revision: number; table: number; width: number; font: string };
export type TableGeometry = HeightKey & {
  row: number;
  rows: number;
  top: number;
  total: number;
  heights: number[];
};
/** Mock backing only. Renderer receives one bounded page, never the summaries Map. */
export class TableHeights {
  private summaries = new Map<string, Map<number, number>>();
  private cellSamples = new Map<
    string,
    Map<number, { row: number; rowspan: number; rate: number; total: number }>
  >();
  maxCellWriteBytes = 0;
  /** Backing-only revision copy when table source and live cells did not change. */
  retainUnchangedTable(table: number, previous: number) {
    const revision = this.revision();
    for (const collection of [this.summaries, this.cellSamples]) {
      for (const [id, values] of [...collection]) {
        const key = JSON.parse(id) as [number, number, number, string];
        if (key[0] !== previous || key[1] !== table) continue;
        key[0] = revision;
        // Each revision owns its samples; later measurement must not mutate history.
        if (collection === this.summaries)
          this.summaries.set(JSON.stringify(key), new Map(values as Map<number, number>));
        else
          this.cellSamples.set(
            JSON.stringify(key),
            new Map(
              values as Map<number, { row: number; rowspan: number; rate: number; total: number }>,
            ),
          );
      }
    }
  }
  rollback(revision: number) {
    for (const collection of [this.summaries, this.cellSamples])
      for (const id of collection.keys()) if (JSON.parse(id)[0] > revision) collection.delete(id);
  }
  private samples(key: HeightKey) {
    const id = JSON.stringify([key.revision, key.table, key.width, key.font]);
    let samples = this.cellSamples.get(id);
    if (!samples) {
      samples = new Map();
      this.cellSamples.set(id, samples);
    }
    return samples;
  }
  fragmentStart(
    key: HeightKey,
    cell: TableCellSource,
    rowTop: number,
    top: number,
    height: number,
    limit: number,
  ) {
    const rate = this.samples(key).get(cell.from)?.rate;
    if (!rate) return cell.body;
    const offset = Math.max(0, top - rowTop - height / 5);
    return Math.max(cell.body, Math.min(cell.end - limit, cell.body + Math.floor(offset / rate)));
  }
  measureCells(
    window: TableWindow,
    measurements: Array<{ cell: number; height: number; padding: number }>,
  ) {
    const page = window.geometry!;
    const size = bytes(JSON.stringify({ revision: page.revision, measurements }));
    if (size > 4096) throw new Error('Table cell measurement page exceeds budget');
    this.maxCellWriteBytes = Math.max(this.maxCellWriteBytes, size);
    const samples = this.samples(page),
      entries = this.entries(page);
    for (const measure of measurements) {
      const cell = window.cells.find((c) => c.from === measure.cell)!;
      if (
        !cell ||
        !Number.isFinite(measure.height) ||
        measure.height <= 0 ||
        cell.last <= cell.first
      )
        continue;
      const rate = measure.height / (cell.last - cell.first);
      samples.set(cell.from, {
        row: cell.owner?.row ?? cell.row,
        rowspan: cell.owner?.rowspan ?? 1,
        rate,
        total: rate * (cell.end - cell.body) + measure.padding,
      });
    }
    for (const row of new Set(
      window.cells
        .filter((c) => (c.first > c.body || c.last < c.end) && (c.owner?.rowspan ?? 1) === 1)
        .map((c) => c.row),
    )) {
      entries.set(
        row,
        Math.max(
          41,
          ...[...samples.values()]
            .filter((s) => s.row === row && s.rowspan === 1)
            .map((s) => s.total),
        ),
      );
    }
    window.geometry = this.range(page, page.rows, page.row, page.heights.length);
    window.layout = this.layout(window);
  }
  layout(window: TableWindow) {
    if (!window.geometry) return undefined;
    const samples = this.samples(window.geometry);
    return window.cells
      .filter((c) => c.first > c.body || c.last < c.end)
      .map((c) => {
        const rate = samples.get(c.from)?.rate ?? 0;
        let before = 0,
          after = 0;
        if (c.owner && c.mounted && c.owner.rowspan > 1) {
          const page = window.geometry!;
          const ownerTop = this.range(page, page.rows, c.owner.row, 0).top;
          const mounted = this.range(page, page.rows, c.row, c.mounted.rowspan);
          const ownerEnd = this.range(page, page.rows, c.owner.row + c.owner.rowspan, 0).top;
          before = mounted.top - ownerTop;
          after = ownerEnd - mounted.top - mounted.heights.reduce((a, b) => a + b, 0);
        }
        return {
          cell: c.from,
          top: Math.max(0, (c.first - c.body) * rate - before),
          bottom: Math.max(0, (c.end - c.last) * rate - after),
        };
      });
  }
  maxReadBytes = 0;
  maxWriteBytes = 0;
  scannedRows = 0;
  constructor(private revision: () => number) {}
  private entries(key: HeightKey) {
    if (key.revision !== this.revision()) throw new Error('Stale table geometry');
    const id = JSON.stringify([key.revision, key.table, key.width, key.font]);
    let entries = this.summaries.get(id);
    if (!entries) {
      entries = new Map();
      this.summaries.set(id, entries);
    }
    return entries;
  }
  private height(key: HeightKey, row: number) {
    let height = this.entries(key).get(row) ?? 41;
    // This is an estimate derived from the encountered owner fragment, not an
    // offscreen measurement or a renderer-resident map of the covered rows.
    for (const sample of this.samples(key).values())
      if (sample.rowspan > 1 && row >= sample.row && row < sample.row + sample.rowspan)
        height = Math.max(height, sample.total / sample.rowspan);
    return height;
  }
  range(key: HeightKey, rows: number, row: number, count: number): TableGeometry {
    let top = 0,
      total = 0;
    const heights: number[] = [];
    for (let r = 0; r < rows; r++) {
      const height = this.height(key, r);
      if (r < row) top += height;
      if (r >= row && r < row + count) heights.push(height);
      total += height;
    }
    this.scannedRows += rows;
    const page = { ...key, row, rows, top, total, heights };
    const size = bytes(JSON.stringify(page));
    if (size > 4096) throw new Error('Table geometry page exceeds budget');
    this.maxReadBytes = Math.max(this.maxReadBytes, size);
    return page;
  }
  viewport(key: HeightKey, rows: number, top: number, height: number) {
    let row = 0,
      offset = 0;
    while (row < rows - 1 && offset + this.height(key, row) <= top) {
      offset += this.height(key, row);
      row++;
    }
    let count = 0,
      end = offset;
    while (row + count < rows && end < top + height) {
      end += this.height(key, row + count);
      count++;
    }
    return this.range(key, rows, row, Math.min(rows - row, count + 1));
  }
  record(page: TableGeometry, heights: number[]) {
    const entries = this.entries(page);
    if (
      heights.length !== page.heights.length ||
      heights.some((h) => !Number.isFinite(h) || h <= 0)
    )
      throw new Error('Invalid table measurement page');
    const size = bytes(JSON.stringify({ revision: page.revision, row: page.row, heights }));
    if (size > 4096) throw new Error('Table measurement exceeds budget');
    this.maxWriteBytes = Math.max(this.maxWriteBytes, size);
    heights.forEach((h, i) =>
      entries.set(page.row + i, Math.max(entries.get(page.row + i) ?? 41, h)),
    );
    return this.range(page, page.rows, page.row, heights.length);
  }
  get backingBytes() {
    return (
      bytes(JSON.stringify([...this.summaries].map(([k, v]) => [k, [...v]]))) +
      bytes(JSON.stringify([...this.cellSamples].map(([k, v]) => [k, [...v]])))
    );
  }
}
