import { serializeTableAliases, aliasedTableIndex, type TableAliases } from './table-alias';
import type { CommandHistory } from './command-history';
import type { TableDOMReplacement } from './table-dom-replacement';
import { Slice } from '@tiptap/pm/model';
import { tablePointPosition, tableTextPoint, tableFlattenedTextOffset } from './table-nested';
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
import {
  tableRuns,
  tableRunNode,
  scanTables,
  type TableIndex,
  type TableCellSource,
} from './table-source';
import type { TablePoint } from './source-journal';
import {
  applyNativeTableCommand,
  type TableCommandName,
  type TableCommandSlice,
} from './table-native-command';
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
  command?: {
    name: TableCommandName;
    kind: 'text' | 'cell';
    dispatch?: boolean;
    slice?: TableCommandSlice;
    neighbor?: { node: PMNode; anchor?: number; head?: number };
    dom?: TableDOMReplacement;
    preserve?: { anchor: TablePoint; head: TablePoint };
    aliased?: boolean;
  },
) {
  const schema = editor.schema;
  const sourcePoint = (
    entries: { pm: number; cell: PMNode; raw: string; from: number; aliased?: boolean }[],
    pm: number,
  ) => {
    for (const entry of entries) {
      if (pm < entry.pm) return entry.from;
      if (pm >= entry.pm + entry.cell.nodeSize) continue;
      if (pm <= entry.pm + 1) return entry.from;
      if (pm >= entry.pm + entry.cell.nodeSize - 1) return entry.from + entry.raw.length;
      let offset = entry.aliased
        ? tableFlattenedTextOffset(entry.cell, pm - entry.pm - 1)
        : tableTextPoint(entry.cell, pm - entry.pm - 1).textOffset;
      const body = entry.from + entry.raw.length - entry.raw.trimStart().length;
      for (const run of tableRuns(entry.raw.trim(), body)) {
        if (offset <= run.text.length)
          return run.to - run.from === run.text.length
            ? run.from + offset
            : offset
              ? run.to
              : run.from;
        offset -= run.text.length;
      }
      return entry.from + entry.raw.trimEnd().length;
    }
    const last = entries.at(-1);
    return last ? last.from + last.raw.length : table.from + start;
  };
  const beforeEntries: {
    pm: number;
    cell: PMNode;
    raw: string;
    from: number;
    aliased?: boolean;
  }[] = [];
  const afterEntries: typeof beforeEntries = [];
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
              content: tableRuns(source.slice(entry.body, entry.end), entry.body).map(tableRunNode),
            },
          ],
        },
      );
      beforeEntries.push({
        pm: cellPosition,
        cell,
        raw: source.slice(entry.from, entry.to),
        from: entry.from + start,
        aliased: command?.aliased,
      });
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
    command?.neighbor?.node ?? schema.nodes.paragraph.create(),
  ]);
  const position = (point: TablePoint) => {
    const pos = positions.get(point.cell);
    if (pos === undefined) throw new Error('Stale cross-cell text point');
    const cell = doc.nodeAt(pos)!;
    return pos + 1 + tablePointPosition(cell, point);
  };
  let replacement: { from: number; to: number; anchor: number; head: number } | undefined;
  let expandedSlice = command?.slice;
  if (command?.dom) {
    const neighbor = command.neighbor;
    if (!neighbor || !command.slice || command.name !== 'replaceSelection')
      throw new Error('Missing DOM replacement ownership');
    const tail = Math.max(neighbor.anchor ?? 0, neighbor.head ?? 0);
    if (tail < 1 || tail > neighbor.node.content.size + 1)
      throw new Error('Invalid DOM suffix position');
    expandedSlice = structuredClone(command.slice);
    let leaf = expandedSlice.content?.[command.dom.path[0]];
    for (const index of command.dom.path.slice(1)) leaf = leaf?.content?.[index];
    if (!leaf || leaf.type !== 'paragraph') throw new Error('Invalid DOM suffix ancestry');
    const prefix = schema.nodeFromJSON(leaf);
    leaf.content = prefix.content.append(neighbor.node.content.cut(tail - 1)).toJSON() ?? [];
    const from = neighbor.anchor === undefined ? position(anchor) : position(head);
    replacement = {
      from,
      to: doc.content.size,
      anchor: from + command.dom.anchor,
      head: from + command.dom.head,
    };
  }
  const fitted = command
    ? applyNativeTableCommand(
        doc,
        command.neighbor?.anchor !== undefined
          ? doc.firstChild!.nodeSize + command.neighbor.anchor
          : command.kind === 'cell'
            ? positions.get(anchor.cell)!
            : position(anchor),
        command.neighbor?.head !== undefined
          ? doc.firstChild!.nodeSize + command.neighbor.head
          : command.kind === 'cell'
            ? positions.get(head.cell)!
            : position(head),
        command.kind,
        command.name,
        editor,
        command.dispatch,
        expandedSlice,
        replacement,
        command.preserve && {
          anchor: position(command.preserve.anchor),
          head: position(command.preserve.head),
        },
      )
    : fitNativeTextPaste(doc, position(anchor), position(head), value, editor, [tableEditing()]);
  if (command?.dom && expandedSlice) {
    const materialized = Slice.fromJSON(schema, expandedSlice);
    materialized.content.descendants(() => {
      fitted.costs.nodes++;
    });
    fitted.costs.serializedBytes += bytes(JSON.stringify(expandedSlice));
  }
  const result = fitted.state.doc.firstChild!;
  if (command?.neighbor) {
    for (let i = 1; i < fitted.state.doc.childCount; i++)
      if (fitted.state.doc.child(i).content.size)
        throw new Error('Native mixed table move retained an unplanned neighbor');
  }
  if (result.type.name !== 'table') {
    if (
      !['deleteTable', 'deleteSelection'].includes(command?.name ?? '') ||
      result.type.name !== 'paragraph' ||
      result.content.size
    )
      throw new Error('Cross-cell replacement removed the table');
    return {
      accepted: 'accepted' in fitted ? fitted.accepted : true,
      text: '',
      history: { before: [], after: [] } as CommandHistory,
      states: [],
      point: undefined,
      caret: table.from + start,
      anchorSource: table.from + start,
      logicalSelection: undefined,
      costs: { ...fitted.costs, planBytes: 0, cells: 0, sourceBytes: 0, metadataBytes: 0 },
    };
  }
  let text = '';
  let aliases: TableAliases | undefined;
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
      afterEntries.push({ pm: nodePosition, cell, raw, from: from + start });
      const selection = fitted.state.selection.$head;
      const cellSelection = fitted.state.selection instanceof CellSelection;
      const headPosition = cellSelection
        ? (fitted.state.selection as CellSelection).$headCell.pos
        : selection.pos;
      const anchorPosition = cellSelection
        ? (fitted.state.selection as CellSelection).$anchorCell.pos
        : fitted.state.selection.anchor;
      const logicalPoint = (position: number) => {
        const { textOffset: _textOffset, ...point } = tableTextPoint(
          cell,
          position - nodePosition - 1,
        );
        return point;
      };
      if (anchorPosition >= nodePosition && anchorPosition < nodePosition + cell.nodeSize) {
        anchorPoint = {
          cell: from + start,
          ...(cellSelection ? { block: 0, offset: 0 } : logicalPoint(anchorPosition)),
        };
        anchorSource = from + start + raw.length - raw.trimStart().length;
      }
      if (headPosition >= nodePosition && headPosition < nodePosition + cell.nodeSize) {
        point = {
          cell: from + start,
          ...(cellSelection ? { block: 0, offset: 0 } : logicalPoint(headPosition)),
        };
        let offset = cellSelection
          ? 0
          : tableTextPoint(cell, headPosition - nodePosition - 1).textOffset;
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
  let nested = false;
  result.descendants((node) => {
    if (node.type.name === 'table') nested = true;
  });
  if (nested) {
    const serialized = serializeTableAliases(result);
    aliases = serialized.aliases;

    fitted.costs.nodes += serialized.costs.nodes;
    fitted.costs.serializedBytes += serialized.costs.serializedBytes;
    let canonical = '';
    result.forEach((row, _offset, r) => {
      const nativeRow = serialized.index.rows[r];
      const old = table.rows.find((_, i) => rows[i] === row);
      canonical += old
        ? source.slice(old.from, r === 0 ? Math.max(old.to, table.delimiter.to) : old.to)
        : serialized.source.slice(nativeRow.from, nativeRow.to);
    });
    const index = aliasedTableIndex(scanTables(canonical, undefined, true)[0], aliases);
    const cells = index.rows.flatMap((row) => row.cells);
    const remap = new Map<number, number>();
    for (const [i, entry] of afterEntries.entries()) {
      const cell = cells[i];
      remap.set(entry.from, table.from + start + cell.from);
      entry.from = table.from + start + cell.from;
      entry.raw = canonical.slice(cell.from, cell.to);
      entry.aliased = true;
      states[i].from = entry.from;
    }
    if (point) point.cell = remap.get(point.cell)!;
    if (anchorPoint) anchorPoint.cell = remap.get(anchorPoint.cell)!;
    caret = sourcePoint(afterEntries, fitted.state.selection.head);
    anchorSource = sourcePoint(afterEntries, fitted.state.selection.anchor);
    text = canonical;
  }
  if (!point || caret === undefined)
    throw new Error('Cross-cell text paste did not retain a cell caret');
  const nativeHistory =
    command?.name === 'replaceSelection' && 'history' in fitted ? fitted.history : undefined;
  const history: CommandHistory = { before: [], after: [] };
  if (nativeHistory) {
    history.before = nativeHistory.before.map(([a, b]) => [
      sourcePoint(beforeEntries, a),
      sourcePoint(beforeEntries, b),
    ]);
    history.after = nativeHistory.after.map(([a, b]) => [
      sourcePoint(afterEntries, a),
      sourcePoint(afterEntries, b),
    ]);
  }
  return {
    aliases,
    history,
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
      planBytes:
        bytes(JSON.stringify({ text, states, history, aliases })) +
        bytes(JSON.stringify(beforeEntries)) +
        bytes(JSON.stringify(afterEntries)),
      cells: states.length,
      sourceBytes: bytes(text),
      metadataBytes: bytes(JSON.stringify(states)),
    },
  };
}
