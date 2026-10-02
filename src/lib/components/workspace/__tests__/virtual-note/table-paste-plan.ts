import type { JSONContent } from '@tiptap/core';
import type { Fragment, Schema } from '@tiptap/pm/model';
import { removeColSpan } from '@tiptap/pm/tables';
import { bytes } from './bounded-note-service';
import { clipboardCellSource } from './table-clipboard';
import { tableRuns, type TableCellSource, type TableIndex } from './table-source';

type Cell = {
  row: number;
  column: number;
  width: number;
  height: number;
  original?: TableCellSource;
  node?: JSONContent;
  raw?: string;
};

/** Mock backing only: source/index-sized planning and input-sized PM cells never
 * cross the renderer boundary. No complete target PM table, view or DOM is built. */
export function planTablePaste(
  source: string,
  table: TableIndex,
  rect: { top: number; bottom: number; left: number; right: number },
  input: { rows: Fragment[] },
  schema: Schema,
  stored: (cell: number) => JSONContent | undefined,
) {
  const { top, bottom, left, right } = rect;
  const changed = new Set<number>();
  let cells: Cell[] = table.rows.flatMap((row) =>
    row.cells.map((cell) => ({
      row: cell.row,
      column: cell.column,
      width: cell.span ?? 1,
      height: cell.rowSpan ?? 1,
      original: cell,
    })),
  );
  const node = (cell: Cell): JSONContent => {
    if (cell.node) return cell.node;
    const original = cell.original!;
    return (
      stored(original.from) ??
      schema
        .nodeFromJSON({
          type: original.row === 0 ? 'tableHeader' : 'tableCell',
          attrs: { align: original.align, colspan: cell.width, rowspan: cell.height },
          content: [
            {
              type: 'paragraph',
              content: tableRuns(source.slice(original.body, original.end), original.body).map(
                (run) => ({
                  type: run.hardBreak ? 'hardBreak' : 'text',
                  ...(run.hardBreak ? {} : { text: run.text }),
                  marks: run.marks,
                }),
              ),
            },
          ],
        })
        .toJSON()
    );
  };
  const raw = (cell: Cell) => cell.raw ?? source.slice(cell.original!.from, cell.original!.to);
  const empty = (prior: JSONContent, attrs: JSONContent['attrs']) =>
    schema.nodes[prior.type!].createAndFill(attrs)!.toJSON();
  // Native isolates top/bottom before left/right. The original owner keeps its
  // content; each newly exposed right/bottom fragment starts empty.
  for (const edge of [top, bottom]) {
    const added: Cell[] = [];
    for (const cell of cells) {
      if (
        cell.row >= edge ||
        cell.row + cell.height <= edge ||
        cell.column >= right ||
        cell.column + cell.width <= left
      )
        continue;
      const prior = node(cell),
        lowerHeight = cell.row + cell.height - edge;
      added.push({
        row: edge,
        column: cell.column,
        width: cell.width,
        height: lowerHeight,
        node: empty(prior, { ...prior.attrs, rowspan: lowerHeight }),
        raw: '  ',
      });
      cell.node = { ...prior, attrs: { ...prior.attrs, rowspan: edge - cell.row } };
      cell.height = edge - cell.row;
      changed.add(cell.row);
      changed.add(edge);
    }
    cells.push(...added);
  }
  for (const edge of [left, right]) {
    const added: Cell[] = [];
    for (const cell of cells) {
      if (
        cell.column >= edge ||
        cell.column + cell.width <= edge ||
        cell.row >= bottom ||
        cell.row + cell.height <= top
      )
        continue;
      const prior = node(cell),
        leftWidth = edge - cell.column,
        rightWidth = cell.width - leftWidth;
      const attrs = prior.attrs as Parameters<typeof removeColSpan>[0];
      added.push({
        row: cell.row,
        column: edge,
        width: rightWidth,
        height: cell.height,
        node: empty(prior, removeColSpan(attrs, 0, leftWidth)),
        raw: '  ',
      });
      cell.node = { ...prior, attrs: removeColSpan(attrs, leftWidth, rightWidth) };
      cell.width = leftWidth;
      changed.add(cell.row);
    }
    cells.push(...added);
  }
  cells = cells.filter((cell) => {
    if (cell.row >= top && cell.row < bottom && cell.column >= left && cell.column < right) {
      changed.add(cell.row);
      return false;
    }
    return true;
  });
  const occupied = new Map<number, number>();
  for (let r = 0; r < input.rows.length; r++) {
    let column = left;
    input.rows[r].forEach((cell) => {
      while ((occupied.get(column) ?? 0) > r) column++;
      const width = Number(cell.attrs.colspan),
        height = Number(cell.attrs.rowspan);
      for (let c = column; c < column + width; c++) occupied.set(c, r + height);
      cells.push({
        row: top + r,
        column,
        width,
        height,
        node: cell.toJSON(),
        raw: ` ${clipboardCellSource(cell)} `,
      });
      column += width;
    });
    changed.add(top + r);
  }
  let metadataBytes = 0,
    sourceBytes = 0;
  const rows = [...changed]
    .sort((a, b) => a - b)
    .map((r) => {
      const original = table.rows[r];
      const members = cells.filter((cell) => cell.row === r).sort((a, b) => a.column - b.column);
      const prefix = original.cells.length
        ? source.slice(original.from, original.cells[0].from)
        : '|';
      const suffix = original.cells.length
        ? source.slice(original.cells.at(-1)!.to, original.to)
        : '|' + (source[original.to - 1] === '\n' ? '\n' : '');
      let text = prefix;
      const states: Array<{ offset: number; node: JSONContent }> = [];
      for (const [i, cell] of members.entries()) {
        if (i) text += '|';
        const value = node(cell);
        states.push({ offset: text.length, node: value });
        metadataBytes += bytes(JSON.stringify(value));
        text += raw(cell);
      }
      if (!members.length) text += '  ';
      text += suffix;
      sourceBytes += bytes(text);
      return { index: r, from: original.from, to: original.to, text, states };
    });
  return {
    rows,
    costs: {
      cells: cells.length,
      metadataBytes,
      sourceBytes,
      planBytes: bytes(JSON.stringify(rows)),
    },
  };
}
