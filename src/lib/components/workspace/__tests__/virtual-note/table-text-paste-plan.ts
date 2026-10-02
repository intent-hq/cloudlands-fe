import type { Editor, JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { tableEditing, TableMap } from '@tiptap/pm/tables';
import { bytes } from './bounded-note-service';
import { clipboardCellSource, fitNativeTextPaste, type ClipboardValue } from './table-clipboard';
import { tableRuns, type TableIndex, type TableCellSource } from './table-source';
import type { TablePoint } from './source-journal';

/** External backing model, NOT a renderer projection or production algorithm.
 * Cross-cell native replacement needs table repair. This full table PM state and
 * its source/metadata plans scale with backing size and are reported separately.
 * It creates no EditorView and performs no table DOM/layout. */
export function planTableTextPaste(
  source: string,
  start: number,
  table: TableIndex,
  anchor: TablePoint,
  head: TablePoint,
  value: ClipboardValue,
  editor: Editor,
  stored: (from: number) => JSONContent | undefined,
) {
  const schema = editor.schema;
  const origins = new Map<PMNode, TableCellSource>();
  const positions = new Map<number, number>();
  let rowPosition = 1;
  const rows = table.rows.map((row) => {
    let cellPosition = rowPosition + 1;
    const cells = row.cells.map((entry) => {
      const cell = schema.nodeFromJSON(
        stored(entry.from) ?? {
          type: entry.row === 0 ? 'tableHeader' : 'tableCell',
          attrs: { align: entry.align, colspan: entry.span ?? 1, rowspan: entry.rowSpan ?? 1 },
          content: [
            {
              type: 'paragraph',
              content: tableRuns(source.slice(entry.body, entry.end), entry.body).map((run) => ({
                type: run.hardBreak ? 'hardBreak' : 'text',
                ...(run.hardBreak ? {} : { text: run.text }),
                marks: run.marks,
              })),
            },
          ],
        },
      );
      origins.set(cell, entry);
      positions.set(entry.from + start, cellPosition);
      cellPosition += cell.nodeSize;
      return cell;
    });
    const node = schema.nodes.tableRow.create(null, cells);
    rowPosition += node.nodeSize;
    return node;
  });
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.table.create(null, rows),
    schema.nodes.paragraph.create(),
  ]);
  const position = (point: TablePoint) => {
    const pos = positions.get(point.cell);
    if (pos === undefined) throw new Error('Stale cross-cell text point');
    const cell = doc.nodeAt(pos)!;
    let offset = pos + 2;
    for (let i = 0; i < point.block; i++) offset += cell.child(i).nodeSize;
    return offset + point.offset;
  };
  const fitted = fitNativeTextPaste(doc, position(anchor), position(head), value, editor, [
    tableEditing(),
  ]);
  const result = fitted.state.doc.firstChild!;
  if (result.type.name !== 'table') throw new Error('Cross-cell replacement removed the table');
  const width = TableMap.get(result).width;
  let text = '';
  const states: Array<{ from: number; node: JSONContent }> = [];
  let point: TablePoint | undefined, caret: number | undefined;
  result.forEach((row, ro, r) => {
    const old = table.rows.find((_, i) => rows[i] === row);
    const ending =
      source
        .slice(
          table.rows[Math.min(r, table.rows.length - 1)].from,
          table.rows[Math.min(r, table.rows.length - 1)].to,
        )
        .match(/\r?\n$/)?.[0] ?? '';
    let line = '|';
    row.forEach((cell, co) => {
      const origin = origins.get(cell);
      const raw = origin ? source.slice(origin.from, origin.to) : ` ${clipboardCellSource(cell)} `;
      const from = table.from + text.length + line.length;
      states.push({ from: from + start, node: cell.toJSON() });
      const nodePosition = 2 + ro + co;
      const selection = fitted.state.selection.$head;
      if (selection.pos > nodePosition && selection.pos < nodePosition + cell.nodeSize) {
        point = { cell: from + start, block: selection.index(3), offset: selection.parentOffset };
        let offset = point.offset;
        for (let i = 0; i < point.block; i++) offset += cell.child(i).content.size;
        const body = from + raw.length - raw.trimStart().length;
        const content = raw.trim();
        caret = body + content.length;
        for (const run of tableRuns(content, body)) {
          if (offset <= run.text.length) {
            caret =
              run.to - run.from === run.text.length
                ? run.from + offset
                : offset
                  ? run.to
                  : run.from;
            break;
          }
          offset -= run.text.length;
        }
        caret += start;
      }
      line += raw + '|';
    });
    // Preserve complete untouched rows exactly, including framing and line endings.
    // Native rows with no physical cell are represented like the canonical serializer.
    text += old ? source.slice(old.from, old.to) : line + (row.childCount ? '' : '  |') + ending;
    if (r === 0) {
      if (width === table.columns) text += source.slice(table.delimiter.from, table.delimiter.to);
      else
        text +=
          '|' +
          Array.from({ length: width }, (_, c) =>
            c < table.delimiter.cells.length
              ? source.slice(table.delimiter.cells[c].from, table.delimiter.cells[c].to)
              : ' --- ',
          ).join('|') +
          '|' +
          ending;
    }
  });
  if (!point || caret === undefined)
    throw new Error('Cross-cell text paste did not retain a cell caret');
  return {
    text,
    states,
    point,
    caret,
    costs: {
      ...fitted.costs,
      planBytes: bytes(JSON.stringify({ text, states })),
      cells: states.length,
      sourceBytes: bytes(text),
      metadataBytes: bytes(JSON.stringify(states)),
    },
  };
}
