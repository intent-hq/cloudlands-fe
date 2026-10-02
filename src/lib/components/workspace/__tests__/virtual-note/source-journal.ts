import { TableHeights } from './table-heights';
import { cloneTableWindow, packTableWindow } from './table-payload';
/** Test-only backing store. Its Maps model disk/server state, NOT renderer caches. */
import { bytes } from './bounded-note-service';
import { SourceProjection, type InlineContext } from './source-projection';
import { scanFences, type Fence } from './fence-context';
import { scanLists, type ListItem, type ListSeam } from './list-context';
import {
  scanTables,
  admitTableWindow,
  type TableIndex,
  type TableWindow,
  type TableFragment,
  type TableRectangle,
} from './table-source';
import type { JSONContent } from '@tiptap/core';
import { patchTableCell } from './table-state';
import type { TableStructure } from './table-projection';
import { tableCodeChanges, type TableCodeEdit } from './table-code';
export const LIMITS = {
  request: 4096,
  active: 16384,
  cachePages: 4,
  nodes: 256,
  journalPage: 4096,
  journalResident: 16384,
  log: 32,
  receipts: 32,
};
export const fixture = (id: number) =>
  `Region ${String(id).padStart(4, '0')} — café 🌍. repeated repeated [link](https://example.test).\n\n`;
export type TablePoint = { cell: number; block: number; offset: number };
export type Selection = {
  anchor: number;
  head: number;
  affinity: -1 | 1;
  revision: number;
  table?: { anchor: TablePoint; head: TablePoint; kind: 'text' | 'cell' };
};
export type DeferredInput = {
  command: string;
  time: number;
  selection?: Selection;
  text?: string;
};
export type Splice = { from: number; to: number; insert: string };
export type Change = Splice & {
  removed: string;
  seam?: { before: ListSeam | null; after: ListSeam | null };
  tableState?: string;
};
export type Anchor = { id: string; from: number; to: number; alive: boolean };
export type Event = {
  changes: Change[];
  before: Selection;
  after: Selection;
  anchorsBefore: Anchor[];
  anchorsAfter: Anchor[];
};
export const mapPoint = (p: number, s: Splice, affinity = 1) =>
  p < s.from || (p === s.from && affinity < 0)
    ? p
    : p > s.to || (p === s.to && affinity > 0)
      ? p + s.insert.length - (s.to - s.from)
      : s.from + (affinity < 0 ? 0 : s.insert.length);
export const mapSelection = (r: Selection, s: Splice, revision: number): Selection => ({
  ...r,
  anchor: mapPoint(r.anchor, s, r.affinity),
  head: mapPoint(r.head, s, r.affinity),
  revision,
  ...(r.table
    ? {
        table: {
          ...r.table,
          anchor: { ...r.table.anchor, cell: mapPoint(r.table.anchor.cell, s, -1) },
          head: { ...r.table.head, cell: mapPoint(r.table.head.cell, s, -1) },
        },
      }
    : {}),
});

