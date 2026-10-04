import { NoteCanonicalProjection } from './note-canonical-projection';
import { Lexer } from 'marked';
import type { TableWindow, TableFragment } from './projection/table-source';
import { tableRuns } from './projection/table-source';
import { SourceProjection, type InlineContext, type Mark } from './projection/source-projection';
import type { ListItem } from './projection/list-context';
import type { NoteWindow } from './note-window-reader';

type Boundary = Extract<NoteWindow['context'][number], { kind: 'boundary' }>;
const contains = (outer: Boundary, inner: Boundary) =>
  outer !== inner &&
  outer.sourceRange.start <= inner.sourceRange.start &&
  outer.sourceRange.end >= inner.sourceRange.end;
const supported = new Set([
  'paragraph',
  'heading',
  'strong',
  'strikethrough',
  'emphasis',
  'link',
  'codeBlock',
  'list',
  'listItem',
  'table',
  'tableHead',
  'tableRow',
  'tableCell',
]);
/** The proof's bounded native source projection, fed by wire lexical descriptors.
 * Revision tokens remain opaque; local projection revisions are view-local only.
 * This module never scans or reconstructs an unloaded prefix/body.
 */
export function projectNoteWindow(window: NoteWindow): SourceProjection {
  if (window.native) return new NoteCanonicalProjection(window);
  const boundaries = window.context
    .filter((i): i is Boundary => i.kind === 'boundary')
    .sort(
      (a, b) => a.sourceRange.start - b.sourceRange.start || b.sourceRange.end - a.sourceRange.end,
    );
  for (const b of boundaries)
    if (!supported.has(b.construct)) throw new Error(`Unsupported note construct: ${b.construct}`);
  const field = (b: Boundary, key: string, required = false) => {
    const v = window.details[b.id]?.[key];
    if (v === undefined && required) throw new Error(`Missing ${b.construct} ${key} context`);
    return v ?? '';
  };
  const marks = boundaries
    .filter((b) => ['strong', 'emphasis', 'link', 'strikethrough'].includes(b.construct))
    .map((b) => {
      const opening = field(b, 'openingSource', true),
        closing = field(b, 'closingSource', true);
      const mark: Mark = {
        type:
          b.construct === 'strong'
            ? 'bold'
            : b.construct === 'emphasis'
              ? 'italic'
              : b.construct === 'strikethrough'
                ? 'strike'
                : 'link',
        range: {
          from: b.sourceRange.start + opening.length,
          to: b.sourceRange.end - closing.length,
        },
      };
      if (b.construct === 'emphasis' || b.construct === 'strong') mark.delimiter = opening;
      if (b.construct === 'link') mark.attrs = { href: field(b, 'destination', true) };
      return mark;
    });
  const context: InlineContext = {
    revision: 0,
    from: window.range.start,
    to: window.range.end,
    before: marks.filter(
      (m) => m.range!.from <= window.range.start && m.range!.to > window.range.start,
    ),
    after: marks.filter((m) => m.range!.from < window.range.end && m.range!.to >= window.range.end),
    documentEnd: window.documentEnd,
    fences: boundaries
      .filter((b) => b.construct === 'codeBlock')
      .map((b) => {
        const opening = field(b, 'openingSource', true),
          closing = field(b, 'closingSource', true);
        return {
          from: b.sourceRange.start,
          to: b.sourceRange.end,
          bodyFrom: b.sourceRange.start + opening.length,
          bodyTo: b.sourceRange.end - closing.length,
          opening,
          closing,
          language: field(b, 'info').trim().split(/\s+/)[0] || null,
        };
      }),
  };
  context.headings = boundaries
    .filter((b) => b.construct === 'heading')
    .map((b) => {
      const level = field(b, 'level', true);
      if (!/^h[1-6]$/.test(level)) throw new Error('Invalid heading level');
      return {
        from: b.sourceRange.start,
        to: b.sourceRange.end,
        bodyFrom: b.sourceRange.start + field(b, 'openingSource', true).length,
        bodyTo: b.sourceRange.end - field(b, 'closingSource', true).length,
        level: Number(level.slice(1)),
      };
    });
  context.atoms = (context.fences ?? [])
    .filter((f) => f.language === 'mermaid' || f.language === 'diff')
    .map((f) => {
      if (f.from < window.range.start || f.to > window.range.end)
        throw new Error('Rich fence requires a bounded reference payload consumer');
      const raw = window.text.slice(f.from - window.range.start, f.to - window.range.start);
      const token = Lexer.lex(raw, { gfm: true })[0];
      if (token?.type !== 'code') throw new Error('Invalid rich fence source');
      return {
        from: f.from,
        to: f.to,
        node: {
          type: f.language === 'mermaid' ? 'mermaidBlock' : 'diffBlock',
          attrs: { code: btoa(unescape(encodeURIComponent(token.text))) },
        },
      };
    });
  context.fences = context.fences?.filter((f) => f.language !== 'mermaid' && f.language !== 'diff');
  const tableBoundaries = boundaries.filter((b) => b.construct === 'table');
  const tables: TableWindow[] = tableBoundaries.map((table) => {
    const cells: TableFragment[] = boundaries
      .filter((b) => b.construct === 'tableCell' && contains(table, b))
      .map((cell) => {
        const position = cell.tablePosition;
        if (!position || position.columnIndex === undefined || position.alignment === undefined)
          throw new Error('Missing table cell address');
        const body = cell.sourceRange.start + field(cell, 'openingSource', true).length;
        const end = cell.sourceRange.end - field(cell, 'closingSource', true).length;
        const first = Math.max(body, window.range.start),
          last = Math.min(end, window.range.end);
        const raw = window.text.slice(first - window.range.start, last - window.range.start);
        return {
          row: position.rowIndex,
          column: position.columnIndex,
          from: cell.sourceRange.start,
          to: cell.sourceRange.end,
          body,
          end,
          first,
          last,
          raw,
          align: position.alignment === 'none' ? null : position.alignment,
          runs: tableRuns(raw, first).map((run) => ({
            ...run,
            marks: [
              ...marks
                .filter(
                  (m) =>
                    m.range!.from <= run.from &&
                    m.range!.to >= run.to &&
                    !run.marks.some((r) => r.type === m.type),
                )
                .map((m) => ({ type: m.type, ...(m.attrs ? { attrs: m.attrs } : {}) })),
              ...run.marks,
            ],
          })),
          partial: first > body || last < end,
        };
      })
      .filter((c) => c.first <= c.last)
      .sort((a, b) => a.row - b.row || a.column - b.column);
    if (!cells.length) throw new Error('Missing admitted table cells');
    for (let i = 1; i < cells.length; i++)
      if (cells[i].row - cells[i - 1].row > 128) throw new Error('Noncontiguous table window rows');
    return {
      revision: 0,
      from: table.sourceRange.start,
      to: table.sourceRange.end,
      row: cells[0].row,
      column: Math.min(...cells.map((c) => c.column)),
      rows: Math.max(...cells.map((c) => c.row)) + 1,
      columns: Math.max(...cells.map((c) => c.column)) + 1,
      cells,
    };
  });
  if (
    tables.length === 1 &&
    tables[0].from <= window.range.start &&
    tables[0].to >= window.range.end
  )
    context.table = tables[0];
  else if (tables.length) context.tables = tables;
  const items = boundaries.filter((b) => b.construct === 'listItem');
  if (items.length)
    context.lists = items.map((b) => {
      const parent = items.filter((p) => contains(p, b)).at(-1);
      const owner = boundaries.filter((p) => p.construct === 'list' && contains(p, b)).at(-1);
      if (!owner) throw new Error('Missing list parent context');
      const prefix = field(b, 'openingSource', true);
      const marker = prefix.match(/([-+*]|\d+[.)])\s+(?:\[([ xX/])\]\s+)?/);
      if (!marker) throw new Error('Missing list item marker context');
      const nested = boundaries.find((p) => p.construct === 'list' && contains(b, p));
      return {
        from: b.sourceRange.start,
        to: b.sourceRange.end,
        body: b.sourceRange.start + prefix.length,
        end: Math.min(
          nested?.sourceRange.start ?? Infinity,
          b.sourceRange.end - field(b, 'closingSource', true).length,
        ),
        parent: parent?.sourceRange.start ?? -1,
        indent: prefix.length - prefix.trimStart().length,
        ordinal: /^\d/.test(marker[1]) ? Number.parseInt(marker[1]) : 1,
        kind:
          marker[2] !== undefined
            ? 'taskList'
            : field(owner, 'listStart', true) === 'unordered'
              ? 'bulletList'
              : 'orderedList',
        marker: /^\d/.test(marker[1]) ? marker[1].slice(-1) : marker[1],
        prefix,
        group: owner.sourceRange.start,
      } satisfies ListItem;
    });
  return new SourceProjection(window.text, window.range.start, context);
}
