import type { TableGeometry } from './table-heights';
import { packTableWindow } from './table-payload';
import { Lexer, Parser, type Token } from 'marked';
import { sanitizeMarkdownHTML } from '$lib/utils/html-sanitizer';
import type { JSONContent } from '@tiptap/core';
import type { TablePoint } from './source-journal';
import { bytes } from './bounded-note-service';
import { scanFences } from './fence-context';

export type TableRun = {
  from: number;
  to: number;
  text: string;
  marks: NonNullable<JSONContent['marks']>;
  hardBreak?: boolean;
  block?: number;
  offset?: number;
  code?: { from: number; to: number };
};
export type TableCellSource = {
  row: number;
  column: number;
  from: number;
  to: number;
  body: number;
  end: number;
  align: string | null;
  span?: number;
  rowSpan?: number;
};
export type TableIndex = {
  from: number;
  to: number;
  columns: number;
  delimiter: {
    from: number;
    to: number;
    cells: Array<{ from: number; to: number; body: number; end: number }>;
  };
  rows: Array<{ from: number; to: number; cells: TableCellSource[] }>;
};
export type TableFragment = TableCellSource & {
  partial?: boolean;
  owner?: { row: number; column: number; rowspan: number; colspan: number };
  mounted?: { rowspan: number; colspan: number };
  first: number;
  last: number;
  raw: string;
  runs: TableRun[];
  blocks?: Array<{ index: number; from: number; to: number }>;
  blockCount?: number;
  attrs?: JSONContent['attrs'];
  nodeType?: string;
};
export type TableWindow = {
  revision: number;
  trailing?: boolean;
  selected?: {
    anchor: number;
    head: number;
    top: number;
    bottom: number;
    left: number;
    right: number;
    backwardRows: boolean;
    backwardColumns: boolean;
  };
  extent?: { row: number; column: number; rowCount: number; columnCount: number };
  from: number;
  to: number;
  rows: number;
  columns: number;
  row: number;
  column: number;
  cells: TableFragment[];
  geometry?: TableGeometry;
  layout?: Array<{ cell: number; top: number; bottom: number }>;
};