export class SourceJournal {
  // These serialized blobs model backing-store records, never renderer caches.
  private tableStates = new Map<string, string>();
  private applyTableState(change: Splice & { tableState: string }) {
    const prior = this.tableStates.get(change.tableState) ?? '';
    if (change.to > prior.length) throw new Error('Invalid table metadata range');
    const states = new Map(this.tableStates);
    const next = prior.slice(0, change.from) + change.insert + prior.slice(change.to);
    if (next) states.set(change.tableState, next);
    else states.delete(change.tableState);
    this.tableStates = states;
    this.revision++;
  }
  private stageTableState(key: string, value: string, history = true) {
    if (!this.atomicDepth) throw new Error('Table source and metadata require atomic admission');
    const removed = this.tableStates.get(key) ?? '';
    const pages = this.pages({
      from: 0,
      to: removed.length,
      insert: value,
      removed,
      tableState: key,
    });
    for (const encoded of pages) {
      const change: Change = JSON.parse(encoded);
      this.applyTableState(change as Change & { tableState: string });
      if (history) this.stagedPages.push(encoded);
    }
  }
  maxTableWriteBytes = 0;
  stageTableCell(fragment: TableFragment, node: JSONContent, history = true) {
    const payload = bytes(JSON.stringify({ fragment, node }));
    if (payload > LIMITS.request) throw new Error('Table fragment write exceeds budget');
    this.maxTableWriteBytes = Math.max(this.maxTableWriteBytes, payload);
    const prior = this.tableStates.get(`cell:${fragment.from}`);
    const merged =
      fragment.first === fragment.body &&
      fragment.last === fragment.end &&
      (!fragment.blocks ||
        (fragment.blocks[0].index === 0 && fragment.blocks.length === fragment.blockCount))
        ? node
        : patchTableCell(
            this.slice(fragment.body, fragment.end),
            fragment,
            prior ? JSON.parse(prior) : undefined,
            node,
          );
    this.stageTableState(`cell:${fragment.from}`, JSON.stringify(merged), history);
    this.log('table-fragment-write', fragment.from, payload);
  }
  private mapTableKey(key: string, splice: Splice) {
    return `cell:${mapPoint(Number(key.slice(5)), splice, -1)}`;
  }
  stageTableStructure(window: TableWindow, edit: TableStructure, history = true) {
    if (edit.kind === 'split') return this.stageTableSplit(window, edit, history);
    if (edit.kind === 'merge') return this.stageTableMerge(window, edit, history);
    if (edit.kind === 'column') return this.stageTableColumns(window, edit, history);
    if (window.revision !== this.revision) throw new Error('Stale table structural transaction');
    if (bytes(JSON.stringify(edit)) > LIMITS.request)
      throw new Error('Table structural request exceeds budget');
    const { id, start } = this.locate(window.from);
    const source = this.region(id),
      table = this.tableIndex(source, start).find((t) => t.from + start === window.from)!;
    if (edit.index === 0) throw new Error('Header row structural admission is not implemented');
    const from = start + (table.rows[edit.index]?.from ?? table.to);
    const to = edit.remove ? start + table.rows[edit.index + edit.remove - 1].to : from;
    for (const key of this.tableStates.keys()) {
      const at = Number(key.slice(5));
      if (at >= from && at < to) this.stageTableState(key, '', history);
    }
    const rowText = '| ' + Array(table.columns).fill('').join(' | ') + ' |';
    const prefix = edit.rows.length && from > 0 && this.slice(from - 1, from) !== '\n' ? '\n' : '';
    const insert =
      prefix +
      edit.rows.map(() => rowText).join('\n') +
      (edit.rows.length && to < this.length ? '\n' : '');
    const splice = { from, to, insert };
    this.stage(splice, history);
    const updated = this.tableIndex(this.region(id), start).find(
      (t) => t.from + start === window.from,
    )!;
    const column = Math.min(...window.cells.map((c) => c.column));
    for (let r = 0; r < edit.rows.length; r++)
      for (const cell of updated.rows[edit.index + r].cells) {
        const native = edit.rows[r].content?.[cell.column - column] ?? {
          ...edit.rows[r].content![0],
          content: [{ type: 'paragraph' }],
        };
        this.stageTableState(`cell:${cell.from + start}`, JSON.stringify(native), history);
      }
    const retained = cloneTableWindow(window);
    retained.cells = retained.cells
      .filter((c) => c.row < edit.index || c.row >= edit.index + edit.remove)
      .map((c) => ({
        ...c,
        row: c.row >= edit.index ? c.row + edit.rows.length - edit.remove : c.row,
        first: mapPoint(c.first, splice, -1),
        last: mapPoint(c.last, splice, 1),
      }));
    const columns = [...new Set(window.cells.map((c) => c.column))];
    for (let r = 0; r < edit.rows.length; r++)
      for (const column of columns) {
        const cell = updated.rows[edit.index + r].cells[column];
        retained.cells.push({
          ...cell,
          from: cell.from + start,
          to: cell.to + start,
          body: cell.body + start,
          end: cell.end + start,
          first: cell.body + start,
          last: cell.end + start,
          raw: '',
          runs: [],
        });
      }
    retained.cells.sort((a, b) => a.row - b.row || a.column - b.column);
    return this.tableWindow(retained.cells[0].first, retained)!;
  }
  private stageTableColumns(
    window: TableWindow,
    edit: Extract<TableStructure, { kind: 'column' }>,
    history: boolean,
  ) {
    if (window.revision !== this.revision) throw new Error('Stale table column transaction');
    if (bytes(JSON.stringify(edit)) > LIMITS.request)
      throw new Error('Table column request exceeds budget');
    const { id, start } = this.locate(window.from),
      table = this.tableIndex(this.region(id), start).find((t) => t.from + start === window.from)!;
    const splices: Splice[] = [];
    const moved: Array<{ from: number; value: string }> = [];
    for (const row of [...table.rows, table.delimiter]) {
      const delimiter = row === table.delimiter;
      const cell = row.cells[Math.min(edit.index, row.cells.length - 1)];
      if (edit.remove) {
        const from = cell.from - (edit.index === row.cells.length - 1 ? 1 : 0) + start;
        const to = (row.cells[edit.index + edit.remove]?.from ?? cell.to) + start;
        for (const key of this.tableStates.keys())
          if (Number(key.slice(5)) >= from && Number(key.slice(5)) < to)
            this.stageTableState(key, '', history);
        splices.push({ from, to, insert: '' });
      } else {
        const append = edit.index === row.cells.length;
        const from = (append ? cell.to : cell.from) + start;
        if (!append && this.tableStates.has(`cell:${from}`)) {
          moved.push({ from, value: this.tableStates.get(`cell:${from}`)! });
          this.stageTableState(`cell:${from}`, '', history);
        }
        splices.push({
          from,
          to: from,
          insert: append ? (delimiter ? '| --- ' : '|  ') : delimiter ? ' --- |' : '  |',
        });
      }
    }
    splices.sort((a, b) => b.from - a.from);
    for (const splice of splices) this.stage(splice, history);
    for (const item of moved) {
      let at = item.from;
      for (const splice of splices) at = mapPoint(at, splice, 1);
      this.stageTableState(`cell:${at}`, item.value, history);
    }
    const updated = this.tableIndex(this.region(id), start).find(
      (t) => t.from + start === window.from,
    )!;
    if (edit.count)
      for (const row of updated.rows) {
        const native = edit.cells[row.cells[0].row - edit.row] ?? {
          type: row.cells[0].row === 0 ? 'tableHeader' : 'tableCell',
          attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null },
          content: [{ type: 'paragraph' }],
        };
        this.stageTableState(
          `cell:${row.cells[edit.index].from + start}`,
          JSON.stringify(native),
          history,
        );
      }
    const retained = cloneTableWindow(window);
    retained.cells = retained.cells
      .filter((c) => c.column < edit.index || c.column >= edit.index + edit.remove)
      .map((c) => {
        for (const splice of splices) {
          c.first = mapPoint(c.first, splice, -1);
          c.last = mapPoint(c.last, splice, 1);
        }
        c.column += c.column >= edit.index ? edit.count - edit.remove : 0;
        return c;
      });
    if (edit.count)
      for (const row of new Set(window.cells.map((c) => c.row))) {
        const cell = updated.rows[row].cells[edit.index];
        retained.cells.push({
          ...cell,
          from: cell.from + start,
          to: cell.to + start,
          body: cell.body + start,
          end: cell.end + start,
          first: cell.body + start,
          last: cell.end + start,
          raw: '',
          runs: [],
        });
      }
    retained.cells.sort((a, b) => a.row - b.row || a.column - b.column);
    return this.tableWindow(retained.cells[0].first, retained)!;
  }
  tableCodePatches(edits: TableCodeEdit[]) {
    const changes = edits.flatMap((edit) =>
      tableCodeChanges(this.slice(edit.code.from, edit.code.to), edit),
    );
    if (bytes(JSON.stringify(changes)) > LIMITS.request)
      throw new Error('Table code patches exceed admission budget');
    return changes.sort((a, b) => b.from - a.from);
  }
  tableAddress(from: number, row: number, column: number) {
    const { id, start } = this.locate(from),
      table = this.tableIndex(this.region(id), start).find((t) => t.from + start === from)!;
    const cell = table.rows[row].cells.find(
      (c) => c.column <= column && c.column + (c.span ?? 1) > column,
    )!;
    return {
      source: cell.body + start,
      point: { cell: cell.from + start, block: 0, offset: 0 },
      revision: this.revision,
    };
  }
  private stageTableSplit(
    window: TableWindow,
    edit: Extract<TableStructure, { kind: 'split' }>,
    history: boolean,
  ) {
    if (window.revision !== this.revision) throw new Error('Stale table split');
    if (bytes(JSON.stringify(edit)) > LIMITS.request)
      throw new Error('Table split request exceeds budget');
    const { id, start } = this.locate(window.from),
      table = this.tableIndex(this.region(id), start).find((t) => t.from + start === window.from)!;
    const cell = table.rows[edit.row].cells.find((c) => c.column === edit.column)!;
    this.stageTableState(`cell:${cell.from + start}`, JSON.stringify(edit.nodes[0]), history);
    const splice = {
      from: cell.to + start,
      to: cell.to + start,
      insert: '|  '.repeat(edit.width - 1),
    };
    this.stage(splice, history);
    const updated = this.tableIndex(this.region(id), start).find(
      (t) => t.from + start === window.from,
    )!;
    const retained = cloneTableWindow(window);
    for (const c of retained.cells) {
      c.first = mapPoint(c.first, splice, -1);
      c.last = mapPoint(c.last, splice, 1);
    }
    for (let n = 1; n < edit.width; n++) {
      const next = updated.rows[edit.row].cells.find((c) => c.column === edit.column + n)!;
      this.stageTableState(`cell:${next.from + start}`, JSON.stringify(edit.nodes[n]), history);
      retained.cells.push({
        ...next,
        from: next.from + start,
        to: next.to + start,
        body: next.body + start,
        end: next.end + start,
        first: next.body + start,
        last: next.end + start,
        raw: '',
        runs: [],
      });
    }
    retained.cells.sort((a, b) => a.row - b.row || a.column - b.column);
    return this.tableWindow(cell.body + start, retained)!;
  }
  validateTableRemote(splice: Splice) {
    for (const key of this.tableStates.keys()) {
      const at = Number(key.slice(5)),
        { id, start } = this.locate(at);
      const cell = this.tableIndex(this.region(id), start)
        .flatMap((t) => t.rows.flatMap((r) => r.cells))
        .find((c) => c.from + start === at);
      if (!cell) throw new Error('Conflict: invalidated table metadata');
      const from = cell.from + start,
        to = cell.to + start;
      if (
        (splice.from < to && splice.to > from) ||
        (splice.from === splice.to && splice.from > from && splice.from < to)
      )
        throw new Error('Conflict: remote source overlaps live table structure');
    }
  }
  private tableIndex(source: string, start: number) {
    return scanTables(source, (from) => {
      const value = this.tableStates.get(`cell:${from + start}`);
      return value ? JSON.parse(value) : undefined;
    });
  }
  private stageTableMerge(
    window: TableWindow,
    edit: Extract<TableStructure, { kind: 'merge' }>,
    history: boolean,
  ) {
    if (window.revision !== this.revision) throw new Error('Stale table merge');
    if (bytes(JSON.stringify(edit)) > LIMITS.request)
      throw new Error('Table merge request exceeds budget');
    const { id, start } = this.locate(window.from),
      table = this.tableIndex(this.region(id), start).find((t) => t.from + start === window.from)!;
    if (edit.row === 0) throw new Error('Header merge source admission is not implemented');
    const covered = table.rows[edit.row].cells.filter(
      (c) => c.column >= edit.column && c.column < edit.column + edit.width,
    );
    const first = covered[0],
      last = covered.at(-1)!;
    for (const cell of covered) this.stageTableState(`cell:${cell.from + start}`, '', history);
    const splice = { from: first.body + start, to: last.end + start, insert: edit.source };
    this.stage(splice, history);
    this.stageTableState(`cell:${first.from + start}`, JSON.stringify(edit.node), history);
    const retained = cloneTableWindow(window);
    retained.cells = retained.cells.filter(
      (c) =>
        c.row !== edit.row ||
        c.column === edit.column ||
        c.column < edit.column ||
        c.column >= edit.column + edit.width,
    );
    for (const cell of retained.cells) {
      cell.first = mapPoint(cell.first, splice, -1);
      cell.last = mapPoint(cell.last, splice, 1);
    }
    const merged = retained.cells.find((c) => c.row === edit.row && c.column === edit.column)!;
    merged.first = splice.from;
    merged.last = splice.from + splice.insert.length;
    return this.tableWindow(merged.first, retained)!;
  }
  tableNeighbor(from: number, direction: number) {
    const { id, start } = this.locate(from);
    const source = this.region(id);
    const table = this.tableIndex(source, start).find(
      (t) => from - start >= t.from && from - start < t.to,
    );
    if (!table) throw new Error('Table cell no longer exists');
    for (const row of table.rows)
      for (const cell of row.cells)
        if (cell.from + start === from) {
          const index =
            cell.row * table.columns + cell.column + (direction > 0 ? (cell.span ?? 1) : -1);
          if (index < 0 || index >= table.rows.length * table.columns) return undefined;
          const next = table.rows[Math.floor(index / table.columns)].cells.find(
            (c) =>
              c.column <= index % table.columns && c.column + (c.span ?? 1) > index % table.columns,
          )!;
          const result = {
            source: next.body + start,
            point: { cell: next.from + start, block: 0, offset: 0 },
            revision: this.revision,
          };
          this.log('table-neighbor', from, bytes(JSON.stringify(result)));
          return result;
        }
    throw new Error('Table cell identity is stale');
  }
  readonly tableHeights = new TableHeights(() => this.revision);
  private tableIndexes = new Map<number, { source: string; tables: TableIndex[] }>();
  backingTableScannedBytes = 0;
  maxTableWindowBytes = 0;
  tableViewportWindow(
    position: number,
    viewport: {
      top?: number;
      left?: number;
      height: number;
      width: number;
      font: string;
      include?: number;
    },
    preferred?: TablePoint,
  ) {
    const { id, start } = this.locate(position);
    const table = this.tableIndex(this.region(id), start).find(
      (t) => position - start >= t.from && position - start < t.to,
    );
    if (!table) return undefined;
    const row = Math.max(
      0,
      table.rows.findIndex((r) => position - start < r.to),
    );
    const cell =
      table.rows[row].cells.find((c) => position - start <= c.to) ?? table.rows[row].cells.at(-1)!;
    const width = Math.max(160, Math.floor(viewport.width / Math.min(3, table.columns)));
    const key = { revision: this.revision, table: table.from + start, width, font: viewport.font };
    const minimumRows = Math.ceil(viewport.height / 41) + 1;
    const targetRow = Math.min(row, Math.max(0, table.rows.length - minimumRows));
    const top = viewport.top ?? this.tableHeights.range(key, table.rows.length, targetRow, 0).top;
    let geometry = this.tableHeights.viewport(key, table.rows.length, top, viewport.height);
    let columnCount = Math.ceil((((viewport.left ?? 0) % width) + viewport.width) / width);
    let column =
      viewport.left === undefined
        ? Math.min(cell.column, Math.max(0, table.columns - columnCount))
        : Math.max(0, Math.floor(viewport.left / width));
    if (viewport.include !== undefined) {
      // Mock backing lookup; only the bounded union rectangle reaches the renderer.
      const anchor = table.rows
        .flatMap((r) => r.cells)
        .find((c) => c.from + start === viewport.include);
      if (anchor) {
        const lastRow = Math.max(geometry.row + geometry.heights.length, anchor.row + 1);
        const firstRow = Math.min(geometry.row, anchor.row);
        geometry = this.tableHeights.range(key, table.rows.length, firstRow, lastRow - firstRow);
        const lastColumn = Math.max(column + columnCount, anchor.column + (anchor.span ?? 1));
        column = Math.min(column, anchor.column);
        columnCount = lastColumn - column;
      }
    }
    return this.tableWindow(position, undefined, preferred, {
      row: geometry.row,
      column,
      rowCount: geometry.heights.length,
      columnCount,
      geometry,
    });
  }
  tableWindow(
    position: number,
    retained?: TableWindow,
    preferred?: TablePoint,
    rectangle?: TableRectangle,
  ) {
    const { id, start } = this.locate(position),
      source = this.region(id);
    let index = this.tableIndexes.get(id);
    if (!index || index.source !== source) {
      index = { source, tables: this.tableIndex(source, start) };
      this.tableIndexes.set(id, index);
      this.backingTableScannedBytes += bytes(source);
    }
    const table = index.tables.find((t) => position - start >= t.from && position - start < t.to);
    if (!table) return undefined;
    const local = retained && cloneTableWindow(retained);
    for (const cell of local?.cells ?? []) {
      cell.first -= start;
      cell.last -= start;
    }
    const window = admitTableWindow(
      source,
      table,
      position - start,
      this.revision,
      (cell) => {
        const saved = this.tableStates.get(`cell:${cell.from + start}`);
        return saved ? JSON.parse(saved) : undefined;
      },
      local,
      preferred && { ...preferred, cell: preferred.cell - start },
      rectangle,
    );
    window.from += start;
    window.to += start;
    for (const cell of window.cells) {
      for (const field of ['from', 'to', 'body', 'end', 'first', 'last'] as const)
        cell[field] += start;
      for (const run of cell.runs) {
        if (run.code) run.code = { from: run.code.from + start, to: run.code.to + start };
        run.from += start;
        run.to += start;
      }
      for (const block of cell.blocks ?? []) {
        block.from += start;
        block.to += start;
      }
    }
    const packed = packTableWindow(window);
    const size = bytes(JSON.stringify(packed));
    if (size > LIMITS.request) throw new Error('Table window exceeds admission budget');
    this.maxTableWindowBytes = Math.max(this.maxTableWindowBytes, size);
    this.log('table-window', position, size);
    return packed;
  }
  readonly count: number;
  revision = 1;
  generation = 1;
  commentRevision = 1;
  private regions = new Map<number, string>();
  // Mock backing session state. Seam journal entries occupy individual bounded pages.
  private seams = new Map<number, ListSeam>();
  private atomicDepth = 0;
  backingSeamScannedBytes = 0;
  maxBackingSeamSourceBytes = 0;
  private mappedSeams(splice: Splice, validate = true) {
    const next = new Map<number, ListSeam>();
    if (!this.seams.size) return next;
    if (!validate)
      return new Map(
        [...this.seams.values()].map((s) => {
          const from = mapPoint(s.from, splice, 1);
          return [from, { ...s, from }];
        }),
      );
    const source = this.slice(0, splice.from) + splice.insert + this.slice(splice.to, this.length);
    this.backingSeamScannedBytes += bytes(source);
    this.maxBackingSeamSourceBytes = Math.max(this.maxBackingSeamSourceBytes, bytes(source));
    for (const seam of this.seams.values()) {
      if (splice.from <= seam.from && splice.to > seam.from) continue;
      const from = mapPoint(seam.from, splice, 1);
      if (from && source[from - 1] !== '\n') continue;
      const match = source.slice(from, from + 128).match(/^( *)([-+*]|\d+[.)]) (?:\[([ xX/])\] )?/);
      const kind =
        match &&
        (match[3] !== undefined ? 'taskList' : /^\d/.test(match[2]) ? 'orderedList' : 'bulletList');
      if (kind === seam.kind) next.set(from, { ...seam, from });
    }
    return next;
  }
  private seamChange(before: ListSeam | null, after: ListSeam | null, history: boolean) {
    const change: Change = { from: 0, to: 0, insert: '', removed: '', seam: { before, after } };
    const page = JSON.stringify(change);
    if (bytes(page) > LIMITS.journalPage) throw new Error('Seam journal page exceeds budget');
    const seams = new Map(this.seams);
    if (before) seams.delete(before.from);
    if (after) seams.set(after.from, { ...after });
    this.seams = seams;
    this.revision++;
    if (history) this.stagedPages.push(page);
  }
  /** Replace only the loaded source interval; unrelated and inherited boundaries remain backing-owned. */
  setSeams(from: number, to: number, seams: ListSeam[], revision = this.revision, history = true) {
    if (revision !== this.revision) throw new Error('Stale list seam revision');
    if (bytes(JSON.stringify(seams)) > LIMITS.request)
      throw new Error('Seam payload exceeds budget');
    return this.atomic(() => {
      const desired = new Map(seams.map((s) => [s.from, s]));
      for (const seam of this.seams.values()) {
        if (seam.from < from || seam.from >= to) continue;
        if (JSON.stringify(seam) !== JSON.stringify(desired.get(seam.from)))
          this.seamChange(seam, null, history);
      }
      for (const seam of seams) {
        if (!Number.isSafeInteger(seam.from) || !Number.isSafeInteger(seam.start) || seam.start < 0)
          throw new Error('Invalid list seam coordinates');
        if (seam.from < from || seam.from >= to) throw new Error('Seam outside admission range');
        // Validate new records independently of the existing index.
        const line = this.slice(seam.from, Math.min(this.length, seam.from + 128));
        const match = line.match(/^( *)([-+*]|\d+[.)]) (?:\[([ xX/])\] )?/);
        const kind =
          match &&
          (match[3] !== undefined
            ? 'taskList'
            : /^\d/.test(match[2])
              ? 'orderedList'
              : 'bulletList');
        if (kind !== seam.kind || (seam.from && this.slice(seam.from - 1, seam.from) !== '\n'))
          throw new Error('Invalid list seam');
        if (JSON.stringify(this.seams.get(seam.from)) !== JSON.stringify(seam))
          this.seamChange(null, seam, history);
      }
    });
  }
  replay(change: Change, redo: boolean) {
    if (!this.atomicDepth) throw new Error('History replay requires atomic admission');
    if (change.tableState)
      this.applyTableState(
        redo
          ? (change as Change & { tableState: string })
          : {
              tableState: change.tableState,
              from: change.from,
              to: change.from + change.insert.length,
              insert: change.removed,
            },
      );
    else if (change.seam)
      this.seamChange(
        redo ? change.seam.before : change.seam.after,
        redo ? change.seam.after : change.seam.before,
        false,
      );
    else
      this.apply(
        redo
          ? change
          : { from: change.from, to: change.from + change.insert.length, insert: change.removed },
        false,
      );
  }
  private listItems(id: number): ListItem[] {
    this.spans(id);
    const start = this.start(id),
      active = new Map<number, { seam: ListSeam; ordinal: number }>();
    const previous = new Map<number, ListItem>();
    return this.inlineIndex.get(id)!.lists.map((item) => {
      const prior = previous.get(item.parent);
      if (
        prior &&
        (prior.marker !== item.marker ||
          this.region(id)
            .slice(prior.to, item.from)
            .split('\n')
            .some((line) => line.trim() && line.search(/\S/) <= item.indent))
      )
        active.delete(item.parent);
      previous.set(item.parent, item);
      const seam = this.seams.get(item.from + start);
      if (seam) active.set(item.parent, { seam, ordinal: seam.start });
      const group = active.get(item.parent);
      if (!group || group.seam.kind !== item.kind) {
        active.delete(item.parent);
        return item;
      }
      return { ...item, group: group.seam.from, ordinal: group.ordinal++ };
    });
  }
  // Mock backing index only. Rebuilt lazily per revision; no full projection/token map retained.
  private inlineIndex = new Map<
    number,
    { source: string; spans: SourceProjection['marks']; fences: Fence[]; lists: ListItem[] }
  >();
  backingIndexBuilds = 0;
  backingIndexScannedBytes = 0;
  maxBackingIndexSourceBytes = 0;
  backingFenceScannedBytes = 0;
  maxBackingFenceScanBytes = 0;
  maxFenceRepairBytes = 0;
  backingListRepairs = 0;
  maxListRepairRead = 0;
  inlineContextReads = 0;
  maxInlineContextBytes = 0;
  private spans(id: number) {
    const source = this.region(id);
    let index = this.inlineIndex.get(id);
    if (!index || index.source !== source) {
      const fences = scanFences(source);
      const projection = new SourceProjection(
        source,
        0,
        { revision: this.revision, from: 0, to: source.length, before: [], after: [], fences },
        true,
      );
      index = {
        source,
        spans: projection.marks.sort((a, b) => a.openFrom - b.openFrom),
        fences,
        lists: scanLists(source).filter(
          (i) => !fences.some((f) => i.from >= f.from && i.from < f.to),
        ),
      };
      this.inlineIndex.set(id, index);
      this.backingIndexBuilds++;
      this.backingIndexScannedBytes += bytes(source);
      this.maxBackingIndexSourceBytes = Math.max(this.maxBackingIndexSourceBytes, bytes(source));
    }
    return index.spans;
  }
  /** Limit both item metadata and mounted structure, independently of text bytes. */
  listWindow(from: number, to: number, target: number) {
    const { id, start } = this.locate(target);
    this.spans(id);
    const items = this.inlineIndex.get(id)!.lists;
    const overlaps = items.filter((i) => i.to + start > from && i.from + start < to);
    if (!overlaps.length) return { from, to };
    const found = overlaps.findIndex((i) => i.to + start > target);
    const center = found < 0 ? overlaps.length - 1 : found;
    const first = Math.max(0, center - 4),
      last = Math.min(overlaps.length - 1, first + 8);
    if (first) from = Math.max(from, overlaps[first].from + start);
    if (last < overlaps.length - 1) to = Math.min(to, overlaps[last].to + start);
    const align = () => {
      from = this.inlineBoundary(from, 1);
      to = this.inlineBoundary(to, -1);
      if (this.splitsSurrogate(from)) from++;
      if (this.splitsSurrogate(to)) to--;
      for (const i of overlaps) {
        if (from > i.from + start && from < i.body + start) from = i.body + start;
        if (to > i.from + start && to < i.body + start) to = i.from + start;
      }
    };
    align();
    // Backing-side sizing includes ancestor/ordinal/seam metadata and reserves edit headroom.
    // This mock may scan its full index; only the final bounded context reaches the renderer.
    while (
      bytes(this.slice(from, to)) + bytes(JSON.stringify(this.inlineContext(from, to))) >
      LIMITS.request - 512
    ) {
      const center = Math.max(from, Math.min(to, target));
      const nextFrom = from + Math.ceil((center - from) / 8);
      const nextTo = to - Math.ceil((to - center) / 8);
      if (nextFrom === from && nextTo === to)
        throw new Error('List context cannot fit the experiment budget');
      from = nextFrom;
      to = nextTo;
      align();
    }
    return { from, to };
  }
  /** Never crop inside syntax: move inward, without transmitting that syntax. */
  inlineBoundary(position: number, direction: -1 | 1) {
    const { id, start } = this.locate(position);
    let local = position - start;
    const spans = this.spans(id);
    for (const f of this.inlineIndex.get(id)!.fences) {
      if (local > f.from && local < f.bodyFrom) local = direction > 0 ? f.bodyFrom : f.from;
      if (local > f.bodyTo && local < f.to) local = direction > 0 ? f.to : f.bodyTo;
    }
    // Include empty boundary spans: an opener alone (or a closer alone) cannot
    // form an editable projection. Inner-first traversal also removes an empty
    // outer span when moving past nested syntax lands on its content boundary.
    for (let i = spans.length - 1; i >= 0; i--) {
      const span = spans[i];
      if (local > span.openFrom && local <= span.contentFrom) {
        if (direction < 0) local = span.openFrom;
        else if (local < span.contentFrom) local = span.contentFrom;
      }
      if (local >= span.contentTo && local < span.closeTo) {
        if (direction > 0) local = span.closeTo;
        else if (local > span.contentTo) local = span.contentTo;
      }
    }
    return start + local;
  }
  inlineContext(from: number, to: number, revision = this.revision): InlineContext {
    if (revision !== this.revision) throw new Error('Stale inline context');
    const stack = (position: number) => {
      const { id, start } = this.locate(position);
      const local = position - start;
      return this.spans(id)
        .filter((s) => s.openFrom < local && s.contentFrom <= local && local <= s.contentTo)
        .map((s) => s.mark);
    };
    const before = stack(from),
      after = stack(to);
    const fences: Fence[] = [];
    const lists: ListItem[] = [];
    for (let id = this.locate(from).id; id <= this.locate(to).id; id++) {
      this.spans(id);
      const start = this.start(id);
      const all = this.listItems(id);
      const included = new Map<number, ListItem>();
      const visible = all.filter((i) => i.from + start < to && i.to + start > from);
      const first = visible[0];
      const previous =
        first && all.filter((i) => i.parent === first.parent && i.from < first.from).at(-1);
      for (const item of [...(previous ? [previous] : []), ...visible]) {
        let next: ListItem | undefined = item;
        while (next && !included.has(next.from)) {
          included.set(next.from, next);
          next = all.find((i) => i.from === next!.parent);
        }
      }
      lists.push(
        ...[...included.values()]
          .sort((a, b) => a.from - b.from)
          .map((i) => ({
            ...i,
            from: i.from + start,
            body: i.body + start,
            end: i.end + start,
            to: i.to + start,
            parent: i.parent < 0 ? -1 : i.parent + start,
          })),
      );
      for (const f of this.inlineIndex.get(id)!.fences)
        if (f.from + start < to && f.to + start > from)
          fences.push({
            ...f,
            from: f.from + start,
            bodyFrom: f.bodyFrom + start,
            bodyTo: f.bodyTo + start,
            to: f.to + start,
          });
    }
    const context: InlineContext = {
      revision,
      from,
      to,
      before,
      after,
      ...(lists.length
        ? {
            lists,
            seams: [
              ...new Set(lists.map((i) => i.group).filter((p): p is number => p !== undefined)),
            ].map((p) => this.seams.get(p)!),
            documentEnd: to === this.length,
          }
        : {}),
      ...(fences.length ? { fences, documentEnd: to === this.length } : {}),
    };
    const size = bytes(JSON.stringify(context));
    if (size > LIMITS.request) throw new Error('Inline context exceeds experiment metadata budget');
    this.inlineContextReads++;
    this.maxInlineContextBytes = Math.max(this.maxInlineContextBytes, size);
    this.log('inline-context', from, size);
    return structuredClone(context);
  }
  private persisted = new Map<number, string>();
  private receipts = new Map<string, { payload: string; revision: number }>();
  private events: Array<{ meta: Omit<Event, 'changes'>; pages: string[] }> = [];
  private stagedPages: string[] = [];
  // Fake durable input inbox: renderer drains one bounded record, never the backlog.
  private inputInbox: string[] = [];
  maxInputRead = 0;
  enqueueInput(input: DeferredInput) {
    const text = input.text;
    if (text && text.length > 512) {
      for (let from = 0; from < text.length;) {
        let to = Math.min(from + 512, text.length);
        if (to < text.length && /[\uD800-\uDBFF]/.test(text[to - 1])) to--;
        this.enqueueInput({
          ...input,
          selection: from ? undefined : input.selection,
          text: text.slice(from, to),
        });
        from = to;
      }
      return;
    }
    const encoded = JSON.stringify(input);
    if (bytes(encoded) > LIMITS.request) throw new Error('Input record exceeds budget');
    this.inputInbox.push(encoded);
  }
  get pendingInputs() {
    return this.inputInbox.length;
  }
  readInput(): DeferredInput {
    const page = this.inputInbox[0];
    this.maxInputRead = Math.max(this.maxInputRead, bytes(page));
    return JSON.parse(page);
  }
  acknowledgeInput() {
    this.inputInbox.shift();
  }

  maxBackingAdmissionBytes = 0;
  private baseLengths: number[];
  cursor = 0;
  readonly logs: { method: string; from: number; bytes: number }[] = [];
  reads = 0;
  contextReads = 0;
  maxContextPayloadBytes = 0;
  maxRead = 0;
  journalReads = 0;
  maxJournalRead = 0;
  writes = 0;
  draftWrites = 0;
  maxSpliceBytes = 0;
  loseAcknowledgement = false;
  anchors: Anchor[];
  constructor(
    readonly generate = fixture,
    count = 10000,
  ) {
    this.count = count;
    this.baseLengths =
      count <= 20
        ? Array.from({ length: count }, (_, id) => generate(id).length)
        : [generate(0).length];
    const seam = generate(0).length;
    this.anchors = [
      {
        id: 'seam',
        from: Math.max(0, generate(0).indexOf('repeated')),
        to: seam + 11,
        alive: true,
      },
    ];
  }
  region(id: number) {
    return this.regions.get(id) ?? this.generate(id);
  }
  start(id: number) {
    let result =
      this.baseLengths.length === 1
        ? id * this.baseLengths[0]
        : this.baseLengths.slice(0, id).reduce((a, b) => a + b, 0);
    for (const [index, value] of this.regions)
      if (index < id) result += value.length - this.baseLength(index);
    return result;
  }
  private baseLength(id: number) {
    return this.baseLengths.length === 1 ? this.baseLengths[0] : this.baseLengths[id];
  }
  get length() {
    return this.start(this.count);
  }
  locate(position: number) {
    let lo = 0,
      hi = this.count - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.start(mid) <= position) lo = mid;
      else hi = mid - 1;
    }
    return { id: lo, start: this.start(lo) };
  }
  private log(method: string, from: number, size: number) {
    this.logs.push({ method, from, bytes: size });
    if (this.logs.length > LIMITS.log) this.logs.shift();
  }
  /** A bounded backing byte-length probe retains the accepted small-window behavior. */
  fitsWindow(from: number, to: number) {
    const result = to - from <= LIMITS.active && bytes(this.slice(from, to)) <= LIMITS.active;
    this.contextReads++;
    const size = bytes(JSON.stringify(result));
    this.maxContextPayloadBytes = Math.max(this.maxContextPayloadBytes, size);
    this.log('window-fit', from, size);
    return result;
  }
  /** Mock backing index: one boolean response, at most two inspected UTF-16 units. */
  splitsSurrogate(position: number) {
    const pair = this.slice(Math.max(0, position - 1), Math.min(this.length, position + 1));
    const result = /^[\uD800-\uDBFF][\uDC00-\uDFFF]$/.test(pair);
    this.contextReads++;
    const size = bytes(JSON.stringify(result));
    this.maxContextPayloadBytes = Math.max(this.maxContextPayloadBytes, size);
    this.log('context', position, size);
    return result;
  }
  read(from: number, to: number, revision = this.revision) {
    if (revision !== this.revision) throw new Error('Stale source revision');
    const source = this.slice(from, to);
    if (bytes(source) > LIMITS.request) throw new Error('Read exceeds page budget');
    this.reads++;
    this.maxRead = Math.max(this.maxRead, bytes(source));
    this.log('read', from, bytes(source));
    return { from, source, revision };
  }
  slice(from: number, to: number) {
    const first = this.locate(from),
      last = this.locate(to);
    let value = '';
    for (let id = first.id; id <= last.id; id++) {
      const start = this.start(id);
      value += this.region(id).slice(Math.max(0, from - start), Math.max(0, to - start));
    }
    return value;
  }
  apply(splice: Splice, validateSeams = true): Change {
    if (splice.from < 0 || splice.to < splice.from || splice.to > this.length)
      throw new Error('Invalid source range');
    const nextSeams = this.mappedSeams(splice, validateSeams);
    const removed = this.slice(splice.from, splice.to);
    this.draftWrites++;
    this.maxSpliceBytes = Math.max(this.maxSpliceBytes, bytes(JSON.stringify(splice)));
    this.log('splice', splice.from, bytes(JSON.stringify(splice)));
    const first = this.locate(splice.from),
      last = this.locate(splice.to);
    const suffix = this.region(last.id).slice(splice.to - last.start);
    if (first.id === last.id)
      this.regions.set(
        first.id,
        this.region(first.id).slice(0, splice.from - first.start) + splice.insert + suffix,
      );
    else {
      this.regions.set(
        first.id,
        this.region(first.id).slice(0, splice.from - first.start) + splice.insert,
      );
      for (let id = first.id + 1; id < last.id; id++) this.regions.set(id, '');
      this.regions.set(last.id, suffix);
    }
    this.anchors = this.anchors.map((a) => ({
      ...a,
      from: mapPoint(a.from, splice, 1),
      to: mapPoint(a.to, splice, -1),
      alive: a.alive && !(splice.from <= a.from && splice.to >= a.to && splice.to > splice.from),
    }));
    this.seams = nextSeams;
    this.tableStates = new Map(
      [...this.tableStates].map(([key, value]) => [this.mapTableKey(key, splice), value]),
    );
    this.revision++;
    this.inputInbox = this.inputInbox.map((encoded) => {
      const input: DeferredInput = JSON.parse(encoded);
      return input.selection
        ? JSON.stringify({
            ...input,
            selection: mapSelection(input.selection, splice, this.revision),
          })
        : encoded;
    });
    return { ...splice, removed };
  }
  commit(operationId: string, expectedRevision: number, splice: Splice) {
    const payload = JSON.stringify({ expectedRevision, splice });
    const receipt = this.receipts.get(operationId);
    if (receipt) {
      if (receipt.payload !== payload) throw new Error('Operation ID reused');
      return receipt.revision;
    }
    if (expectedRevision !== this.revision) throw new Error('Write conflict');
    if (bytes(payload) > LIMITS.request) throw new Error('Write exceeds budget');
    this.apply(splice);
    this.writes++;
    this.receipts.set(operationId, { payload, revision: this.revision });
    if (this.receipts.size > LIMITS.receipts)
      this.receipts.delete(this.receipts.keys().next().value!);
    if (this.loseAcknowledgement) {
      this.loseAcknowledgement = false;
      throw new Error('Acknowledgement lost');
    }
    return this.revision;
  }
  save() {
    this.persisted = new Map(this.regions);
  }
  get dirty() {
    return [...this.regions]
      .filter(([id, source]) => source !== (this.persisted.get(id) ?? this.generate(id)))
      .map(([id]) => id);
  }
  annotations(from: number, to: number, revision: number, generation: number) {
    if (revision !== this.revision || generation !== this.generation)
      throw new Error('Stale annotations');
    const items = this.anchors
      .filter((a) => a.alive && a.from < to && a.to > from)
      .slice(0, 8)
      .map((a) => ({ ...a }));
    const result = { revision, generation, commentRevision: this.commentRevision, items };
    this.log('annotations', from, bytes(JSON.stringify(result)));
    return result;
  }
  /** One change per disk page; grouping never rehydrates preceding changes. */
  event(index: number) {
    return structuredClone(this.events[index].meta);
  }
  bookmark(index: number, key: 'before' | 'after', selection: Selection) {
    const event = this.events[index];
    this.events[index] = { ...event, meta: { ...event.meta, [key]: { ...selection } } };
  }
  *changes(index: number, reverse = false): Generator<Change> {
    const pages = this.events[index].pages;
    for (let n = 0; n < pages.length; n++) {
      const page = pages[reverse ? pages.length - 1 - n : n];
      this.maxJournalRead = Math.max(this.maxJournalRead, bytes(page));
      this.journalReads++;
      yield JSON.parse(page);
    }
  }
  /** Fake backing-store transaction. Copy-on-write records keep rollback independent of page count. */
  atomic<T>(run: () => T): T {
    const regions = new Map(this.regions),
      events = this.events.slice();
    const state = {
      revision: this.revision,
      cursor: this.cursor,
      anchors: this.anchors,
      draftWrites: this.draftWrites,
      maxSpliceBytes: this.maxSpliceBytes,
      logs: this.logs.slice(),
      stagedPages: this.stagedPages.slice(),
      seams: this.seams,
      tableStates: this.tableStates,
      inputInbox: this.inputInbox,
    };
    this.atomicDepth++;
    try {
      const result = run();
      if (
        this.atomicDepth === 1 &&
        ([...this.seams.values()].some(
          (s) => !Number.isSafeInteger(s.from) || !Number.isSafeInteger(s.start) || s.start < 0,
        ) ||
          this.mappedSeams({ from: 0, to: 0, insert: '' }).size !== this.seams.size)
      )
        throw new Error('Invalid final source and list seam state');
      return result;
    } catch (error) {
      this.stagedPages = state.stagedPages;
      this.seams = state.seams;
      this.tableStates = state.tableStates;
      this.inputInbox = state.inputInbox;
      this.regions = regions;
      this.events = events;
      this.revision = state.revision;
      this.cursor = state.cursor;
      this.anchors = state.anchors;
      this.draftWrites = state.draftWrites;
      this.maxSpliceBytes = state.maxSpliceBytes;
      this.logs.splice(0, this.logs.length, ...state.logs);
      throw error;
    } finally {
      this.atomicDepth--;
    }
  }
  private pages(change: Change): string[] {
    const encoded = JSON.stringify(change);
    if (bytes(encoded) <= LIMITS.journalPage) return [encoded];
    const chunks = (text: string) => {
      const result: string[] = [];
      for (let from = 0; from < text.length;) {
        let to = Math.min(from + 512, text.length);
        if (to < text.length && /[\uD800-\uDBFF]/.test(text[to - 1])) to--;
        result.push(text.slice(from, to));
        from = to;
      }
      return result;
    };
    const pages: string[] = [];
    for (const removed of chunks(change.removed))
      pages.push(
        JSON.stringify({
          from: change.from,
          to: change.from + removed.length,
          insert: '',
          removed,
          ...(change.tableState ? { tableState: change.tableState } : {}),
        }),
      );
    let from = change.from;
    for (const insert of chunks(change.insert)) {
      pages.push(
        JSON.stringify({
          from,
          to: from,
          insert,
          removed: '',
          ...(change.tableState ? { tableState: change.tableState } : {}),
        }),
      );
      from += insert.length;
    }
    if (pages.some((p) => bytes(p) > LIMITS.journalPage))
      throw new Error('Journal page exceeds budget');
    return pages;
  }
  beginChanges() {
    this.stagedPages = [];
  }
  /** Mock backing admission: literal code and its framing form one atomic edit.
   * Full body scans are backing work, never renderer reads or parser inputs.
   */
  stageProjection(
    splices: Splice[],
    fences: Fence[],
    revision: number,
    history = true,
    indentation: Array<{ from: number; after: number; delta: number }> = [],
    onSplice?: (splice: Splice) => void,
  ) {
    if (revision !== this.revision) throw new Error('Stale code admission revision');
    return this.atomic(() => {
      // Full descendant discovery belongs to the mock backing index. The renderer
      // supplies bounded structural intents and receives one bounded repair at a time.
      const listRepairs = new Map<number, Splice>();
      for (const change of indentation) {
        const { id, start } = this.locate(change.from);
        this.spans(id);
        const items = this.inlineIndex.get(id)!.lists;
        const parent = items.find((i) => i.from + start === change.from)!;
        for (const child of items) {
          if (child.from <= parent.from) continue;
          if (child.indent <= parent.indent) break;
          if (child.from + start < change.after || listRepairs.has(child.from + start)) continue;
          listRepairs.set(child.from + start, {
            from: child.from + start,
            to: child.from + start + child.indent,
            insert: ' '.repeat(child.indent + change.delta),
          });
        }
      }
      for (const splice of splices) {
        this.stage(splice, history);
        onSplice?.(splice);
      }
      const repairs: Splice[] = [];
      for (const original of [...listRepairs.values()].sort((a, b) => b.from - a.from)) {
        const repair = { ...original };
        for (const splice of splices) {
          repair.from = mapPoint(repair.from, splice);
          repair.to = mapPoint(repair.to, splice);
        }
        if (!onSplice) throw new Error('List repair requires bounded acknowledgement');
        this.maxListRepairRead = Math.max(this.maxListRepairRead, bytes(JSON.stringify(repair)));
        if (this.maxListRepairRead > LIMITS.request) throw new Error('List repair exceeds budget');
        this.stage(repair, history);
        onSplice(repair);
        this.backingListRepairs++;
      }
      for (const fence of fences) {
        const marker = fence.opening.match(/^(`{3,}|~{3,})/)![0];
        const body = this.slice(fence.bodyFrom, fence.bodyTo);
        const size = bytes(body);
        this.backingFenceScannedBytes += size;
        this.maxBackingFenceScanBytes = Math.max(this.maxBackingFenceScanBytes, size);
        // Markdown permits up to three leading spaces and trailing horizontal
        // whitespace on closing lines. Include the real first/last body lines.
        const candidates = new RegExp(`^ {0,3}(${marker[0]}{${marker.length},})[ \\t]*$`, 'gm');
        let length = marker.length;
        for (const match of body.matchAll(candidates))
          length = Math.max(length, match[1].length + 1);
        if (length === marker.length) continue;
        repairs.push({
          from: fence.from,
          to: fence.from,
          insert: marker[0].repeat(length - marker.length),
        });
        const close = fence.closing.match(/(?:^|\n)(`{3,}|~{3,})[ \t]*(?:\n|$)/);
        const closeLength = Math.max(length, close?.[1].length ?? 0);
        if (close && close[1].length < closeLength) {
          const at = fence.bodyTo + close.index! + (close[0][0] === '\n' ? 1 : 0);
          repairs.push({
            from: at,
            to: at,
            insert: marker[0].repeat(closeLength - close[1].length),
          });
        }
      }
      // Descending source order preserves coordinates for every independent fence.
      repairs.sort((a, b) => b.from - a.from);
      this.maxFenceRepairBytes = Math.max(this.maxFenceRepairBytes, bytes(JSON.stringify(repairs)));
      for (const splice of repairs) {
        this.stage(splice, history);
        onSplice?.(splice);
      }
      return onSplice ? [] : [...splices, ...repairs];
    });
  }
  /** Admission and inverse paging live in the mock backing service, not a renderer change array. */
  stage(splice: Splice, history = true) {
    const change = { ...splice, removed: this.slice(splice.from, splice.to) };
    this.maxBackingAdmissionBytes = Math.max(
      this.maxBackingAdmissionBytes,
      bytes(JSON.stringify(change)),
    );
    const pages = this.pages(change);
    for (const page of pages) {
      const bounded: Change = JSON.parse(page);
      const mapped = this.mappedSeams(bounded);
      for (const seam of this.seams.values())
        if (
          (bounded.from <= seam.from && bounded.to > seam.from) ||
          !mapped.has(mapPoint(seam.from, bounded, 1))
        )
          this.seamChange(seam, null, history);
      this.apply(bounded);
      if (!history) this.rebase(bounded);
      if (history) this.stagedPages.push(page);
    }
  }
  record(event: Event, group: boolean) {
    // Admission precedes mutation, including truncating the redo branch.
    const pages = [...this.stagedPages, ...event.changes.flatMap((change) => this.pages(change))];
    const { changes: _changes, ...meta } = event;
    const events = this.events.slice(0, this.cursor);
    const previous = group && this.cursor ? events[this.cursor - 1] : undefined;
    if (previous)
      events[this.cursor - 1] = {
        pages: [...previous.pages, ...pages],
        meta: { ...previous.meta, after: meta.after, anchorsAfter: meta.anchorsAfter },
      };
    else events.push({ meta, pages });
    if (events.length > 120) events.splice(0, events.length - 100);
    this.events = events;
    this.cursor = events.length;
    this.stagedPages = [];
  }
  /** Carry the remote operation backwards through undo and forwards through redo coordinates. */
  rebase(splice: Splice) {
    const events = this.events.slice();
    const inverse = (c: Change): Splice => ({
      from: c.from,
      to: c.from + c.insert.length,
      insert: c.removed,
    });
    const mapSplice = (s: Splice, through: Splice): Splice => ({
      ...s,
      from: mapPoint(s.from, through, 1),
      to: mapPoint(s.to, through, s.from === s.to ? 1 : -1),
    });
    const anchors = (entries: Anchor[], through: Splice) =>
      entries.map((a) => ({
        ...a,
        from: mapPoint(a.from, through),
        to: mapPoint(a.to, through, -1),
      }));
    const meta = (e: Omit<Event, 'changes'>, before: Splice, after: Splice) => ({
      before: mapSelection(e.before, before, this.revision),
      after: mapSelection(e.after, after, this.revision),
      anchorsBefore: anchors(e.anchorsBefore, before),
      anchorsAfter: anchors(e.anchorsAfter, after),
    });
    const mapSeamChange = (change: Change, through: Splice): Change => {
      const map = (seam: ListSeam | null) => {
        if (!seam) return null;
        if (
          (through.from <= seam.from && through.to > seam.from) ||
          (through.from === seam.from &&
            through.to === seam.from &&
            through.insert &&
            !through.insert.endsWith('\n'))
        )
          throw new Error('Conflict: retained list seam history');
        return { ...seam, from: mapPoint(seam.from, through, 1) };
      };
      return {
        ...change,
        seam: { before: map(change.seam!.before), after: map(change.seam!.after) },
      };
    };
    let remote = splice;
    for (let i = this.cursor - 1; i >= 0; i--) {
      const event = this.events[i],
        after = remote,
        pages = new Array<string>(event.pages.length);
      for (let n = event.pages.length - 1; n >= 0; n--) {
        const c: Change = JSON.parse(event.pages[n]),
          inv = inverse(c);
        if (c.tableState) {
          const at = Number(c.tableState.slice(5));
          if (remote.from <= at && remote.to > at)
            throw new Error('Conflict: retained table structure history');
          pages[n] = JSON.stringify({ ...c, tableState: this.mapTableKey(c.tableState, remote) });
          continue;
        }
        if (c.seam) {
          pages[n] = JSON.stringify(mapSeamChange(c, remote));
          continue;
        }
        if (remote.from < inv.to && remote.to > inv.from)
          throw new Error('Conflict: retained draft and journal');
        const before = mapSplice(remote, inv);
        pages[n] = JSON.stringify(mapSplice(c, before));
        remote = before;
      }
      events[i] = {
        pages: pages.flatMap((page) => this.pages(JSON.parse(page))),
        meta: meta(event.meta, remote, after),
      };
    }
    remote = splice;
    for (let i = this.cursor; i < this.events.length; i++) {
      const event = this.events[i],
        before = remote,
        pages: string[] = [];
      for (const page of event.pages) {
        const c: Change = JSON.parse(page);
        if (c.tableState) {
          const at = Number(c.tableState.slice(5));
          if (remote.from <= at && remote.to > at)
            throw new Error('Conflict: retained table structure history');
          pages.push(JSON.stringify({ ...c, tableState: this.mapTableKey(c.tableState, remote) }));
          continue;
        }
        if (c.seam) {
          pages.push(JSON.stringify(mapSeamChange(c, remote)));
          continue;
        }
        if (remote.from < c.to && remote.to > c.from)
          throw new Error('Conflict: retained redo and journal');
        pages.push(JSON.stringify(mapSplice(c, remote)));
        remote = mapSplice(remote, c);
      }
      events[i] = {
        pages: pages.flatMap((page) => this.pages(JSON.parse(page))),
        meta: meta(event.meta, before, remote),
      };
    }
    this.events = events;
  }
  get depth() {
    return this.events.length;
  }
  get stats() {
    return {
      backingSeamScannedBytes: this.backingSeamScannedBytes,
      maxBackingSeamSourceBytes: this.maxBackingSeamSourceBytes,
      backingSeamCount: this.seams.size,
      backingTableIndexBytes: [...this.tableIndexes.values()].reduce(
        (n, index) => n + bytes(JSON.stringify(index.tables)),
        0,
      ),
      backingTableMetadataBytes: [...this.tableStates.values()].reduce(
        (n, value) => n + bytes(value),
        0,
      ),
      maxTableWriteBytes: this.maxTableWriteBytes,
      backingSeamBytes: bytes(JSON.stringify([...this.seams.values()])),
      backingListRepairs: this.backingListRepairs,
      maxListRepairRead: this.maxListRepairRead,
      backingIndexBuilds: this.backingIndexBuilds,
      backingIndexScannedBytes: this.backingIndexScannedBytes,
      maxBackingIndexSourceBytes: this.maxBackingIndexSourceBytes,
      backingFenceScannedBytes: this.backingFenceScannedBytes,
      maxBackingFenceScanBytes: this.maxBackingFenceScanBytes,
      maxFenceRepairBytes: this.maxFenceRepairBytes,
      backingIndexPayloadBytes: [...this.inlineIndex.values()].reduce(
        (n, i) => n + bytes(JSON.stringify({ spans: i.spans, fences: i.fences, lists: i.lists })),
        0,
      ),
      backingIndexSourceBytes: [...this.inlineIndex.values()].reduce(
        (n, i) => n + bytes(i.source),
        0,
      ),
      inlineContextReads: this.inlineContextReads,
      maxInlineContextBytes: this.maxInlineContextBytes,
      pendingInputs: this.pendingInputs,
      backingInputBytes: this.inputInbox.reduce((n, page) => n + bytes(page), 0),
      maxInputRead: this.maxInputRead,
      draftWrites: this.draftWrites,
      maxSpliceBytes: this.maxSpliceBytes,
      contextReads: this.contextReads,
      maxContextPayloadBytes: this.maxContextPayloadBytes,
      backingStagedJournalBytes: this.stagedPages.reduce((n, p) => n + bytes(p), 0),
      maxBackingAdmissionBytes: this.maxBackingAdmissionBytes,
      backingSourceBytes: [...this.regions.values()].reduce((n, s) => n + bytes(s), 0),
      backingSavedBytes: [...this.persisted.values()].reduce((n, s) => n + bytes(s), 0),
      backingJournalBytes: this.events.reduce(
        (n, e) => n + bytes(JSON.stringify(e.meta)) + e.pages.reduce((m, p) => m + bytes(p), 0),
        0,
      ),
      journalPages: this.events.reduce((n, e) => n + e.pages.length, 0),
      journalEvents: this.events.length,
      maxJournalRead: this.maxJournalRead,
      receiptCount: this.receipts.size,
      receiptBytes: [...this.receipts.values()].reduce((n, r) => n + bytes(r.payload), 0),
      logCount: this.logs.length,
      logBytes: bytes(JSON.stringify(this.logs)),
      dirty: this.dirty,
    };
  }
}
