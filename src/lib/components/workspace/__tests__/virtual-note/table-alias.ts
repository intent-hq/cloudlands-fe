import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model';
import { TableMap } from '@tiptap/pm/tables';
import { processHTMLToMarkdown } from '$lib/utils/markdown-processor';
import { bytes } from './bounded-note-service';
import {
  scanTables,
  tableRuns,
  type TableIndex,
  type TableCellSource,
  type TableRun,
} from './table-source';
import type { TablePath } from './table-nested';

/** External mock backing provenance. This whole-table index never enters a renderer reply. */
export type TableAliases = {
  columns: number;
  rows: Array<{
    physical: number;
    cells: Array<{ physical: number; column: number; span: number; rowSpan: number }>;
  }>;
  occurrences: Array<{ row: number; cell: number; path: number[] }>;
};
/** Resolve an admitted atom to bytes emitted for its real native cell owner.
 * All scans remain backing-side; only this one occurrence enters the page. */
export function emittedTableAnchor(
  source: string,
  table: TableIndex,
  aliases: TableAliases,
  cell: TableCellSource,
  path: TablePath,
  anchor: TableRun['anchor'],
  measure: (bytes: number) => void,
): TableRun['emitted'] {
  const c = table.rows[cell.row].cells.findIndex((entry) => entry.from === cell.from);
  const owner = [cell.row, c, ...path.slice(0, -1).map((part) => part.index)];
  const physical = scanTables(source, undefined, true).find((entry) => entry.from === table.from);
  if (!physical) throw new Error('Missing canonical table occurrence');
  const retainedBytes =
    bytes(source) + bytes(JSON.stringify(aliases)) + bytes(JSON.stringify(physical));
  measure(retainedBytes);
  for (let i = aliases.occurrences.length - 1; i >= 0; i--) {
    const occurrence = aliases.occurrences[i];
    if (JSON.stringify(occurrence.path) !== JSON.stringify(owner)) continue;
    const entry = physical.rows[occurrence.row]?.cells[occurrence.cell];
    if (!entry) throw new Error('Missing canonical anchor cell');
    const raw = source.slice(entry.body, entry.end);
    const runs = tableRuns(raw, entry.body);
    measure(retainedBytes + bytes(raw) + bytes(JSON.stringify(runs)));
    const run = runs.find((run) => run.anchor?.id === anchor?.id);
    if (run) return { from: run.from, to: run.to, raw: source.slice(run.from, run.to) };
  }
  throw new Error('Missing native canonical anchor bytes');
}
export function aliasedTableIndex(table: TableIndex, aliases: TableAliases): TableIndex {
  return {
    ...table,
    columns: aliases.columns,
    rows: aliases.rows.map((row, r) => {
      const physical = table.rows[row.physical];
      if (!physical) throw new Error('Missing canonical alias row');
      return {
        from: physical.from,
        to: table.rows[aliases.rows[r + 1]?.physical]?.from ?? table.to,
        cells: row.cells.map((c) => {
          const cell = physical.cells[c.physical];
          if (!cell) throw new Error('Missing canonical alias cell');
          return { ...cell, row: r, column: c.column, span: c.span, rowSpan: c.rowSpan };
        }),
      };
    }),
  };
}
/** Serialize with production code, then match emitted DOM rows/cells to native ancestry.
 * Descendant enumeration records provenance only; it never constructs Markdown text. */
export function serializeTableAliases(node: PMNode) {
  const container = document.createElement('div');
  container.appendChild(DOMSerializer.fromSchema(node.type.schema).serializeNode(node));
  const element = container.querySelector('table')!;
  const domRows = Array.from(element.querySelectorAll('tr'));
  const domCells = Array.from(element.querySelectorAll('td,th'));
  const nativeCells: number[][] = [];
  const nativeRows: number[][] = [];
  const walk = (parent: PMNode, path: number[]) =>
    parent.forEach((child, _at, index) => {
      const next = [...path, index];
      if (['tableCell', 'tableHeader'].includes(child.type.name)) nativeCells.push(next);
      if (child.type.name === 'tableRow') nativeRows.push(next);
      walk(child, next);
    });
  walk(node, []);
  if (nativeCells.length !== domCells.length)
    throw new Error('Native table DOM ownership mismatch');
  const paths = new Map(domCells.map((cell, i) => [cell, nativeCells[i]]));
  const emittedRows: Element[] = [];
  const thead = element.querySelector('thead'),
    header = thead?.querySelector('tr');
  if (header) emittedRows.push(header);
  for (const row of Array.from((element.querySelector('tbody') ?? element).querySelectorAll('tr')))
    if (!thead || row.parentElement !== thead) emittedRows.push(row);
  const source = processHTMLToMarkdown(container.innerHTML).trimEnd() + '\n';
  const physical = scanTables(source, undefined, true)[0];
  if (!physical || physical.rows.length !== emittedRows.length)
    throw new Error('Native canonical row provenance mismatch');
  const occurrences: TableAliases['occurrences'] = [];
  emittedRows.forEach((row, r) =>
    Array.from(row.querySelectorAll('td,th')).forEach((cell, c) => {
      const path = paths.get(cell);
      if (!path || !physical.rows[r].cells[c])
        throw new Error('Native canonical cell provenance mismatch');
      occurrences.push({ row: r, cell: c, path });
    }),
  );
  const map = TableMap.get(node);
  const aliases: TableAliases = { columns: map.width, rows: [], occurrences };
  let position = 0;
  node.forEach((row, _at, r) => {
    const domRow = domRows[nativeRows.findIndex((path) => path.length === 1 && path[0] === r)];
    if (!domRow) throw new Error('Missing native direct row provenance');
    const physicalRow = emittedRows.indexOf(domRow);
    const cells: TableAliases['rows'][number]['cells'] = [];
    row.forEach((cell, offset, c) => {
      const occurrence = occurrences.find(
        (o) => o.row === physicalRow && o.path.length === 2 && o.path[0] === r && o.path[1] === c,
      );
      if (!occurrence) throw new Error('Missing native direct cell provenance');
      const rect = map.findCell(position + 1 + offset);
      cells.push({
        physical: occurrence.cell,
        column: rect.left,
        span: cell.attrs.colspan,
        rowSpan: cell.attrs.rowspan,
      });
    });
    aliases.rows.push({ physical: physicalRow, cells });
    position += row.nodeSize;
  });
  let nodes = 0;
  node.descendants(() => {
    nodes++;
  });
  return {
    source,
    aliases,
    index: aliasedTableIndex(physical, aliases),
    costs: {
      nodes,
      serializedBytes:
        bytes(container.innerHTML) +
        bytes(source) +
        bytes(JSON.stringify(node.toJSON())) +
        bytes(JSON.stringify(aliases)) +
        bytes(JSON.stringify(physical)),
    },
  };
}