/** Mock backing scan. Full row/cell arrays never cross the window admission boundary. */
export function scanTables(
  source: string,
  metadata?: (from: number) => JSONContent | undefined,
): TableIndex[] {
  const fences = scanFences(source);
  const lines: Array<{ from: number; to: number; text: string }> = [];
  for (const match of source.matchAll(/[^\n]*(?:\n|$)/g)) {
    if (!match[0]) continue;
    lines.push({
      from: match.index!,
      to: match.index! + match[0].length,
      text: match[0].replace(/\n$/, ''),
    });
  }
  const split = (line: (typeof lines)[number]) => {
    const pipes: number[] = [];
    let slashes = 0;
    for (let n = 0; n < line.text.length; n++) {
      const char = line.text[n];
      if (char === '|' && slashes % 2 === 0) pipes.push(n);
      slashes = char === '\\' ? slashes + 1 : 0;
    }
    if (!pipes.length) return [];
    const edges = [-1, ...pipes, line.text.length];
    if (!line.text.slice(0, pipes[0]).trim()) edges.shift();
    if (!line.text.slice(pipes.at(-1)! + 1).trim()) edges.pop();
    return edges.slice(0, -1).map((edge, i) => {
      const from = edge + 1,
        to = edges[i + 1];
      const raw = line.text.slice(from, to);
      const leading = raw.length - raw.trimStart().length;
      return {
        from: line.from + from,
        to: line.from + to,
        body: line.from + from + leading,
        end: line.from + from + Math.max(leading, raw.trimEnd().length),
      };
    });
  };
  const tables: TableIndex[] = [];
  for (let n = 0; n + 1 < lines.length; n++) {
    if (fences.some((f) => lines[n].from >= f.from && lines[n].from < f.to)) continue;
    const header = split(lines[n]),
      delimiter = split(lines[n + 1]);
    if (
      !header.length ||
      delimiter.length !== header.length ||
      !delimiter.every((c) => /^:?-+:?$/.test(source.slice(c.body, c.end)))
    )
      continue;
    const alignments = delimiter.map((c) => {
      const text = source.slice(c.body, c.end);
      return text.startsWith(':')
        ? text.endsWith(':')
          ? 'center'
          : 'left'
        : text.endsWith(':')
          ? 'right'
          : null;
    });
    const table: TableIndex = {
      from: lines[n].from,
      to: lines[n + 1].to,
      columns: header.reduce(
        (sum, cell) => sum + Number(metadata?.(cell.from)?.attrs?.colspan ?? 1),
        0,
      ),
      delimiter: { from: lines[n + 1].from, to: lines[n + 1].to, cells: delimiter },
      rows: [],
    };
    const occupied = new Map<number, number>(); // Mock backing index only.
    const add = (line: (typeof lines)[number], cells: ReturnType<typeof split>) => {
      const row = table.rows.length;
      const indexed: TableCellSource[] = [];
      let column = 0;
      for (const entry of cells) {
        while ((occupied.get(column) ?? 0) > row) column++;
        if (column >= table.columns) break;
        const attrs = metadata?.(entry.from)?.attrs;
        const span = Number(attrs?.colspan ?? 1),
          rowSpan = Number(attrs?.rowspan ?? 1);
        for (let c = column; c < column + span; c++) occupied.set(c, row + rowSpan);
        indexed.push({
          ...entry,
          row,
          column,
          align: alignments[column] ?? null,
          ...(span > 1 ? { span } : {}),
          ...(rowSpan > 1 ? { rowSpan } : {}),
        });
        column += span;
      }
      while (column < table.columns) {
        if ((occupied.get(column) ?? 0) > row) {
          column++;
          continue;
        }
        indexed.push({
          from: line.to,
          to: line.to,
          body: line.to,
          end: line.to,
          row,
          column: column++,
          align: alignments[column - 1] ?? null,
        });
      }
      table.rows.push({ from: line.from, to: line.to, cells: indexed });
      table.to = line.to;
    };
    add(lines[n], header);
    n += 2;
    while (n < lines.length) {
      const cells = split(lines[n]);
      if (!cells.length) break;
      add(lines[n], cells);
      n++;
    }
    tables.push(table);
    n--;
  }
  return tables;
}

/** Mock backing lookup; no table-wide ownership map is sent to the renderer. */
export function tableCellAt(table: TableIndex, row: number, column: number) {
  for (let r = row; r >= 0; r--) {
    const cell = table.rows[r].cells.find(
      (c) => c.column <= column && c.column + (c.span ?? 1) > column && r + (c.rowSpan ?? 1) > row,
    );
    if (cell) return cell;
  }
  throw new Error('Missing logical table owner');
}

const decode = (text: string) => {
  const el = document.createElement('textarea');
  el.innerHTML = text;
  return el.value;
};

