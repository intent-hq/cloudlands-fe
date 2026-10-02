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
  range(key: HeightKey, rows: number, row: number, count: number): TableGeometry {
    const entries = this.entries(key);
    let top = 0,
      total = 0;
    const heights: number[] = [];
    for (let r = 0; r < rows; r++) {
      const height = entries.get(r) ?? 41;
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
    const entries = this.entries(key);
    let row = 0,
      offset = 0;
    while (row < rows - 1 && offset + (entries.get(row) ?? 41) <= top) {
      offset += entries.get(row) ?? 41;
      row++;
    }
    let count = 0,
      end = offset;
    while (row + count < rows && end < top + height) {
      end += entries.get(row + count) ?? 41;
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
    return bytes(JSON.stringify([...this.summaries].map(([k, v]) => [k, [...v]])));
  }
}
