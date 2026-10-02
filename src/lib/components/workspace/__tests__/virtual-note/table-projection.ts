import type { JSONContent } from '@tiptap/core';
import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { ReplaceStep, type Step } from '@tiptap/pm/transform';
import { processHTMLToMarkdown } from '$lib/utils/markdown-processor';
import type { SourceProjection } from './source-projection';
import type { Splice, TablePoint, Selection } from './source-journal';
import { scanTables, type TableWindow, type TableFragment } from './table-source';
import type { TableCodeEdit } from './table-code';
import type { TableInlineWrite } from './table-state';

const size = (node: JSONContent): number =>
  node.type === 'text'
    ? node.text!.length
    : node.type === 'hardBreak'
      ? 1
      : 2 + (node.content ?? []).reduce((n, c) => n + size(c), 0);

export type TableStructure =
  | { kind: 'row'; index: number; remove: number; rows: JSONContent[] }
  | {
      kind: 'column';
      index: number;
      remove: number;
      count: number;
      row: number;
      cells: JSONContent[];
    }
  | { kind: 'merge'; row: number; column: number; width: number; node: JSONContent; source: string }
  | { kind: 'split'; row: number; column: number; width: number; nodes: JSONContent[] };

/** Only admitted cells have nodes; logical coordinates remain backing-owned. */
export class TableProjection {
  readonly content: JSONContent = { type: 'doc', content: [] };
  readonly positions = new Map<number, number>();
  readonly ends = new Map<number, number>();
  readonly boundaries = new Map<number, number>();
  readonly tokens: SourceProjection['tokens'] = [];
  readonly entries: Array<{ cell: TableFragment; pm: number; paragraph: number; end: number }> = [];
  readonly paragraphs: Array<{
    cell: TableFragment;
    block: number;
    pm: number;
    end: number;
    offset: number;
  }> = [];
  structural?: TableStructure;
  readonly codeChanges: TableCodeEdit[] = [];
  readonly changedCells: Array<{
    cell: TableFragment;
    node: JSONContent;
    inline?: TableInlineWrite;
  }> = [];
  constructor(readonly window: TableWindow) {
    const table: JSONContent = { type: 'table', content: [] };
    this.content.content!.push(table);
    let rowIndex = -1,
      row: JSONContent,
      rowPM = 1,
      cellPM = 2;
    for (const cell of window.cells) {
      if (cell.row !== rowIndex) {
        if (table.content!.length) rowPM += size(table.content!.at(-1)!);
        row = { type: 'tableRow', content: [] };
        table.content!.push(row);
        rowIndex = cell.row;
        this.boundaries.set(rowPM, cell.from);
        cellPM = rowPM + 1;
      }
      const paragraphs: JSONContent[] = [];
      let pm = cellPM + 2;
      this.boundaries.set(cellPM, cell.body);
      const blockCount = cell.blocks?.length ?? 1;
      for (let part = 0; part < blockCount; part++) {
        const block = cell.blocks?.[part].index ?? 0;
        const inline: JSONContent[] = [];
        const first = pm;
        this.boundaries.set(pm, cell.blocks?.[part].from ?? cell.first);
        for (const run of cell.runs.filter((r) => (r.block ?? 0) === block)) {
          inline.push(
            run.hardBreak
              ? { type: 'hardBreak', marks: run.marks }
              : { type: 'text', text: run.text, marks: run.marks },
          );
          const length = run.hardBreak ? 1 : run.text.length;
          for (let i = 0; i < length; i++) {
            const from = run.to - run.from === length ? run.from + i : run.from;
            const to = run.to - run.from === length ? from + 1 : run.to;
            this.positions.set(pm + i, from);
            this.ends.set(pm + i + 1, to);
            this.tokens.push({
              pm: pm + i,
              from,
              to,
              text: run.text[i],
              raw: cell.raw.slice(from - cell.first, to - cell.first),
              marks: run.marks as SourceProjection['tokens'][number]['marks'],
            });
          }
          pm += length;
        }
        this.boundaries.set(pm, cell.blocks?.[part].to ?? cell.last);
        this.paragraphs.push({
          cell,
          block,
          pm: first,
          end: pm,
          offset: cell.runs.find((r) => (r.block ?? 0) === block)?.offset ?? 0,
        });
        paragraphs.push({ type: 'paragraph', ...(inline.length ? { content: inline } : {}) });
        if (part + 1 < blockCount) pm += 2;
      }
      const node: JSONContent = {
        type: cell.nodeType ?? (cell.row === 0 ? 'tableHeader' : 'tableCell'),
        attrs: cell.attrs ?? { colspan: 1, rowspan: 1, colwidth: null, align: cell.align },
        content: paragraphs,
      };
      row!.content!.push(node);
      this.boundaries.set(pm, cell.last);
      this.boundaries.set(cellPM + size(node), cell.end);
      this.entries.push({ cell, pm: cellPM, paragraph: cellPM + 1, end: pm });
      cellPM += size(node);
    }
    // Match the native editor's source-less terminal placeholder.
    this.content.content!.push({ type: 'paragraph' });
    this.boundaries.set(size(table) - 1, window.cells.at(-1)!.end);
    this.boundaries.set(size(table), window.cells.at(-1)!.end);
    this.boundaries.set(size(table) + 1, window.cells.at(-1)!.end);
  }
  restoreSelection(doc: PMNode, selection: Selection) {
    const logical = selection.table;
    if (logical?.kind === 'cell') {
      const anchor = this.entries.find((e) => e.cell.from === logical.anchor.cell),
        head = this.entries.find((e) => e.cell.from === logical.head.cell);
      if (anchor && head) return CellSelection.create(doc, anchor.pm, head.pm);
    }
    return TextSelection.create(
      doc,
      this.pointPM(logical?.anchor) ?? this.pmAt(selection.anchor, selection.affinity),
      this.pointPM(logical?.head) ?? this.pmAt(selection.head, selection.affinity),
    );
  }
  pointAt(pm: number): TablePoint | undefined {
    const paragraph = this.paragraphs.find((p) => pm >= p.pm && pm <= p.end);
    if (!paragraph) return undefined;
    return {
      cell: paragraph.cell.from,
      block: paragraph.block,
      offset: pm - paragraph.pm + paragraph.offset,
    };
  }
  pointPM(point?: TablePoint) {
    if (!point) return undefined;
    const paragraph = this.paragraphs.find(
      (p) => p.cell.from === point.cell && p.block === point.block,
    );
    return paragraph
      ? Math.max(
          paragraph.pm,
          Math.min(paragraph.end, paragraph.pm + point.offset - paragraph.offset),
        )
      : undefined;
  }
  pmAt(source: number, affinity = 1) {
    const candidates = [
      ...this.positions,
      ...this.ends,
      ...this.paragraphs.map((p) => [p.pm, this.boundaries.get(p.pm)!] as [number, number]),
    ];
    let best = this.entries[0].paragraph + 1,
      distance = Infinity;
    for (const [pm, offset] of candidates) {
      const d = Math.abs(offset - source);
      if (d < distance || (d === distance && (affinity > 0 ? pm > best : pm < best))) {
        distance = d;
        best = pm;
      }
    }
    return best;
  }
  sourceAt(pm: number, affinity = 1) {
    const exact =
      (affinity < 0 ? this.ends.get(pm) : this.positions.get(pm)) ??
      this.boundaries.get(pm) ??
      this.ends.get(pm);
    if (exact !== undefined) return exact;
    const entry = this.entries.find((e) => pm >= e.pm && pm <= e.end + 2);
    if (!entry) throw new Error(`No table cell provenance at ${pm}`);
    let distance = Infinity,
      source = entry.cell.first;
    for (const [pos, value] of [...this.positions, ...this.ends, ...this.boundaries]) {
      if (pos < entry.paragraph + 1 || pos > entry.end) continue;
      const delta = Math.abs(pos - pm);
      if (delta < distance || (delta === distance && affinity > 0)) {
        distance = delta;
        source = value;
      }
    }
    return source;
  }
  translateTransaction(
    tr: Transaction,
    sourceAt: (pm: number, affinity?: number) => number,
  ): Splice[] {
    this.changedCells.length = 0;
    this.codeChanges.length = 0;
    this.structural = undefined;
    const beforeTable = tr.before.firstChild!,
      afterTable = tr.doc.firstChild!;
    if (
      beforeTable.type.name === 'table' &&
      afterTable.type.name === 'table' &&
      beforeTable.childCount !== afterTable.childCount
    ) {
      let first = 0;
      while (
        first < Math.min(beforeTable.childCount, afterTable.childCount) &&
        beforeTable.child(first).eq(afterTable.child(first))
      )
        first++;
      let suffix = 0;
      while (
        suffix < Math.min(beforeTable.childCount, afterTable.childCount) - first &&
        beforeTable
          .child(beforeTable.childCount - 1 - suffix)
          .eq(afterTable.child(afterTable.childCount - 1 - suffix))
      )
        suffix++;
      this.structural = {
        kind: 'row',
        index: this.window.cells[0].row + first,
        remove: beforeTable.childCount - first - suffix,
        rows: Array.from({ length: afterTable.childCount - first - suffix }, (_, i) =>
          afterTable.child(first + i).toJSON(),
        ),
      };
      return [];
    }
    if (
      beforeTable.type.name === 'table' &&
      afterTable.type.name === 'table' &&
      beforeTable.firstChild!.childCount !== afterTable.firstChild!.childCount &&
      Array.from(
        { length: beforeTable.childCount },
        (_, r) => afterTable.child(r).childCount - beforeTable.child(r).childCount,
      ).every((n) => n === afterTable.firstChild!.childCount - beforeTable.firstChild!.childCount)
    ) {
      const beforeRow = beforeTable.firstChild!,
        afterRow = afterTable.firstChild!;
      let first = 0;
      while (
        first < Math.min(beforeRow.childCount, afterRow.childCount) &&
        beforeRow.child(first).eq(afterRow.child(first))
      )
        first++;
      const count = Math.max(0, afterRow.childCount - beforeRow.childCount),
        remove = Math.max(0, beforeRow.childCount - afterRow.childCount);
      this.structural = {
        kind: 'column',
        index: Math.min(...this.window.cells.map((c) => c.column)) + first,
        remove,
        count,
        row: this.window.cells[0].row,
        cells: count
          ? Array.from({ length: afterTable.childCount }, (_, r) =>
              afterTable.child(r).child(first).toJSON(),
            )
          : [],
      };
      return [];
    }
    const splices: Splice[] = [];
    for (const entry of this.entries) {
      const before = tr.before.nodeAt(entry.pm)!;
      const after = tr.doc.nodeAt(tr.mapping.map(entry.pm, -1));
      if (!after || !['tableCell', 'tableHeader'].includes(after.type.name))
        throw new Error('Table structural identity requires row/column admission');
      if (Number(after.attrs.colspan) < Number(before.attrs.colspan)) {
        const row = tr.doc.firstChild!.child(entry.cell.row - this.window.cells[0].row);
        const index = this.entries
          .filter((e) => e.cell.row === entry.cell.row)
          .findIndex((e) => e.cell.column === entry.cell.column);
        this.structural = {
          kind: 'split',
          row: entry.cell.row,
          column: entry.cell.column,
          width: Number(before.attrs.colspan),
          nodes: Array.from({ length: Number(before.attrs.colspan) }, (_, i) =>
            row.child(index + i).toJSON(),
          ),
        };
        return [];
      }
      if (Number(after.attrs.colspan) > Number(before.attrs.colspan)) {
        const container = document.createElement('div');
        container.append(DOMSerializer.fromSchema(after.type.schema).serializeNode(after));
        const markdown = processHTMLToMarkdown(
          `<table><tr>${container.innerHTML}</tr></table>`,
        ).trim();
        const cell = scanTables(markdown)[0].rows[0].cells[0];
        this.structural = {
          kind: 'merge',
          row: entry.cell.row,
          column: entry.cell.column,
          width: Number(after.attrs.colspan),
          node: after.toJSON(),
          source: markdown.slice(cell.body, cell.end),
        };
        return [];
      }
      if (before.eq(after)) continue;
      const step = tr.steps.length === 1 ? tr.steps[0] : undefined;
      const paragraph =
        step instanceof ReplaceStep && !step.slice.openStart && !step.slice.openEnd
          ? this.paragraphs.find(
              (p) => p.cell.from === entry.cell.from && step.from >= p.pm && step.to <= p.end,
            )
          : undefined;
      const inline: TableInlineWrite | undefined =
        paragraph &&
        step instanceof ReplaceStep &&
        step.slice.content.content.every((n) => n.isText)
          ? {
              revision: this.window.revision,
              cell: entry.cell.from,
              body: entry.cell.body,
              end: entry.cell.end,
              nodeType: after.type.name,
              attrs: after.attrs,
              block: paragraph.block,
              from: paragraph.offset + step.from - paragraph.pm,
              to: paragraph.offset + step.to - paragraph.pm,
              content: step.slice.content.content.map((n) => n.toJSON()),
            }
          : undefined;
      this.changedCells.push({ cell: entry.cell, node: after.toJSON(), inline });
      if (
        tr.steps.length === 1 &&
        tr.steps[0] instanceof ReplaceStep &&
        tr.steps[0].slice.content.content.every((n) => n.isText)
      ) {
        splices.push(...this.translate(tr.steps[0], tr.before, sourceAt));
        continue;
      }
      const serialize = (cell: PMNode) => {
        const container = document.createElement('div');
        container.append(DOMSerializer.fromSchema(cell.type.schema).serializeNode(cell));
        const markdown = processHTMLToMarkdown(
          `<table><tr>${container.innerHTML}</tr></table>`,
        ).trim();
        const source = scanTables(markdown)[0].rows[0].cells[0];
        return markdown.slice(source.body, source.end);
      };
      const oldSource = serialize(before),
        newSource = serialize(after);
      if (oldSource !== newSource) {
        if (entry.cell.first !== entry.cell.body || entry.cell.last !== entry.cell.end)
          throw new Error('Partial cell structural write requires backing fragment admission');
        splices.push({ from: entry.cell.body, to: entry.cell.end, insert: newSource });
      }
    }
    return splices.sort((a, b) => b.from - a.from);
  }
  translate(
    step: Step,
    before: PMNode,
    sourceAt: (pm: number, affinity?: number) => number,
  ): Splice[] {
    if (step instanceof ReplaceStep) {
      const entry = this.entries.find((e) => step.from >= e.paragraph + 1 && step.to <= e.end);
      const textOnly = step.slice.content.content.every((n) => n.isText);
      if (entry && textOnly && !step.slice.openStart && !step.slice.openEnd) {
        const literal = step.slice.content.textBetween(0, step.slice.content.size, '');
        const from = sourceAt(step.from),
          to = sourceAt(step.to, -1);
        const code = entry.cell.runs.find(
          (r) => r.code && from >= r.code.from && to <= r.code.to,
        )?.code;
        if (code) {
          this.codeChanges.push({ from, to, insert: literal, code });
          return [];
        }
        const insert = step.slice.content
          .textBetween(0, step.slice.content.size, '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\[/g, '&#91;')
          .replace(/\]/g, '&#93;')
          .replace(/[\\`*_~|]/g, '\\$&');
        return [{ from: sourceAt(step.from), to: sourceAt(step.to, -1), insert }];
      }
    }
    throw new Error(`Table transaction requires structural admission: ${step.toJSON().stepType}`);
  }
}