/** Compressed mock backing token index, with exact UTF-16 source boundaries. */
export function tableRuns(source: string, start: number): TableRun[] {
  const runs: TableRun[] = [];
  const plain = (raw: string, from: number, marks: TableRun['marks']) => {
    let cursor = 0;
    for (const part of raw.matchAll(
      /\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]|&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/gi,
    )) {
      if (part.index! > cursor)
        runs.push({
          from: from + cursor,
          to: from + part.index!,
          text: raw.slice(cursor, part.index),
          marks,
        });
      runs.push({
        from: from + part.index!,
        to: from + part.index! + part[0].length,
        text: part[0][0] === '\\' ? part[0].slice(1) : decode(part[0]),
        marks,
      });
      cursor = part.index! + part[0].length;
    }
    if (cursor < raw.length)
      runs.push({ from: from + cursor, to: from + raw.length, text: raw.slice(cursor), marks });
  };
  const visit = (tokens: Token[], from: number, marks: TableRun['marks']) => {
    for (const token of tokens) {
      if (token.type === 'strong' || token.type === 'em' || token.type === 'del') {
        const delimiter = token.type === 'em' ? 1 : 2;
        visit(token.tokens!, from + delimiter, [
          ...marks,
          { type: token.type === 'strong' ? 'bold' : token.type === 'em' ? 'italic' : 'strike' },
        ]);
      } else if (token.type === 'link') {
        const parsed = document.createElement('div');
        parsed.innerHTML = sanitizeMarkdownHTML(Parser.parseInline([token]));
        const href = parsed.querySelector('a')?.getAttribute('href');
        visit(
          token.tokens!,
          from + 1,
          href
            ? [
                ...marks,
                {
                  type: 'link',
                  attrs: {
                    href,
                    target: '_blank',
                    rel: 'noopener noreferrer nofollow',
                    class: 'text-primary-ink underline cursor-pointer',
                  },
                },
              ]
            : marks,
        );
      } else if (token.type === 'codespan') {
        const fence = token.raw.match(/^`+/)![0].length;
        const body = token.raw.slice(fence, -fence);
        const trim = /^ .* $/.test(body) && /[^ ]/.test(body) ? 1 : 0;
        const raw = body.slice(trim, body.length - trim),
          base = from + fence + trim;
        const code = { from, to: from + token.raw.length };
        let cursor = 0;
        for (const part of raw.matchAll(/\\\|/g)) {
          if (part.index! > cursor)
            runs.push({
              from: base + cursor,
              to: base + part.index!,
              text: raw.slice(cursor, part.index),
              marks: [{ type: 'code' }],
              code,
            });
          runs.push({
            from: base + part.index!,
            to: base + part.index! + 2,
            text: '|',
            marks: [{ type: 'code' }],
            code,
          });
          cursor = part.index! + 2;
        }
        if (cursor < raw.length)
          runs.push({
            from: base + cursor,
            to: base + raw.length,
            text: raw.slice(cursor),
            marks: [{ type: 'code' }],
            code,
          });
      } else if (
        token.type === 'br' ||
        (token.type === 'html' && /^<br\s*\/?\s*>$/i.test(token.raw))
      ) {
        runs.push({ from, to: from + token.raw.length, text: '\n', marks, hardBreak: true });
      } else if (token.type === 'html' && /^<!--/.test(token.raw)) {
        // Anchors stay in untouched canonical source, not synthetic editable text.
      } else if (token.type === 'text' || token.type === 'escape' || token.type === 'html') {
        plain(token.raw, from, marks);
      } else throw new Error(`Unrepresented table inline token: ${token.type}`);
      from += token.raw.length;
    }
  };
  visit(Lexer.lexInline(source, { gfm: true }), start, []);
  let group: TableRun[] = [];
  for (const run of runs) {
    if (!run.code) {
      group = [];
      continue;
    }
    const last = group.at(-1);
    if (
      last?.code &&
      last.code.to !== run.code.from &&
      last.code.to !== run.code.to &&
      !/^<!-- -->$/.test(source.slice(last.code.to - start, run.code.from - start))
    )
      group = [];
    group.push(run);
    const code = { from: group[0].code!.from, to: run.code.to };
    for (const member of group) member.code = code;
  }
  return runs;
}

export type TableRectangle = {
  fragmentStart?: (cell: TableCellSource, limit: number) => number;
  row: number;
  column: number;
  rowCount: number;
  columnCount: number;
  geometry?: TableGeometry;
};

export function admitTableWindow(
  source: string,
  table: TableIndex,
  position: number,
  revision: number,
  nativeCell?: (cell: TableCellSource) => JSONContent | undefined,
  retained?: TableWindow,
  preferred?: TablePoint,
  rectangle?: TableRectangle,
): TableWindow {
  const targetRow = table.rows.findIndex((row) => position < row.to);
  const row = Math.max(0, targetRow < 0 ? table.rows.length - 1 : targetRow);
  const target =
    table.rows[row].cells.find((c) => position <= c.to) ?? table.rows[row].cells.at(-1)!;
  const column = target.column;
  const cell = (entry: TableCellSource, limit: number): TableFragment => {
    let runs = tableRuns(source.slice(entry.body, entry.end), entry.body);
    let textOffset = 0;
    runs = runs.map((run) => {
      const offset = textOffset;
      textOffset += run.text.length;
      return { ...run, offset };
    });
    const native = nativeCell?.(entry);
    const blocks: Array<{ index: number; from: number; to: number }> = [];
    if (native) {
      const mapped: TableRun[] = [];
      let index = 0,
        offset = 0,
        boundary = entry.body;
      for (const [block, paragraph] of (native.content ?? []).entries()) {
        const from = boundary;
        let blockOffset = 0;
        if (paragraph.type !== 'paragraph') throw new Error('Unrepresented native table block');
        for (const node of paragraph.content ?? []) {
          const text = node.type === 'hardBreak' ? '\n' : (node.text ?? '');
          let consumed = 0;
          while (consumed < text.length) {
            const run = runs[index];
            if (!run) throw new Error('Table metadata does not match source text');
            const count = Math.min(text.length - consumed, run.text.length - offset);
            if (text.slice(consumed, consumed + count) !== run.text.slice(offset, offset + count))
              throw new Error('Table metadata does not match source text');
            const equal = run.to - run.from === run.text.length;
            const start = equal ? run.from + offset : run.from;
            boundary = equal ? start + count : run.to;
            mapped.push({
              from: start,
              to: boundary,
              text: text.slice(consumed, consumed + count),
              marks: node.marks ?? [],
              ...(run.code ? { code: run.code } : {}),
              block,
              offset: blockOffset + consumed,
              ...(node.type === 'hardBreak' ? { hardBreak: true } : {}),
            });
            consumed += count;
            offset += count;
            if (offset === run.text.length) {
              index++;
              offset = 0;
            }
          }
          blockOffset += text.length;
        }
        blocks.push({ index: block, from, to: boundary });
      }
      if (index !== runs.length || offset) throw new Error('Table metadata lost source text');
      runs = mapped;
    }
    // Unseen merged cells use the approved logical-row estimate. Their bounded
    // paragraph window must progress with the admitted span, including empty
    // paragraphs whose source positions coincide. An explicit caret wins.
    const projectedBlock =
      rectangle && (entry.rowSpan ?? 1) > 1 && blocks.length > 1
        ? Math.min(
            blocks.length - 1,
            Math.floor((Math.max(0, rectangle.row - entry.row) * blocks.length) / entry.rowSpan!),
          )
        : undefined;
    const center =
      projectedBlock !== undefined && preferred?.cell !== entry.from
        ? blocks[projectedBlock].from
        : entry === target
          ? Math.max(entry.body, Math.min(entry.end, position))
          : entry.body;
    let first =
      (projectedBlock === undefined ? rectangle?.fragmentStart?.(entry, limit) : undefined) ??
      Math.max(entry.body, center - Math.floor(limit / 2));
    let last = Math.min(entry.end, first + limit);
    const old = retained?.cells.find((c) => c.row === entry.row && c.column === entry.column);
    if (old) {
      first = old.first;
      last = old.last;
    }
    if (/[\uDC00-\uDFFF]/.test(source[first] ?? '')) first++;
    if (/[\uDC00-\uDFFF]/.test(source[last] ?? '')) last--;
    let selectedBlocks = blocks;
    if (blocks.length) {
      const wanted =
        preferred?.cell === entry.from
          ? preferred.block
          : (projectedBlock ?? runs.find((r) => r.to >= center)?.block ?? blocks.length - 1);
      const count =
        projectedBlock !== undefined && rectangle
          ? Math.max(7, Math.ceil((blocks.length * rectangle.rowCount) / entry.rowSpan!) + 6)
          : 7;
      let begin = Math.max(0, Math.min(blocks.length - count, wanted - 3)),
        end = Math.min(blocks.length, begin + count);
      if (old?.blocks?.length) {
        begin = old.blocks[0].index;
        end = old.blocks.at(-1)!.index + 1 + blocks.length - (old.blockCount ?? blocks.length);
      }
      selectedBlocks = blocks.slice(begin, end);
    }
    const selected = runs
      .filter(
        (r) =>
          r.to > first &&
          r.from < last &&
          (!selectedBlocks.length || selectedBlocks.some((b) => b.index === (r.block ?? 0))),
      )
      .map((r) => {
        if (r.to - r.from !== r.text.length) return r;
        const from = Math.max(first, r.from),
          to = Math.min(last, r.to);
        return {
          ...r,
          from,
          to,
          offset: (r.offset ?? 0) + from - r.from,
          text: r.text.slice(from - r.from, to - r.from),
        };
      });
    if (selectedBlocks.length && !selected.length) {
      first = selectedBlocks[0].from;
      last = selectedBlocks.at(-1)!.to;
    }
    if (selected.length) {
      first = selected[0].from;
      last = selected.at(-1)!.to;
    }
    return {
      ...entry,
      ...(selectedBlocks.length !== blocks.length ||
      selected.length !== runs.length ||
      selected.some((run, i) => run.text !== runs[i].text)
        ? { partial: true }
        : {}),
      first,
      last,
      raw: source.slice(first, last),
      runs: selected,
      ...(native
        ? {
            blocks: selectedBlocks,
            blockCount: blocks.length,
            attrs: native.attrs,
            nodeType: native.type,
          }
        : {}),
    };
  };
  const viewport = !!rectangle?.geometry;
  let radius = 2,
    limit = viewport ? 8192 : 512;
  for (;;) {
    const cells: TableFragment[] = [];
    const extent = retained?.extent ?? {
      row: Math.max(0, rectangle?.row ?? row - radius),
      column: Math.max(0, rectangle?.column ?? column - radius),
      rowCount: 0,
      columnCount: 0,
    };
    if (!retained?.extent) {
      extent.rowCount =
        Math.min(
          table.rows.length,
          rectangle ? rectangle.row + rectangle.rowCount : row + radius + 1,
        ) - extent.row;
      extent.columnCount =
        Math.min(
          table.columns,
          rectangle ? rectangle.column + rectangle.columnCount : column + radius + 1,
        ) - extent.column;
    }
    const admit = (entry: TableCellSource) => {
      if (cells.some((c) => c.from === entry.from)) return;
      const fragment = cell(entry, limit);
      if ((entry.span ?? 1) > 1 || (entry.rowSpan ?? 1) > 1) {
        fragment.owner = {
          row: entry.row,
          column: entry.column,
          rowspan: entry.rowSpan ?? 1,
          colspan: entry.span ?? 1,
        };
        fragment.row = Math.max(entry.row, extent.row);
        fragment.column = Math.max(entry.column, extent.column);
        fragment.mounted = {
          rowspan:
            Math.min(entry.row + (entry.rowSpan ?? 1), extent.row + extent.rowCount) - fragment.row,
          colspan:
            Math.min(entry.column + (entry.span ?? 1), extent.column + extent.columnCount) -
            fragment.column,
        };
      }
      cells.push(fragment);
    };
    if (retained) {
      for (const old of retained.cells) admit(tableCellAt(table, old.row, old.column));
    } else {
      for (let r = extent.row; r < extent.row + extent.rowCount; r++)
        for (let c = extent.column; c < extent.column + extent.columnCount; c++)
          admit(tableCellAt(table, r, c));
    }
    cells.sort((a, b) => a.row - b.row || a.column - b.column);
    const window: TableWindow = {
      revision,
      from: table.from,
      to: table.to,
      rows: table.rows.length,
      columns: table.columns,
      row,
      column,
      cells,
      ...(cells.some((c) => c.owner) ? { extent } : {}),
      ...((rectangle?.geometry ?? retained?.geometry)
        ? { geometry: rectangle?.geometry ?? retained?.geometry }
        : {}),
    };
    // Raw fragments and token/structural context are admitted together, with edit headroom.
    if (
      bytes(JSON.stringify(packTableWindow(window))) +
        cells.reduce((n, c) => n + bytes(c.raw), 0) <=
      (retained ? 16256 : viewport ? 14336 : 3072)
    )
      return window;
    if (retained) throw new Error('Table edit requires window headroom');
    if (radius && !rectangle) radius--;
    else limit = Math.floor(limit * (viewport ? 0.8 : 0.5));
    if (limit < 8) throw new Error('Table cell context cannot fit admission budget');
  }
}
