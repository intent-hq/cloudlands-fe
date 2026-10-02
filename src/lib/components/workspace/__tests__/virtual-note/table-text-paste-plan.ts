import type { Editor, JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { tableEditing } from '@tiptap/pm/tables';
import { bytes } from './bounded-note-service';
import {
  clipboardCellSource,
  fitNativeTextPaste,
  type ClipboardValue,
  type CellSerializationWork,
} from './table-clipboard';
import { tableRuns, type TableIndex, type TableCellSource } from './table-source';
import type { TablePoint } from './source-journal';
import { applyNativeTableCommand, type TableCommandName } from './table-native-command';
import { CellSelection } from '@tiptap/pm/tables';

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
  serialization?: CellSerializationWork,
  command?: { name: TableCommandName; kind: 'text' | 'cell'; dispatch?: boolean },
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
  const fitted = command
    ? applyNativeTableCommand(
        doc,
        command.kind === 'cell' ? positions.get(anchor.cell)! : position(anchor),
        command.kind === 'cell' ? positions.get(head.cell)! : position(head),
        command.kind,
        command.name,
        editor,
        command.dispatch,
      )
    : fitNativeTextPaste(doc, position(anchor), position(head), value, editor, [tableEditing()]);
  const result = fitted.state.doc.firstChild!;
  if (result.type.name !== 'table') {
    if (command?.name !== 'deleteTable' || result.type.name !== 'paragraph' || result.content.size)
      throw new Error('Cross-cell replacement removed the table');
    return {
      accepted: 'accepted' in fitted ? fitted.accepted : true,
      text: '',
      states: [],
      point: undefined,
      caret: table.from + start,
      anchorSource: table.from + start,
      logicalSelection: undefined,
      costs: { ...fitted.costs, planBytes: 0, cells: 0, sourceBytes: 0, metadataBytes: 0 },
    };
  }
  let text = '';
  const states: Array<{ from: number; node: JSONContent }> = [];
  let point: TablePoint | undefined, caret: number | undefined;
  let anchorPoint: TablePoint | undefined, anchorSource: number | undefined;
  result.forEach((row, ro, r) => {
    // A retained final source row has no terminator. Native append must add a
    // separator before its new row without rewriting any existing cell text.
    if (r > 0 && !text.endsWith('\n'))
      text += source.slice(table.rows[0].from, table.rows[0].to).endsWith('\r\n') ? '\r\n' : '\n';
    const old = table.rows.find((_, i) => rows[i] === row);
    const ending =
      source
        .slice(
          table.rows[Math.min(r, table.rows.length - 1)].from,
          table.rows[Math.min(r, table.rows.length - 1)].to,
        )
        .match(/\r?\n$/)?.[0] ?? '';
    let line = '|';
    row.forEach((cell, co, c) => {
      const origin = origins.get(cell);
      const raw = origin
        ? source.slice(origin.from, origin.to)
        : ` ${clipboardCellSource(cell, serialization)} `;
      const from = table.from + text.length + (old ? old.cells[c].from - old.from : line.length);
      states.push({ from: from + start, node: cell.toJSON() });
      const nodePosition = 2 + ro + co;
      const selection = fitted.state.selection.$head;
      const cellSelection = fitted.state.selection instanceof CellSelection;
      const headPosition = cellSelection
        ? (fitted.state.selection as CellSelection).$headCell.pos
        : selection.pos;
      const anchorPosition = cellSelection
        ? (fitted.state.selection as CellSelection).$anchorCell.pos
        : fitted.state.selection.anchor;
      if (anchorPosition >= nodePosition && anchorPosition < nodePosition + cell.nodeSize) {
        anchorPoint = {
          cell: from + start,
          block: cellSelection ? 0 : fitted.state.selection.$anchor.index(3),
          offset: cellSelection ? 0 : fitted.state.selection.$anchor.parentOffset,
        };
        anchorSource = from + start + raw.length - raw.trimStart().length;
      }
      if (headPosition >= nodePosition && headPosition < nodePosition + cell.nodeSize) {
        point = {
          cell: from + start,
          block: cellSelection ? 0 : selection.index(3),
          offset: cellSelection ? 0 : selection.parentOffset,
        };
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
      // Canonical Markdown takes alignment from physical first-row cells. A
      // native range replacement can move their owners without changing width.
      // Preserve framing, whitespace and dash spelling for every retained slot.
      const delimiters: string[] = [];
      row.forEach((cell, _offset, c) => {
        const entry = table.delimiter.cells[c];
        const raw = entry ? source.slice(entry.from, entry.to) : ' --- ';
        const align = cell.attrs.align;
        delimiters.push(
          raw.replace(
            /:?-+:?/,
            (token) =>
              (align === 'left' || align === 'center' ? ':' : '') +
              token.replace(/:/g, '') +
              (align === 'right' || align === 'center' ? ':' : ''),
          ),
        );
      });
      if (delimiters.length === table.delimiter.cells.length) {
        let delimiter = source.slice(table.delimiter.from, table.delimiter.to);
        for (let c = delimiters.length - 1; c >= 0; c--) {
          const entry = table.delimiter.cells[c];
          delimiter =
            delimiter.slice(0, entry.from - table.delimiter.from) +
            delimiters[c] +
            delimiter.slice(entry.to - table.delimiter.from);
        }
        text += delimiter;
      } else text += '|' + delimiters.join('|') + '|' + ending;
    }
  });
  if (!point || caret === undefined)
    throw new Error('Cross-cell text paste did not retain a cell caret');
  return {
    accepted: 'accepted' in fitted ? fitted.accepted : true,
    text,
    states,
    point,
    caret,
    logicalSelection: {
      kind: fitted.state.selection instanceof CellSelection ? ('cell' as const) : ('text' as const),
      anchor: anchorPoint ?? point,
      head: point,
    },
    anchorSource: fitted.state.selection.empty ? caret : (anchorSource ?? caret),
    costs: {
      ...fitted.costs,
      planBytes: bytes(JSON.stringify({ text, states })),
      cells: states.length,
      sourceBytes: bytes(text),
      metadataBytes: bytes(JSON.stringify(states)),
    },
  };
}
