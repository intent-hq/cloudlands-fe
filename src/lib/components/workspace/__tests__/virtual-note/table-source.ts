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
  from: number;
  to: number;
  rows: number;
  columns: number;
  row: number;
  column: number;
  cells: TableFragment[];
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
      columns: header.length,
      delimiter: { from: lines[n + 1].from, to: lines[n + 1].to, cells: delimiter },
      rows: [],
    };
    const add = (line: (typeof lines)[number], cells: ReturnType<typeof split>) => {
      const row = table.rows.length;
      const indexed: TableCellSource[] = [];
      let column = 0;
      for (const entry of cells) {
        if (column >= table.columns) break;
        const span = Number(metadata?.(entry.from)?.attrs?.colspan ?? 1);
        indexed.push({
          ...entry,
          row,
          column,
          align: alignments[column] ?? null,
          ...(span > 1 ? { span } : {}),
        });
        column += span;
      }
      while (column < table.columns)
        indexed.push({
          from: line.to,
          to: line.to,
          body: line.to,
          end: line.to,
          row,
          column: column++,
          align: alignments[column - 1] ?? null,
        });
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

export function admitTableWindow(
  source: string,
  table: TableIndex,
  position: number,
  revision: number,
  nativeCell?: (cell: TableCellSource) => JSONContent | undefined,
  retained?: TableWindow,
  preferred?: TablePoint,
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
    const center =
      entry === target ? Math.max(entry.body, Math.min(entry.end, position)) : entry.body;
    let first = Math.max(entry.body, center - Math.floor(limit / 2));
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
          : (runs.find((r) => r.to >= center)?.block ?? blocks.length - 1);
      let begin = Math.max(0, Math.min(blocks.length - 7, wanted - 3)),
        end = Math.min(blocks.length, begin + 7);
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
  let radius = 2,
    limit = 512;
  for (;;) {
    const cells: TableFragment[] = [];
    if (retained)
      for (const old of retained.cells)
        cells.push(
          cell(
            table.rows[old.row].cells.find((c) => c.column === old.column)!,
            limit,
          ),
        );
    else
      for (
        let r = Math.max(0, row - radius);
        r <= Math.min(table.rows.length - 1, row + radius);
        r++
      )
        for (
          let c = Math.max(0, column - radius);
          c <= Math.min(table.columns - 1, column + radius);
          c++
        ) {
          const entry = table.rows[r].cells.find(
            (e) => e.column <= c && e.column + (e.span ?? 1) > c,
          )!;
          if (!cells.some((x) => x.row === entry.row && x.column === entry.column))
            cells.push(cell(entry, limit));
        }
    const window: TableWindow = {
      revision,
      from: table.from,
      to: table.to,
      rows: table.rows.length,
      columns: table.columns,
      row,
      column,
      cells,
    };
    // Raw fragments and token/structural context are admitted together, with edit headroom.
    if (
      bytes(JSON.stringify(window)) + cells.reduce((n, c) => n + bytes(c.raw), 0) <=
      (retained ? 3968 : 3072)
    )
      return window;
    if (retained) throw new Error('Table edit requires window headroom');
    if (radius) radius--;
    else limit = Math.floor(limit / 2);
    if (limit < 8) throw new Error('Table cell context cannot fit admission budget');
  }
}
