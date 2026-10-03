import { tableInlineSourcePatch } from './table-inline-source';
import type { JSONContent } from '@tiptap/core';
import { DOMSerializer, Fragment, Mark, type Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { ReplaceStep, type Step, type Transform } from '@tiptap/pm/transform';
import { processHTMLToMarkdown } from '$lib/utils/markdown-processor';
import type { SourceProjection } from './source-projection';
import type { Splice, TablePoint, Selection } from './source-journal';
import { scanTables, tableRunNode, type TableWindow, type TableFragment } from './table-source';
import type { TableCodeEdit } from './table-code';
import type { TableInlineWrite, TableParagraphWrite } from './table-state';

const size = (node: JSONContent): number =>
  node.type === 'text'
    ? node.text!.length
    : node.type === 'hardBreak' || node.type === 'commentAnchor'
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
  | {
      kind: 'merge';
      row: number;
      column: number;
      width: number;
      height: number;
      node: JSONContent;
      source: string;
    }
  | {
      kind: 'split';
      row: number;
      column: number;
      width: number;
      height: number;
      nodes: JSONContent[];
    };

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
    paragraphs?: TableParagraphWrite;
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
        for (
          let next = rowIndex < 0 ? (window.extent?.row ?? cell.row) : rowIndex + 1;
          next <= cell.row;
          next++
        ) {
          if (table.content!.length) rowPM += size(table.content!.at(-1)!);
          row = { type: 'tableRow', content: [] };
          table.content!.push(row);
          rowIndex = next;
        }
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
          inline.push(tableRunNode(run));
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
        attrs: {
          ...(cell.attrs ?? { colspan: 1, rowspan: 1, colwidth: null, align: cell.align }),
          ...cell.mounted,
        },
        content: paragraphs,
      };
      row!.content!.push(node);
      this.boundaries.set(pm, cell.last);
      this.boundaries.set(cellPM + size(node), cell.end);
      this.entries.push({ cell, pm: cellPM, paragraph: cellPM + 1, end: pm });
      cellPM += size(node);
    }
    if (window.extent)
      for (let r = rowIndex + 1; r < window.extent.row + window.extent.rowCount; r++)
        table.content!.push({ type: 'tableRow', content: [] });
    // Fresh canonical tables have no placeholder. Native live transactions may
    // add one; revisioned session context carries that source-less structure.
    if (window.trailing !== false) this.content.content!.push({ type: 'paragraph' });
    this.boundaries.set(size(table) - 1, window.cells.at(-1)!.end);
    this.boundaries.set(size(table), window.cells.at(-1)!.end);
    this.boundaries.set(size(table) + 1, window.cells.at(-1)!.end);
    if (window.trailing !== false) this.boundaries.set(size(table) + 2, window.cells.at(-1)!.end);
  }
  restoreSelection(doc: PMNode, selection: Selection) {
    const logical = selection.table;
    if (logical?.kind === 'cell') {
      const anchor = this.entries.find((e) => e.cell.from === logical.anchor.cell),
        head = this.entries.find((e) => e.cell.from === logical.head.cell);
      if (anchor && head) return CellSelection.create(doc, anchor.pm, head.pm);
      const rectangle = this.window.selected;
      if (rectangle?.anchor === logical.anchor.cell && rectangle.head === logical.head.cell) {
        const visible = this.entries.filter(
          ({ cell }) =>
            cell.row < rectangle.bottom &&
            cell.row + (cell.mounted?.rowspan ?? 1) > rectangle.top &&
            cell.column < rectangle.right &&
            cell.column + (cell.mounted?.colspan ?? 1) > rectangle.left,
        );
        const ordered = [...visible].sort(
          (a, b) =>
            (a.cell.row - b.cell.row) * (rectangle.backwardRows ? -1 : 1) ||
            (a.cell.column - b.cell.column) * (rectangle.backwardColumns ? -1 : 1),
        );
        if (ordered.length) return CellSelection.create(doc, ordered[0].pm, ordered.at(-1)!.pm);
      }
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
    tr: Transform,
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
      if (
        Number(after.attrs.colspan) < Number(before.attrs.colspan) ||
        Number(after.attrs.rowspan) < Number(before.attrs.rowspan)
      ) {
        const table = tr.doc.firstChild!,
          map = TableMap.get(table);
        const firstRow = this.window.extent?.row ?? this.window.cells[0].row;
        const firstColumn =
          this.window.extent?.column ?? Math.min(...this.window.cells.map((c) => c.column));
        const width = Number(before.attrs.colspan),
          height = Number(before.attrs.rowspan);
        this.structural = {
          kind: 'split',
          row: entry.cell.row,
          column: entry.cell.column,
          width,
          height,
          nodes: Array.from({ length: width * height }, (_, n) =>
            table
              .nodeAt(
                map.map[
                  (entry.cell.row - firstRow + Math.floor(n / width)) * map.width +
                    entry.cell.column -
                    firstColumn +
                    (n % width)
                ],
              )!
              .toJSON(),
          ),
        };
        return [];
      }
      if (
        Number(after.attrs.colspan) > Number(before.attrs.colspan) ||
        Number(after.attrs.rowspan) > Number(before.attrs.rowspan)
      ) {
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
          height: Number(after.attrs.rowspan),
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
      const firstParagraph =
        step instanceof ReplaceStep
          ? this.paragraphs.find(
              (p) => p.cell.from === entry.cell.from && step.from >= p.pm && step.from <= p.end,
            )
          : undefined;
      const lastParagraph =
        step instanceof ReplaceStep
          ? this.paragraphs.find(
              (p) => p.cell.from === entry.cell.from && step.to >= p.pm && step.to <= p.end,
            )
          : undefined;
      const paragraphSlice =
        step instanceof ReplaceStep &&
        step.slice.openStart === 1 &&
        step.slice.openEnd === 1 &&
        step.slice.content.content.every((n) => n.type.name === 'paragraph')
          ? step.slice.content.content.map((n) => n.toJSON())
          : step instanceof ReplaceStep &&
              !step.slice.openStart &&
              !step.slice.openEnd &&
              step.slice.content.content.every((n) => n.isText || n.type.name === 'hardBreak')
            ? [{ type: 'paragraph', content: step.slice.content.content.map((n) => n.toJSON()) }]
            : undefined;
      const paragraphs: TableParagraphWrite | undefined =
        !inline && firstParagraph && lastParagraph && paragraphSlice && step instanceof ReplaceStep
          ? {
              revision: this.window.revision,
              cell: entry.cell.from,
              body: entry.cell.body,
              end: entry.cell.end,
              nodeType: after.type.name,
              attrs: after.attrs,
              block: firstParagraph.block,
              lastBlock: lastParagraph.block,
              from: firstParagraph.offset + step.from - firstParagraph.pm,
              to: lastParagraph.offset + step.to - lastParagraph.pm,
              paragraphs: paragraphSlice,
            }
          : undefined;
      const node = after.toJSON();
      if (entry.cell.owner) {
        // Unchanged mounted dimensions are viewport clips, not native edits to
        // the logical span. Header/inline changes must retain the backing owner.
        node.attrs = { ...node.attrs };
        if (after.attrs.rowspan === before.attrs.rowspan)
          node.attrs.rowspan = entry.cell.owner.rowspan;
        if (after.attrs.colspan === before.attrs.colspan)
          node.attrs.colspan = entry.cell.owner.colspan;
      }
      this.changedCells.push({ cell: entry.cell, node, inline, paragraphs });
      const flatten = (cell: PMNode) => {
        let content = Fragment.empty;
        cell.forEach((p) => {
          content = content.append(p.content);
        });
        return content;
      };
      // Splitting/joining paragraph boundaries changes only session structure.
      // Keep the original Markdown spelling when native inline content is equal.
      if (paragraphs && flatten(before).eq(flatten(after))) continue;
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
        const removed = before.slice(step.from, step.to).content;
        const signatures = new Set(
          [...removed.content, ...step.slice.content.content].map((node) =>
            JSON.stringify(node.marks.map((mark) => mark.toJSON())),
          ),
        );
        // Collapsed single-mark insertion uses native mark affinity below;
        // inherited caret marks need not equal explicitly stored insertion marks.
        const contextMarks =
          step.from === step.to
            ? []
            : [
                before.resolve(step.from).nodeBefore?.marks ?? [],
                before.resolve(step.to).nodeAfter?.marks ?? [],
              ];
        for (const marks of contextMarks)
          signatures.add(JSON.stringify(marks.map((mark) => mark.toJSON())));
        if (signatures.size > 1) return [tableInlineSourcePatch(this, entry.cell, step, before)];
        const literal = step.slice.content.textBetween(0, step.slice.content.size, '');
        // A native caret has one position on both sides of Markdown delimiters.
        // Match the inserted native marks to the right-hand text when possible;
        // otherwise insert at the left-hand source endpoint. An empty replacement
        // must not turn that delimiter gap into a reversed deletion range.
        const affinity =
          step.from === step.to &&
          step.slice.content.firstChild &&
          !Mark.sameSet(
            step.slice.content.firstChild.marks,
            before.resolve(step.from).nodeAfter?.marks ?? [],
          )
            ? -1
            : 1;
        const from = sourceAt(step.from, affinity),
          to = step.from === step.to ? from : sourceAt(step.to, -1);
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
        return [{ from, to, insert }];
      }
    }
    throw new Error(`Table transaction requires structural admission: ${step.toJSON().stepType}`);
  }
}
