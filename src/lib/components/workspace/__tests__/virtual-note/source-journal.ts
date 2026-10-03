import { mapListCode, touchesListCode, validListCode, type ListCode } from './list-code';
import {
  validParagraphSeam,
  mapParagraphSeam,
  touchesParagraphSeam,
  type ParagraphSeam,
} from './paragraph-seam';
import { planTableTextPaste } from './table-text-paste-plan';
import type { TableCommandName } from './table-native-command';
import { planTablePaste } from './table-paste-plan';
import {
  ClipboardBacking,
  CellSerializationWork,
  ExternalClipboardSink,
  serializeTableClipboard,
  parseTableClipboard,
  clipboardCellSource,
  fitCellTextPaste,
  type ClipboardValue,
} from './table-clipboard';
import type { Schema } from '@tiptap/pm/model';
import { encodeTablePages, TABLE_ACTIVE_BYTES } from './table-transfer';
import { TableHeights } from './table-heights';
import { cloneTableWindow, packTableWindow } from './table-payload';
/** Test-only backing store. Its Maps model disk/server state, NOT renderer caches. */
import { bytes } from './bounded-note-service';
import { SourceProjection, type InlineContext } from './source-projection';
import { scanFences, type Fence } from './fence-context';
import { scanLists, type ListItem, type ListSeam } from './list-context';
import {
  scanTables,
  tableCellAt,
  tableRuns,
  admitTableWindow,
  type TableIndex,
  type TableWindow,
  type TableFragment,
  type TableRectangle,
} from './table-source';
import type { Editor, JSONContent } from '@tiptap/core';
import {
  patchTableCell,
  patchTableInline,
  patchTableParagraphs,
  type TableInlineWrite,
  type TableParagraphWrite,
} from './table-state';
import type { TableStructure } from './table-projection';
import { tableCodeChanges, type TableCodeEdit } from './table-code';
export const LIMITS = {
  request: 4096,
  active: 16384,
  cachePages: 4,
  nodes: 256,
  journalPage: 4096,
  journalResident: 16384,
  log: 32,
  receipts: 32,
};
export const fixture = (id: number) =>
  `Region ${String(id).padStart(4, '0')} — café 🌍. repeated repeated [link](https://example.test).\n\n`;
export type TablePoint = { cell: number; block: number; offset: number };
export type Selection = {
  anchor: number;
  head: number;
  affinity: -1 | 1;
  revision: number;
  table?: { anchor: TablePoint; head: TablePoint; kind: 'text' | 'cell' };
};
export type DeferredInput = {
  command: string;
  time: number;
  selection?: Selection;
  text?: string;
};
export type Splice = { from: number; to: number; insert: string };
export type Change = Splice & {
  removed: string;
  seam?: { before: ListSeam | null; after: ListSeam | null };
  tableState?: string;
  listCode?: { before: ListCode | null; after: ListCode | null };
  paragraphSeam?: { before: ParagraphSeam | null; after: ParagraphSeam | null };
};
export type Anchor = {
  id: string;
  from: number;
  to: number;
  alive: boolean;
  kind?: 'comment' | 'attribution';
  sourceRevision?: number;
  authorId?: string;
};
export type AnnotationRange = { from: number; to: number };
export type AnnotationCursor = {
  owner: number;
  from: number;
  to: number;
  revision: number;
  generation: number;
  commentRevision: number;
  offset: number;
  ranges?: AnnotationRange[];
};
export type AnnotationPage = {
  revision: number;
  generation: number;
  commentRevision: number;
  items: Anchor[];
  next?: AnnotationCursor;
};
let annotationOwner = 0;
export type Event = {
  changes: Change[];
  before: Selection;
  after: Selection;
  anchorsBefore: Anchor[];
  anchorsAfter: Anchor[];
};
export const mapPoint = (p: number, s: Splice, affinity = 1) =>
  p < s.from || (p === s.from && affinity < 0)
    ? p
    : p > s.to || (p === s.to && affinity > 0)
      ? p + s.insert.length - (s.to - s.from)
      : s.from + (affinity < 0 ? 0 : s.insert.length);
export const mapSelection = (r: Selection, s: Splice, revision: number): Selection => ({
  ...r,
  anchor: mapPoint(r.anchor, s, r.affinity),
  head: mapPoint(r.head, s, r.affinity),
  revision,
  ...(r.table
    ? {
        table: {
          ...r.table,
          anchor: { ...r.table.anchor, cell: mapPoint(r.table.anchor.cell, s, -1) },
          head: { ...r.table.head, cell: mapPoint(r.table.head.cell, s, -1) },
        },
      }
    : {}),
});

export class SourceJournal {
  readonly clipboardBacking = new ClipboardBacking();
  readonly clipboardSink = new ExternalClipboardSink();
  readonly clipboardInput = new ClipboardBacking();
  readonly clipboardInputSink = new ExternalClipboardSink();
  readonly clipboardCellSerialization = new CellSerializationWork();
  maxClipboardInputDOM = 0;
  maxClipboardInputNodes = 0;
  maxClipboardRepeatedBytes = 0;
  maxClipboardTextFitNodes = 0;
  maxClipboardTextFitBytes = 0;
  maxClipboardTextFitDOM = 0;
  maxClipboardRangeFitNodes = 0;
  maxClipboardRangeFitBytes = 0;
  maxClipboardRangePlanBytes = 0;
  maxClipboardPastePlanBytes = 0;
  maxClipboardPastePlanCells = 0;
  maxClipboardPasteMetadataBytes = 0;
  maxClipboardPasteSourceBytes = 0;
  openClipboardInput(value: ClipboardValue) {
    return this.clipboardInput.open(this.revision, {
      value,
      costs: { selectedSourceBytes: 0, nodes: 0, elements: 0, serializedPMBytes: 0 },
    });
  }
  stageTablePaste(selection: Selection, publication: number, editor: Editor) {
    const schema = editor.schema;
    const encoded = JSON.stringify({ selection, publication });
    if (bytes(encoded) > LIMITS.request) throw new Error('Clipboard paste intent exceeds budget');
    const received = JSON.parse(encoded) as { selection: Selection; publication: number };
    if (
      received.selection.revision !== this.revision ||
      !received.selection.table ||
      this.clipboardInputSink.lastPublication?.id !== received.publication ||
      this.clipboardInputSink.lastPublication.revision !== this.revision
    )
      throw new Error('Stale or incomplete clipboard input');
    const logical = received.selection.table;
    const { id, start } = this.locate(logical.anchor.cell),
      source = this.region(id);
    const table = this.tableIndex(source, start).find(
      (t) => logical.anchor.cell - start >= t.from && logical.anchor.cell - start < t.to,
    )!;
    const all = table.rows.flatMap((row) => row.cells);
    const anchor = all.find((cell) => cell.from + start === logical.anchor.cell)!,
      head = all.find((cell) => cell.from + start === logical.head.cell)!;
    const textSelection = logical.kind === 'text';
    const top = textSelection ? head.row : Math.min(anchor.row, head.row),
      left = textSelection ? head.column : Math.min(anchor.column, head.column);
    let bottom = Math.max(anchor.row + (anchor.rowSpan ?? 1), head.row + (head.rowSpan ?? 1)),
      right = Math.max(anchor.column + (anchor.span ?? 1), head.column + (head.span ?? 1));
    const parsed = parseTableClipboard(
      this.clipboardInputSink.published,
      schema,
      textSelection ? undefined : right - left,
      textSelection ? undefined : bottom - top,
    );
    this.maxClipboardInputDOM = Math.max(this.maxClipboardInputDOM, parsed.costs.elements);
    this.maxClipboardInputNodes = Math.max(this.maxClipboardInputNodes, parsed.costs.nodes);
    this.maxClipboardRepeatedBytes = Math.max(
      this.maxClipboardRepeatedBytes,
      parsed.costs.repeatedBytes,
    );
    if (textSelection && !parsed.tableInput) {
      if (anchor.from !== head.from) {
        const plan = planTableTextPaste(
          source,
          start,
          table,
          logical.anchor,
          logical.head,
          this.clipboardInputSink.published,
          editor,
          (from) => {
            const value = this.tableStates.get(`cell:${from + start}`);
            return value ? JSON.parse(value) : undefined;
          },
          this.clipboardCellSerialization,
        );
        this.maxClipboardRangeFitNodes = Math.max(this.maxClipboardRangeFitNodes, plan.costs.nodes);
        this.maxClipboardRangeFitBytes = Math.max(
          this.maxClipboardRangeFitBytes,
          plan.costs.serializedBytes,
        );
        this.maxClipboardRangePlanBytes = Math.max(
          this.maxClipboardRangePlanBytes,
          plan.costs.planBytes,
        );
        for (const cell of all)
          if (this.tableStates.has(`cell:${cell.from + start}`))
            this.stageTableState(`cell:${cell.from + start}`, '');
        const previous = source.slice(table.from, table.to);
        let prefix = 0,
          suffix = 0;
        while (
          prefix < previous.length &&
          prefix < plan.text.length &&
          previous[prefix] === plan.text[prefix]
        )
          prefix++;
        while (
          suffix < previous.length - prefix &&
          suffix < plan.text.length - prefix &&
          previous[previous.length - suffix - 1] === plan.text[plan.text.length - suffix - 1]
        )
          suffix++;
        this.stage({
          from: table.from + start + prefix,
          to: table.to + start - suffix,
          insert: plan.text.slice(prefix, plan.text.length - suffix),
        });
        for (const cell of plan.states)
          this.stageTableState(`cell:${cell.from}`, JSON.stringify(cell.node));
        const after: Selection = {
          anchor: plan.caret,
          head: plan.caret,
          affinity: 1,
          revision: this.revision,
          table: plan.point && { kind: 'text', anchor: plan.point, head: plan.point },
        };
        this.maxTableWriteBytes = Math.max(this.maxTableWriteBytes, bytes(encoded));
        const response = JSON.stringify(after);
        if (bytes(response) > LIMITS.request)
          throw new Error('Clipboard paste response exceeds budget');
        return JSON.parse(response) as Selection;
      }
      const stored = this.tableStates.get(`cell:${head.from + start}`);
      const cell = schema.nodeFromJSON(
        stored
          ? JSON.parse(stored)
          : {
              type: head.row === 0 ? 'tableHeader' : 'tableCell',
              attrs: { align: head.align, colspan: head.span ?? 1, rowspan: head.rowSpan ?? 1 },
              content: [
                {
                  type: 'paragraph',
                  content: tableRuns(source.slice(head.body, head.end), head.body).map((run) => ({
                    type: run.hardBreak ? 'hardBreak' : 'text',
                    ...(run.hardBreak ? {} : { text: run.text }),
                    marks: run.marks,
                  })),
                },
              ],
            },
      );
      const fitted = fitCellTextPaste(
        cell,
        logical.anchor,
        logical.head,
        this.clipboardInputSink.published,
        editor,
      );
      this.maxClipboardTextFitNodes = Math.max(this.maxClipboardTextFitNodes, fitted.costs.nodes);
      this.maxClipboardTextFitBytes = Math.max(
        this.maxClipboardTextFitBytes,
        fitted.costs.serializedBytes,
      );
      this.maxClipboardTextFitDOM = Math.max(this.maxClipboardTextFitDOM, fitted.costs.elements);
      const inserted = clipboardCellSource(fitted.cell, this.clipboardCellSerialization);
      this.stageTableState(`cell:${head.from + start}`, JSON.stringify(fitted.cell.toJSON()));
      this.stage({ from: head.body + start, to: head.end + start, insert: inserted });
      let offset = fitted.point.offset;
      for (let i = 0; i < fitted.point.block; i++) offset += fitted.cell.child(i).content.size;
      let caret = head.body + inserted.length;
      for (const run of tableRuns(inserted, head.body)) {
        if (offset <= run.text.length) {
          caret =
            run.to - run.from === run.text.length ? run.from + offset : offset ? run.to : run.from;
          break;
        }
        offset -= run.text.length;
      }
      const after: Selection = {
        anchor: caret + start,
        head: caret + start,
        affinity: 1,
        revision: this.revision,
        table: { kind: 'text', anchor: fitted.point, head: fitted.point },
      };
      this.maxTableWriteBytes = Math.max(this.maxTableWriteBytes, bytes(encoded));
      const response = JSON.stringify(after);
      if (bytes(response) > LIMITS.request)
        throw new Error('Clipboard paste response exceeds budget');
      return JSON.parse(response) as Selection;
    }
    if (textSelection) {
      bottom = top + parsed.cells.height;
      right = left + parsed.cells.width;
    }
    const selected = all.filter(
      (cell) => cell.row >= top && cell.row < bottom && cell.column >= left && cell.column < right,
    );
    const hasSpans =
      textSelection ||
      selected.some((cell) => (cell.span ?? 1) !== 1 || (cell.rowSpan ?? 1) !== 1) ||
      selected.length !== (bottom - top) * (right - left) ||
      parsed.cells.rows.some((row) => {
        let span = false;
        row.forEach((cell) => {
          span ||= cell.attrs.colspan !== 1 || cell.attrs.rowspan !== 1;
        });
        return span;
      });
    if (hasSpans) {
      const plan = planTablePaste(
        source,
        table,
        { top, bottom, left, right },
        parsed.cells,
        schema,
        (from) => {
          const value = this.tableStates.get(`cell:${from + start}`);
          return value ? JSON.parse(value) : undefined;
        },
        this.clipboardCellSerialization,
      );
      this.maxClipboardPastePlanBytes = Math.max(
        this.maxClipboardPastePlanBytes,
        plan.costs.planBytes,
      );
      this.maxClipboardPastePlanCells = Math.max(this.maxClipboardPastePlanCells, plan.costs.cells);
      this.maxClipboardPasteMetadataBytes = Math.max(
        this.maxClipboardPasteMetadataBytes,
        plan.costs.metadataBytes,
      );
      this.maxClipboardPasteSourceBytes = Math.max(
        this.maxClipboardPasteSourceBytes,
        plan.costs.sourceBytes,
      );
      for (const row of plan.rows.slice().sort((a, b) => b.from - a.from || b.index - a.index)) {
        for (const cell of table.rows[row.index]?.cells ?? [])
          if (this.tableStates.has(`cell:${cell.from + start}`))
            this.stageTableState(`cell:${cell.from + start}`, '');
        const previous = source.slice(row.from, row.to);
        let prefix = 0,
          suffix = 0;
        while (
          prefix < previous.length &&
          prefix < row.text.length &&
          previous[prefix] === row.text[prefix]
        )
          prefix++;
        while (
          suffix < previous.length - prefix &&
          suffix < row.text.length - prefix &&
          previous[previous.length - suffix - 1] === row.text[row.text.length - suffix - 1]
        )
          suffix++;
        if (prefix !== previous.length || prefix !== row.text.length)
          this.stage({
            from: start + row.from + prefix,
            to: start + row.to - suffix,
            insert: row.text.slice(prefix, row.text.length - suffix),
          });
        for (const state of row.states)
          this.stageTableState(
            `cell:${start + row.from + state.offset}`,
            JSON.stringify(state.node),
          );
      }
    } else {
      for (const cell of selected.sort((a, b) => b.from - a.from)) {
        const replacement = parsed.cells.rows[cell.row - top].child(cell.column - left);
        this.stageTableState(`cell:${cell.from + start}`, JSON.stringify(replacement.toJSON()));
        this.stage({
          from: cell.body + start,
          to: cell.end + start,
          insert: clipboardCellSource(replacement, this.clipboardCellSerialization),
        });
      }
    }
    this.maxTableWriteBytes = Math.max(this.maxTableWriteBytes, bytes(encoded));
    const updated = this.tableIndex(this.region(id), start).find((t) => t.from === table.from)!;
    const first = tableCellAt(updated, top, left),
      last = tableCellAt(updated, bottom - 1, right - 1);
    const after: Selection = {
      anchor: first.body + start,
      head: last.body + start,
      affinity: 1,
      revision: this.revision,
      table: {
        kind: 'cell',
        anchor: { cell: first.from + start, block: 0, offset: 0 },
        head: { cell: last.from + start, block: 0, offset: 0 },
      },
    };
    const response = JSON.stringify(after);
    if (bytes(response) > LIMITS.request)
      throw new Error('Clipboard paste response exceeds budget');
    return JSON.parse(response) as Selection;
  }
  openTableClipboard(selection: Selection, schema: Schema) {
    const request = JSON.stringify(selection);
    if (bytes(request) > LIMITS.request) throw new Error('Clipboard intent exceeds budget');
    const received = JSON.parse(request) as Selection;
    if (received.revision !== this.revision || received.table?.kind !== 'cell')
      throw new Error('Stale clipboard request');
    const { id, start } = this.locate(received.table.anchor.cell),
      source = this.region(id);
    const table = this.tableIndex(source, start).find(
      (t) =>
        received.table!.anchor.cell - start >= t.from && received.table!.anchor.cell - start < t.to,
    );
    if (!table) throw new Error('Clipboard table no longer exists');
    return this.clipboardBacking.open(
      this.revision,
      serializeTableClipboard(source, start, table, received.table, schema, (cell) => {
        const stored = this.tableStates.get(`cell:${cell}`);
        return stored ? JSON.parse(stored) : undefined;
      }),
    );
  }

  maxBackingClipboardMutationBytes = 0;
  stageTableCut(selection: Selection, publication: number, schema: Schema) {
    const encoded = JSON.stringify({ selection, publication });
    if (bytes(encoded) > LIMITS.request) throw new Error('Clipboard cut intent exceeds budget');
    const received = JSON.parse(encoded) as { selection: Selection; publication: number };
    if (
      received.selection.revision !== this.revision ||
      received.selection.table?.kind !== 'cell' ||
      this.clipboardSink.lastPublication?.id !== received.publication ||
      this.clipboardSink.lastPublication.revision !== this.revision
    )
      throw new Error('Stale or unpublished clipboard cut');
    const logical = received.selection.table;
    const { id, start } = this.locate(logical.anchor.cell),
      source = this.region(id);
    const table = this.tableIndex(source, start).find(
      (t) => logical.anchor.cell - start >= t.from && logical.anchor.cell - start < t.to,
    )!;
    const all = table.rows.flatMap((row) => row.cells);
    const anchor = all.find((cell) => cell.from + start === logical.anchor.cell)!,
      head = all.find((cell) => cell.from + start === logical.head.cell)!;
    const top = Math.min(anchor.row, head.row),
      bottom = Math.max(anchor.row + (anchor.rowSpan ?? 1), head.row + (head.rowSpan ?? 1));
    const left = Math.min(anchor.column, head.column),
      right = Math.max(anchor.column + (anchor.span ?? 1), head.column + (head.span ?? 1));
    // Match native cellsInRect: owners beginning outside its top/left boundary are not mutated.
    const selected = all
      .filter(
        (cell) =>
          cell.row >= top && cell.row < bottom && cell.column >= left && cell.column < right,
      )
      .sort((a, b) => b.from - a.from);
    let headFrom = logical.head.cell,
      mutationBytes = 0;
    for (const cell of selected) {
      const stored = this.tableStates.get(`cell:${cell.from + start}`);
      const old = stored
        ? (JSON.parse(stored) as JSONContent)
        : schema.nodes[cell.row === 0 ? 'tableHeader' : 'tableCell']
            .createAndFill({ align: cell.align })!
            .toJSON();
      const node = { ...old, content: [schema.nodes.paragraph.createAndFill()!.toJSON()] };
      mutationBytes += bytes(stored ?? '') + bytes(source.slice(cell.body, cell.end));
      this.stageTableState(`cell:${cell.from + start}`, JSON.stringify(node));
      const splice = { from: cell.body + start, to: cell.end + start, insert: '' };
      this.stage(splice);
      headFrom = mapPoint(headFrom, splice, -1);
    }
    this.maxTableWriteBytes = Math.max(this.maxTableWriteBytes, bytes(encoded));
    this.maxBackingClipboardMutationBytes = Math.max(
      this.maxBackingClipboardMutationBytes,
      mutationBytes,
    );
    const updated = this.tableIndex(this.region(id), start).find(
      (t) => t.from + start === table.from + start,
    )!;
    const last = updated.rows
      .flatMap((row) => row.cells)
      .find((cell) => cell.from + start === headFrom)!;
    const after: Selection = {
      anchor: last.body + start,
      head: last.body + start,
      affinity: 1,
      revision: this.revision,
      table: {
        kind: 'text',
        anchor: { cell: headFrom, block: 0, offset: 0 },
        head: { cell: headFrom, block: 0, offset: 0 },
      },
    };
    const response = JSON.stringify(after);
    if (bytes(response) > LIMITS.request) throw new Error('Clipboard cut response exceeds budget');
    this.log('table-clipboard-cut', logical.anchor.cell, bytes(encoded));
    return JSON.parse(response) as Selection;
  }

  // These serialized blobs model backing-store records, never renderer caches.
  private tableStates = new Map<string, string>();
  private applyTableState(change: Splice & { tableState: string }) {
    const prior = this.tableStates.get(change.tableState) ?? '';
    if (change.to > prior.length) throw new Error('Invalid table metadata range');
    const states = new Map(this.tableStates);
    const next = prior.slice(0, change.from) + change.insert + prior.slice(change.to);
    if (next) states.set(change.tableState, next);
    else states.delete(change.tableState);
    this.tableStates = states;
    const previousRevision = this.revision;
    this.revision++;
    if (change.tableState.startsWith('tail:'))
      this.tableHeights.retainUnchangedTable(Number(change.tableState.slice(5)), previousRevision);
  }
  private stageTableState(key: string, value: string, history = true) {
    if (!this.atomicDepth) throw new Error('Table source and metadata require atomic admission');
    const removed = this.tableStates.get(key) ?? '';
    const pages = this.pages({
      from: 0,
      to: removed.length,
      insert: value,
      removed,
      tableState: key,
    });
    for (const encoded of pages) {
      const change: Change = JSON.parse(encoded);
      this.applyTableState(change as Change & { tableState: string });
      if (history) this.stagedPages.push(encoded);
    }
  }
  stageTableTrailing(table: number, trailing: boolean, revision: number, history = true) {
    if (revision !== this.revision) throw new Error('Stale table trailing state');
    const { id, start } = this.locate(table);
    if (!this.tableIndex(this.region(id), start).some((t) => t.from + start === table))
      throw new Error('Missing table trailing owner');
    const key = `tail:${table}`,
      value = trailing ? '1' : '';
    if ((this.tableStates.get(key) ?? '') !== value) this.stageTableState(key, value, history);
    const response = JSON.stringify({ table, revision: this.revision, trailing });
    if (bytes(response) > LIMITS.request) throw new Error('Table trailing response exceeds budget');
    this.maxTableWriteBytes = Math.max(this.maxTableWriteBytes, bytes(response));
    this.log('table-trailing-response', table, bytes(response));
    return JSON.parse(response) as { table: number; revision: number; trailing: boolean };
  }
  maxTableWriteBytes = 0;
  stageTableInline(edit: TableInlineWrite, history = true) {
    if (edit.revision !== this.revision) throw new Error('Stale table inline write');
    const encoded = JSON.stringify(edit),
      payload = bytes(encoded);
    if (payload > LIMITS.request) throw new Error('Table inline write exceeds budget');
    this.maxTableWriteBytes = Math.max(this.maxTableWriteBytes, payload);
    // Decode the actual request at the mock backing boundary. Full cell reconstruction
    // below belongs to the backing store, not renderer or transport residency.
    const received: TableInlineWrite = JSON.parse(encoded);
    const prior = this.tableStates.get(`cell:${received.cell}`);
    const merged = patchTableInline(
      this.slice(received.body, received.end),
      prior ? JSON.parse(prior) : undefined,
      received,
    );
    this.stageTableState(`cell:${received.cell}`, JSON.stringify(merged), history);
    this.log('table-inline-write', received.cell, payload);
  }
  maxTableParagraphTransientBytes = 0;
  stageTableParagraphs(edit: TableParagraphWrite, history = true) {
    if (edit.revision !== this.revision) throw new Error('Stale table paragraph write');
    const encoded = JSON.stringify(edit),
      payload = bytes(encoded);
    if (payload > LIMITS.request) throw new Error('Table paragraph write exceeds budget');
    this.maxTableWriteBytes = Math.max(this.maxTableWriteBytes, payload);
    // Serialized-size accounting for caller object + encoded request + decoded
    // backing request, NOT a JavaScript heap measurement.
    this.maxTableParagraphTransientBytes = Math.max(
      this.maxTableParagraphTransientBytes,
      payload * 3,
    );
    const received: TableParagraphWrite = JSON.parse(encoded);
    const prior = this.tableStates.get(`cell:${received.cell}`);
    const merged = patchTableParagraphs(
      this.slice(received.body, received.end),
      prior ? JSON.parse(prior) : undefined,
      received,
    );
    this.stageTableState(`cell:${received.cell}`, JSON.stringify(merged), history);
    this.log('table-paragraph-write', received.cell, payload);
  }
  stageTableCell(fragment: TableFragment, node: JSONContent, history = true) {
    const payload = bytes(JSON.stringify({ fragment, node }));
    if (payload > LIMITS.request) throw new Error('Table fragment write exceeds budget');
    this.maxTableWriteBytes = Math.max(this.maxTableWriteBytes, payload);
    const prior = this.tableStates.get(`cell:${fragment.from}`);
    const merged =
      fragment.first === fragment.body &&
      fragment.last === fragment.end &&
      (!fragment.blocks ||
        (fragment.blocks[0].index === 0 && fragment.blocks.length === fragment.blockCount))
        ? node
        : patchTableCell(
            this.slice(fragment.body, fragment.end),
            fragment,
            prior ? JSON.parse(prior) : undefined,
            node,
          );
    this.stageTableState(`cell:${fragment.from}`, JSON.stringify(merged), history);
    this.log('table-fragment-write', fragment.from, payload);
  }
  private mapTableKey(key: string, splice: Splice) {
    const affinity = key.startsWith('tail:') && splice.from === splice.to ? 1 : -1;
    return `${key.slice(0, 5)}${mapPoint(Number(key.slice(5)), splice, affinity)}`;
  }
  stageTableStructure(window: TableWindow, edit: TableStructure, history = true) {
    if (edit.kind === 'split') return this.stageTableSplit(window, edit, history);
    if (edit.kind === 'merge') return this.stageTableMerge(window, edit, history);
    if (edit.kind === 'column') return this.stageTableColumns(window, edit, history);
    if (window.revision !== this.revision) throw new Error('Stale table structural transaction');
    if (bytes(JSON.stringify(edit)) > LIMITS.request)
      throw new Error('Table structural request exceeds budget');
    const { id, start } = this.locate(window.from);
    const source = this.region(id),
      table = this.tableIndex(source, start).find((t) => t.from + start === window.from)!;
    if (edit.index === 0) throw new Error('Header row structural admission is not implemented');
    const from = start + (table.rows[edit.index]?.from ?? table.to);
    const to = edit.remove ? start + table.rows[edit.index + edit.remove - 1].to : from;
    for (const key of this.tableStates.keys()) {
      if (!key.startsWith('cell:')) continue;
      const at = Number(key.slice(5));
      if (at >= from && at < to) this.stageTableState(key, '', history);
    }
    const rowText = '| ' + Array(table.columns).fill('').join(' | ') + ' |';
    const prefix = edit.rows.length && from > 0 && this.slice(from - 1, from) !== '\n' ? '\n' : '';
    const insert =
      prefix +
      edit.rows.map(() => rowText).join('\n') +
      (edit.rows.length && to < this.length ? '\n' : '');
    const splice = { from, to, insert };
    this.stage(splice, history);
    const updated = this.tableIndex(this.region(id), start).find(
      (t) => t.from + start === window.from,
    )!;
    const column = Math.min(...window.cells.map((c) => c.column));
    for (let r = 0; r < edit.rows.length; r++)
      for (const cell of updated.rows[edit.index + r].cells) {
        const native = edit.rows[r].content?.[cell.column - column] ?? {
          ...edit.rows[r].content![0],
          content: [{ type: 'paragraph' }],
        };
        this.stageTableState(`cell:${cell.from + start}`, JSON.stringify(native), history);
      }
    const retained = cloneTableWindow(window);
    retained.cells = retained.cells
      .filter((c) => c.row < edit.index || c.row >= edit.index + edit.remove)
      .map((c) => ({
        ...c,
        row: c.row >= edit.index ? c.row + edit.rows.length - edit.remove : c.row,
        first: mapPoint(c.first, splice, -1),
        last: mapPoint(c.last, splice, 1),
      }));
    const columns = [...new Set(window.cells.map((c) => c.column))];
    for (let r = 0; r < edit.rows.length; r++)
      for (const column of columns) {
        const cell = updated.rows[edit.index + r].cells[column];
        retained.cells.push({
          ...cell,
          from: cell.from + start,
          to: cell.to + start,
          body: cell.body + start,
          end: cell.end + start,
          first: cell.body + start,
          last: cell.end + start,
          raw: '',
          runs: [],
        });
      }
    retained.cells.sort((a, b) => a.row - b.row || a.column - b.column);
    return this.tableWindow(retained.cells[0].first, retained)!;
  }
  private stageTableColumns(
    window: TableWindow,
    edit: Extract<TableStructure, { kind: 'column' }>,
    history: boolean,
  ) {
    if (window.revision !== this.revision) throw new Error('Stale table column transaction');
    if (bytes(JSON.stringify(edit)) > LIMITS.request)
      throw new Error('Table column request exceeds budget');
    const { id, start } = this.locate(window.from),
      table = this.tableIndex(this.region(id), start).find((t) => t.from + start === window.from)!;
    const splices: Splice[] = [];
    const moved: Array<{ from: number; value: string }> = [];
    for (const row of [...table.rows, table.delimiter]) {
      const delimiter = row === table.delimiter;
      const cell = row.cells[Math.min(edit.index, row.cells.length - 1)];
      if (edit.remove) {
        const from = cell.from - (edit.index === row.cells.length - 1 ? 1 : 0) + start;
        const to = (row.cells[edit.index + edit.remove]?.from ?? cell.to) + start;
        for (const key of this.tableStates.keys())
          if (key.startsWith('cell:') && Number(key.slice(5)) >= from && Number(key.slice(5)) < to)
            this.stageTableState(key, '', history);
        splices.push({ from, to, insert: '' });
      } else {
        const append = edit.index === row.cells.length;
        const from = (append ? cell.to : cell.from) + start;
        if (!append && this.tableStates.has(`cell:${from}`)) {
          moved.push({ from, value: this.tableStates.get(`cell:${from}`)! });
          this.stageTableState(`cell:${from}`, '', history);
        }
        splices.push({
          from,
          to: from,
          insert: append ? (delimiter ? '| --- ' : '|  ') : delimiter ? ' --- |' : '  |',
        });
      }
    }
    splices.sort((a, b) => b.from - a.from);
    for (const splice of splices) this.stage(splice, history);
    for (const item of moved) {
      let at = item.from;
      for (const splice of splices) at = mapPoint(at, splice, 1);
      this.stageTableState(`cell:${at}`, item.value, history);
    }
    const updated = this.tableIndex(this.region(id), start).find(
      (t) => t.from + start === window.from,
    )!;
    if (edit.count)
      for (const row of updated.rows) {
        const native = edit.cells[row.cells[0].row - edit.row] ?? {
          type: row.cells[0].row === 0 ? 'tableHeader' : 'tableCell',
          attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null },
          content: [{ type: 'paragraph' }],
        };
        this.stageTableState(
          `cell:${row.cells[edit.index].from + start}`,
          JSON.stringify(native),
          history,
        );
      }
    const retained = cloneTableWindow(window);
    retained.cells = retained.cells
      .filter((c) => c.column < edit.index || c.column >= edit.index + edit.remove)
      .map((c) => {
        for (const splice of splices) {
          c.first = mapPoint(c.first, splice, -1);
          c.last = mapPoint(c.last, splice, 1);
        }
        c.column += c.column >= edit.index ? edit.count - edit.remove : 0;
        return c;
      });
    if (edit.count)
      for (const row of new Set(window.cells.map((c) => c.row))) {
        const cell = updated.rows[row].cells[edit.index];
        retained.cells.push({
          ...cell,
          from: cell.from + start,
          to: cell.to + start,
          body: cell.body + start,
          end: cell.end + start,
          first: cell.body + start,
          last: cell.end + start,
          raw: '',
          runs: [],
        });
      }
    retained.cells.sort((a, b) => a.row - b.row || a.column - b.column);
    return this.tableWindow(retained.cells[0].first, retained)!;
  }
  tableCodePatches(edits: TableCodeEdit[]) {
    const changes = edits.flatMap((edit) =>
      tableCodeChanges(this.slice(edit.code.from, edit.code.to), edit),
    );
    if (bytes(JSON.stringify(changes)) > LIMITS.request)
      throw new Error('Table code patches exceed admission budget');
    return changes.sort((a, b) => b.from - a.from);
  }
  tableAddress(from: number, row: number, column: number) {
    const { id, start } = this.locate(from),
      table = this.tableIndex(this.region(id), start).find((t) => t.from + start === from)!;
    const cell = tableCellAt(table, row, column);
    return {
      source: cell.body + start,
      point: { cell: cell.from + start, block: 0, offset: 0 },
      revision: this.revision,
    };
  }
  maxTableStructuralTransientBytes = 0;
  maxBackingTableCommandBytes = 0;
  maxBackingTableCommandNodes = 0;
  /** A revisioned command and logical endpoints, not a cropped native tree.
   * Full native planning and source/session serialization belong to mock backing. */
  stageLogicalTableCommand(
    intent: { revision: number; table: number; command: TableCommandName; selection: Selection },
    editor: Editor,
    apply = true,
    dispatch = true,
  ): Selection | false {
    const encoded = JSON.stringify(intent),
      size = bytes(encoded);
    if (size > LIMITS.request) throw new Error('Table command request exceeds budget');
    const received = JSON.parse(encoded) as typeof intent;
    if (received.revision !== this.revision || received.selection.revision !== this.revision)
      throw new Error('Stale logical table command');
    const logical = received.selection.table;
    if (!logical) throw new Error('Missing logical table selection');
    const { id, start } = this.locate(received.table);
    const source = this.region(id);
    const table = this.tableIndex(source, start).find((t) => t.from + start === received.table);
    if (!table) throw new Error('Logical table no longer exists');
    const plan = planTableTextPaste(
      source,
      start,
      table,
      logical.anchor,
      logical.head,
      { 'text/plain': '', 'text/html': '' },
      editor,
      (from) => {
        const value = this.tableStates.get(`cell:${from + start}`);
        return value ? JSON.parse(value) : undefined;
      },
      this.clipboardCellSerialization,
      { name: received.command, kind: logical.kind, dispatch },
    );
    this.maxBackingTableCommandBytes = Math.max(
      this.maxBackingTableCommandBytes,
      plan.costs.serializedBytes + plan.costs.planBytes,
    );
    this.maxBackingTableCommandNodes = Math.max(this.maxBackingTableCommandNodes, plan.costs.nodes);
    this.maxTableStructuralTransientBytes = Math.max(
      this.maxTableStructuralTransientBytes,
      size * 3,
    );
    if (!plan.accepted) return false;
    const deleting = received.command === 'deleteTable' && !plan.text;
    const left = source.slice(0, table.from),
      right = source.slice(table.to);
    const rightNewline = right.match(/^\r?\n/)?.[0];
    const leftNewline = left.match(/\r?\n$/)?.[0];
    const deletionSeam: ParagraphSeam | undefined =
      deleting && rightNewline
        ? {
            from: table.from + start,
            to: table.from + start + rightNewline.length,
            ...(left ? {} : { kind: 'leading' as const }),
          }
        : deleting && leftNewline && !right
          ? {
              from: table.from + start - leftNewline.length,
              to: table.from + start,
              kind: 'terminal',
            }
          : undefined;
    const deletionCaret = deletionSeam?.to;
    if (apply) {
      if (!plan.text && this.tableStates.has(`tail:${received.table}`))
        this.stageTableState(`tail:${received.table}`, '');
      for (const row of table.rows)
        for (const cell of row.cells)
          if (this.tableStates.has(`cell:${cell.from + start}`))
            this.stageTableState(`cell:${cell.from + start}`, '');
      const previous = source.slice(table.from, table.to);
      let prefix = 0,
        suffix = 0;
      while (
        prefix < previous.length &&
        prefix < plan.text.length &&
        previous[prefix] === plan.text[prefix]
      )
        prefix++;
      while (
        suffix < previous.length - prefix &&
        suffix < plan.text.length - prefix &&
        previous[previous.length - suffix - 1] === plan.text[plan.text.length - suffix - 1]
      )
        suffix++;
      this.stage({
        from: table.from + start + prefix,
        to: table.to + start - suffix,
        insert: plan.text.slice(prefix, plan.text.length - suffix),
      });
      for (const cell of plan.states)
        this.stageTableState(`cell:${cell.from}`, JSON.stringify(cell.node));
      // Keep the native live boundary without rewriting either neighbor's source.
      // The table scan owns its final row newline; the remaining right blank line
      // would otherwise be a newly parsed empty paragraph when joined to the left.
      if (deletionSeam) this.setParagraphSeam(deletionSeam);
    }
    const after: Selection = {
      anchor: deletionCaret ?? plan.anchorSource,
      head: deletionCaret ?? plan.caret,
      affinity: plan.anchorSource <= plan.caret ? 1 : -1,
      revision: this.revision,
      table: plan.logicalSelection,
    };
    const response = JSON.stringify(after);
    if (bytes(response) > LIMITS.request) throw new Error('Table command response exceeds budget');
    this.maxTableWriteBytes = Math.max(this.maxTableWriteBytes, size, bytes(response));
    this.log('table-logical-command', received.table, size);
    return JSON.parse(response) as Selection;
  }
  maxBackingTableSplitCells = 0;
  maxBackingTableSplitBytes = 0;
  /** A bounded command intent; full cell reconstruction stays in mock backing. */
  stageLogicalTableSplit(
    intent: { revision: number; table: number; cell: number },
    history = true,
  ) {
    const encoded = JSON.stringify(intent),
      size = bytes(encoded);
    if (size > LIMITS.request) throw new Error('Table command request exceeds budget');
    const received = JSON.parse(encoded) as typeof intent;
    if (received.revision !== this.revision) throw new Error('Stale logical table command');
    const { id, start } = this.locate(received.table);
    const table = this.tableIndex(this.region(id), start).find(
      (t) => t.from + start === received.table,
    );
    const cell = table?.rows.flatMap((r) => r.cells).find((c) => c.from + start === received.cell);
    const stored = this.tableStates.get(`cell:${received.cell}`);
    if (!table || !cell || !stored) throw new Error('Logical table owner no longer exists');
    const node = JSON.parse(stored) as JSONContent;
    const width = Number(node.attrs!.colspan),
      height = Number(node.attrs!.rowspan);
    if (width * height <= 1) throw new Error('Logical table cell is not merged');
    const colwidth = node.attrs!.colwidth as number[] | null;
    const nodes = Array.from({ length: width * height }, (_, n) => ({
      type: node.type,
      attrs: {
        ...node.attrs,
        colspan: 1,
        rowspan: 1,
        colwidth: colwidth?.[n % width] ? [colwidth[n % width]] : null,
      },
      content: n ? [{ type: 'paragraph' }] : node.content,
    }));
    this.maxTableWriteBytes = Math.max(this.maxTableWriteBytes, size);
    this.maxTableStructuralTransientBytes = Math.max(
      this.maxTableStructuralTransientBytes,
      size * 3,
    );
    this.maxBackingTableSplitCells = Math.max(this.maxBackingTableSplitCells, nodes.length);
    this.maxBackingTableSplitBytes = Math.max(
      this.maxBackingTableSplitBytes,
      bytes(JSON.stringify(nodes)),
    );
    const window = this.tableWindow(cell.body + start)!;
    this.stageTableSplit(
      window,
      { kind: 'split', row: cell.row, column: cell.column, width, height, nodes },
      history,
      true,
    );
    const updated = this.tableIndex(this.region(id), start).find(
      (t) => t.from + start === received.table,
    )!;
    const last = updated.rows[cell.row + height - 1].cells.find(
      (c) => c.column === cell.column + width - 1,
    )!;
    const result = {
      revision: this.revision,
      cell: received.cell,
      last: last.from + start,
      lastSource: last.body + start,
    };
    const response = JSON.stringify(result);
    if (bytes(response) > LIMITS.request) throw new Error('Table command response exceeds budget');
    this.log('table-logical-split', received.cell, size);
    return JSON.parse(response) as typeof result;
  }
  private stageTableSplit(
    window: TableWindow,
    edit: Extract<TableStructure, { kind: 'split' }>,
    history: boolean,
    backingIntent = false,
  ) {
    if (window.revision !== this.revision) throw new Error('Stale table split');
    if (!backingIntent && bytes(JSON.stringify(edit)) > LIMITS.request)
      throw new Error('Table split request exceeds budget');
    const { id, start } = this.locate(window.from),
      table = this.tableIndex(this.region(id), start).find((t) => t.from + start === window.from)!;
    const cell = table.rows[edit.row].cells.find((c) => c.column === edit.column)!;
    const splices: Splice[] = [];
    if (edit.width > 1)
      splices.push({
        from: cell.to + start,
        to: cell.to + start,
        insert: '|  '.repeat(edit.width - 1),
      });
    for (let r = edit.row + 1; r < edit.row + edit.height; r++) {
      const row = table.rows[r],
        next = row.cells.find((c) => c.column >= edit.column);
      if (!row.cells.length) {
        const from = row.from + start;
        const suffix = this.slice(row.to + start - 1, row.to + start) === '\n' ? '\n' : '';
        splices.push({
          from,
          to: row.to + start,
          insert: '| ' + Array(edit.width).fill('').join(' | ') + ' |' + suffix,
        });
      } else {
        const at = start + (next?.from ?? row.cells.at(-1)!.to + 1);
        splices.push({ from: at, to: at, insert: '  |'.repeat(edit.width) });
      }
    }
    splices.sort((a, b) => b.from - a.from);
    for (const splice of splices) this.stage(splice, history);
    this.stageTableState(`cell:${cell.from + start}`, JSON.stringify(edit.nodes[0]), history);
    const updated = this.tableIndex(this.region(id), start).find(
      (t) => t.from + start === window.from,
    )!;
    const retained = cloneTableWindow(window);
    for (const splice of splices)
      for (const c of retained.cells) {
        c.first = mapPoint(c.first, splice, -1);
        c.last = mapPoint(c.last, splice, 1);
      }
    for (let r = 0; r < edit.height; r++)
      for (let c = 0; c < edit.width; c++) {
        if (!r && !c) continue;
        const next = updated.rows[edit.row + r].cells.find((x) => x.column === edit.column + c)!;
        this.stageTableState(
          `cell:${next.from + start}`,
          JSON.stringify(edit.nodes[r * edit.width + c]),
          history,
        );
        const extent = retained.extent;
        if (
          extent &&
          (next.row < extent.row ||
            next.row >= extent.row + extent.rowCount ||
            next.column < extent.column ||
            next.column >= extent.column + extent.columnCount)
        )
          continue;
        retained.cells.push({
          ...next,
          from: next.from + start,
          to: next.to + start,
          body: next.body + start,
          end: next.end + start,
          first: next.body + start,
          last: next.end + start,
          raw: '',
          runs: [],
        });
      }
    retained.cells.sort((a, b) => a.row - b.row || a.column - b.column);
    return this.tableWindow(cell.body + start, retained)!;
  }
  validateTableRemote(splice: Splice) {
    for (const key of this.tableStates.keys()) {
      const at = Number(key.slice(5)),
        { id, start } = this.locate(at);
      if (key.startsWith('tail:')) {
        if (
          !this.tableIndex(this.region(id), start).some((t) => t.from + start === at) ||
          (splice.from <= at && splice.to > at)
        )
          throw new Error('Conflict: remote source removes native table terminal owner');
        continue;
      }
      const cell = this.tableIndex(this.region(id), start)
        .flatMap((t) => t.rows.flatMap((r) => r.cells))
        .find((c) => c.from + start === at);
      if (!cell) throw new Error('Conflict: invalidated table metadata');
      const from = cell.from + start,
        to = cell.to + start;
      if (
        (splice.from < to && splice.to > from) ||
        (splice.from === splice.to && splice.from > from && splice.from < to)
      )
        throw new Error('Conflict: remote source overlaps live table structure');
    }
  }
  private tableIndex(source: string, start: number) {
    return scanTables(this.maskListCode(source, start), (from) => {
      const value = this.tableStates.get(`cell:${from + start}`);
      return value ? JSON.parse(value) : undefined;
    });
  }
  private stageTableMerge(
    window: TableWindow,
    edit: Extract<TableStructure, { kind: 'merge' }>,
    history: boolean,
  ) {
    if (window.revision !== this.revision) throw new Error('Stale table merge');
    if (bytes(JSON.stringify(edit)) > LIMITS.request)
      throw new Error('Table merge request exceeds budget');
    const { id, start } = this.locate(window.from),
      table = this.tableIndex(this.region(id), start).find((t) => t.from + start === window.from)!;
    if (edit.row === 0) throw new Error('Header merge source admission is not implemented');
    const covered = table.rows
      .slice(edit.row, edit.row + edit.height)
      .flatMap((row) =>
        row.cells.filter((c) => c.column >= edit.column && c.column < edit.column + edit.width),
      );
    const first = covered[0];
    for (const cell of covered) this.stageTableState(`cell:${cell.from + start}`, '', history);
    const splices: Splice[] = [];
    for (let r = edit.row; r < edit.row + edit.height; r++) {
      const cells = covered.filter((c) => c.row === r);
      if (!cells.length) continue;
      if (r === edit.row)
        splices.push({
          from: cells[0].body + start,
          to: cells.at(-1)!.end + start,
          insert: edit.source,
        });
      else if (cells.length === table.rows[r].cells.length) {
        // Keep a source row even when its logical cells are all covered by an owner above.
        splices.push({ from: cells[0].from + start, to: cells.at(-1)!.to + start, insert: ' ' });
      } else
        splices.push({ from: cells[0].from + start, to: cells.at(-1)!.to + 1 + start, insert: '' });
    }
    splices.sort((a, b) => b.from - a.from);
    for (const splice of splices) this.stage(splice, history);
    this.stageTableState(`cell:${first.from + start}`, JSON.stringify(edit.node), history);
    const retained = cloneTableWindow(window);
    retained.extent ??= {
      row: Math.min(...window.cells.map((c) => c.row)),
      column: Math.min(...window.cells.map((c) => c.column)),
      rowCount:
        Math.max(...window.cells.map((c) => c.row)) -
        Math.min(...window.cells.map((c) => c.row)) +
        1,
      columnCount:
        Math.max(...window.cells.map((c) => c.column + (c.mounted?.colspan ?? c.span ?? 1))) -
        Math.min(...window.cells.map((c) => c.column)),
    };
    retained.cells = retained.cells.filter(
      (c) => !covered.some((x) => x.from + start === c.from) || c.from === first.from + start,
    );
    for (const splice of splices)
      for (const cell of retained.cells) {
        cell.first = mapPoint(cell.first, splice, -1);
        cell.last = mapPoint(cell.last, splice, 1);
      }
    const merged = retained.cells.find((c) => c.from === first.from + start)!;
    merged.first = first.body + start;
    merged.last = merged.first + edit.source.length;
    return this.tableWindow(merged.first, retained)!;
  }
  maxBackingTableNavigationBytes = 0;
  tableNeighbor(from: number, direction: number, end = false) {
    const { id, start } = this.locate(from);
    const source = this.region(id);
    const table = this.tableIndex(source, start).find(
      (t) => from - start >= t.from && from - start < t.to,
    );
    if (!table) throw new Error('Table cell no longer exists');
    for (const row of table.rows)
      for (const [column, cell] of row.cells.entries())
        if (cell.from + start === from) {
          // Native findNextCell visits physical siblings, then the first/last
          // physical cell of the next nonempty row. Covered rowspan slots are
          // not additional Tab stops (nor necessarily owners in that row).
          let next = row.cells[column + direction];
          for (
            let r = cell.row + direction;
            !next && r >= 0 && r < table.rows.length;
            r += direction
          ) {
            const cells = table.rows[r].cells;
            next = direction > 0 ? cells[0] : cells[cells.length - 1];
          }
          if (!next) return undefined;
          const stored = end && this.tableStates.get(`cell:${next.from + start}`);
          const blocks = stored ? ((JSON.parse(stored) as JSONContent).content ?? []) : [];
          const last = blocks.at(-1);
          const offset = !end
            ? 0
            : last
              ? (last.content ?? []).reduce((n, child) => n + (child.text?.length ?? 1), 0)
              : tableRuns(source.slice(next.body, next.end), next.body).reduce(
                  (n, run) => n + (run.hardBreak ? 1 : run.text.length),
                  0,
                );
          if (end)
            this.maxBackingTableNavigationBytes = Math.max(
              this.maxBackingTableNavigationBytes,
              bytes(stored || source.slice(next.body, next.end)),
            );
          const result = {
            source: (end ? next.end : next.body) + start,
            point: {
              cell: next.from + start,
              block: end ? Math.max(0, blocks.length - 1) : 0,
              offset: end ? offset : 0,
            },
            revision: this.revision,
          };
          this.log('table-neighbor', from, bytes(JSON.stringify(result)));
          return result;
        }
    throw new Error('Table cell identity is stale');
  }
  /** Native TableMap.nextCell geometry, resolved in mock backing without sending
   * a table-wide owner map or offscreen cells to the renderer. */
  tableAdjacent(from: number, axis: 'vert' | 'horiz', direction: number) {
    const { id, start } = this.locate(from);
    const table = this.tableIndex(this.region(id), start).find(
      (t) => from - start >= t.from && from - start < t.to,
    );
    const cell = table?.rows.flatMap((r) => r.cells).find((c) => c.from + start === from);
    if (!table || !cell) throw new Error('Table cell identity is stale');
    const row = axis === 'vert' ? cell.row + (direction < 0 ? -1 : (cell.rowSpan ?? 1)) : cell.row;
    const column =
      axis === 'horiz' ? cell.column + (direction < 0 ? -1 : (cell.span ?? 1)) : cell.column;
    if (row < 0 || column < 0 || row >= table.rows.length || column >= table.columns)
      return undefined;
    const next = tableCellAt(table, row, column);
    const result = {
      source: next.body + start,
      point: { cell: next.from + start, block: 0, offset: 0 },
      revision: this.revision,
    };
    this.log('table-adjacent', from, bytes(JSON.stringify(result)));
    return result;
  }
  readonly tableHeights = new TableHeights(() => this.revision);
  private tableIndexes = new Map<
    number,
    { source: string; revision: number; tables: TableIndex[] }
  >();
  backingTableScannedBytes = 0;
  maxTableWindowBytes = 0;
  tableViewportPages(...args: Parameters<SourceJournal['tableViewportWindow']>) {
    const window = this.tableViewportWindow(...args);
    return window && this.transferTable(window);
  }
  mixedTableRanges(from: number, to: number) {
    const ranges: Array<{ from: number; to: number; rows: number; columns: number }> = [];
    for (let id = this.locate(from).id; id <= this.locate(to).id && id < this.count; id++) {
      const start = this.start(id);
      for (const table of this.tableIndex(this.region(id), start)) {
        const range = {
          from: table.from + start,
          to: table.to + start,
          rows: table.rows.length,
          columns: table.columns,
        };
        if (
          range.from >= from &&
          range.to <= to &&
          (this.slice(from, range.from).trim() || this.slice(range.to, to).trim())
        )
          ranges.push(range);
      }
    }
    const size = bytes(JSON.stringify(ranges));
    if (size > LIMITS.request) throw new Error('Mixed table range response exceeds budget');
    this.log('mixed-table-ranges', from, size);
    return ranges;
  }
  tableWindowPages(...args: Parameters<SourceJournal['tableWindow']>) {
    const window = this.tableWindow(...args);
    return window && this.transferTable(window);
  }
  transferTable(window: TableWindow) {
    const pages = encodeTablePages(window);
    for (const page of pages) this.log('table-page', window.from, bytes(JSON.stringify(page)));
    return pages;
  }
  tableViewportWindow(
    position: number,
    viewport: {
      top?: number;
      left?: number;
      height: number;
      width: number;
      font: string;
      include?: number;
      nearby?: number;
    },
    preferred?: TablePoint,
    selection?: Selection['table'],
  ) {
    const { id, start } = this.locate(position);
    const table = this.tableIndex(this.region(id), start).find(
      (t) => position - start >= t.from && position - start < t.to,
    );
    if (!table) return undefined;
    const row = Math.max(
      0,
      table.rows.findIndex((r) => position - start < r.to),
    );
    const cell =
      table.rows[row].cells.find((c) => position - start <= c.to) ?? table.rows[row].cells.at(-1)!;
    const width = Math.max(160, Math.floor(viewport.width / Math.min(3, table.columns)));
    const key = { revision: this.revision, table: table.from + start, width, font: viewport.font };
    const minimumRows = Math.ceil(viewport.height / 41) + 1;
    const targetRow = Math.min(row, Math.max(0, table.rows.length - minimumRows));
    const top = viewport.top ?? this.tableHeights.range(key, table.rows.length, targetRow, 0).top;
    let geometry = this.tableHeights.viewport(key, table.rows.length, top, viewport.height);
    let columnCount = Math.ceil((((viewport.left ?? 0) % width) + viewport.width) / width);
    let column =
      viewport.left === undefined
        ? Math.min(cell.column, Math.max(0, table.columns - columnCount))
        : Math.max(0, Math.floor(viewport.left / width));
    if (viewport.include !== undefined || viewport.nearby !== undefined) {
      // Mock backing lookup; only the bounded union rectangle reaches the renderer.
      const anchor = table.rows
        .flatMap((r) => r.cells)
        .find((c) => c.from + start === (viewport.include ?? viewport.nearby));
      // A newly extended cell selection should retain its adjacent endpoint.
      // A distant logical anchor stays in paged selection metadata, never an
      // unbounded union rectangle or hidden mounted selection.
      if (
        anchor &&
        (viewport.include !== undefined ||
          (anchor.row >= geometry.row - 1 &&
            anchor.row < geometry.row + geometry.heights.length &&
            anchor.column >= column - 1 &&
            anchor.column < column + columnCount))
      ) {
        const lastRow = Math.max(geometry.row + geometry.heights.length, anchor.row + 1);
        const firstRow = Math.min(geometry.row, anchor.row);
        geometry = this.tableHeights.range(key, table.rows.length, firstRow, lastRow - firstRow);
        const lastColumn = Math.max(
          column + columnCount,
          anchor.column + (viewport.include !== undefined ? (anchor.span ?? 1) : 1),
        );
        column = Math.min(column, anchor.column);
        columnCount = lastColumn - column;
      }
    }
    return this.tableWindow(
      position,
      undefined,
      preferred,
      {
        row: geometry.row,
        column,
        rowCount: geometry.heights.length,
        columnCount,
        geometry,
        ...(viewport.top === undefined
          ? {}
          : {
              fragmentStart: (entry, limit) => {
                const rowTop =
                  geometry.top +
                  geometry.heights.slice(0, entry.row - geometry.row).reduce((a, b) => a + b, 0);
                return this.tableHeights.fragmentStart(
                  key,
                  { ...entry, from: entry.from + start },
                  rowTop,
                  top,
                  viewport.height,
                  limit,
                );
              },
            }),
      },
      selection,
    );
  }
  tableWindow(
    position: number,
    retained?: TableWindow,
    preferred?: TablePoint,
    rectangle?: TableRectangle,
    selection?: Selection['table'],
  ) {
    const { id, start } = this.locate(position),
      source = this.region(id);
    let index = this.tableIndexes.get(id);
    if (!index || index.source !== source || index.revision !== this.revision) {
      index = { source, revision: this.revision, tables: this.tableIndex(source, start) };
      this.tableIndexes.set(id, index);
      this.backingTableScannedBytes += bytes(source);
    }
    const table = index.tables.find((t) => position - start >= t.from && position - start < t.to);
    if (!table) return undefined;
    const local = retained && cloneTableWindow(retained);
    for (const cell of local?.cells ?? []) {
      cell.first -= start;
      cell.last -= start;
    }
    const window = admitTableWindow(
      source,
      table,
      position - start,
      this.revision,
      (cell) => {
        const saved = this.tableStates.get(`cell:${cell.from + start}`);
        return saved ? JSON.parse(saved) : undefined;
      },
      local,
      preferred && { ...preferred, cell: preferred.cell - start },
      rectangle,
    );
    window.from += start;
    window.to += start;
    window.trailing = window.to !== this.length || this.tableStates.has(`tail:${window.from}`);
    for (const cell of window.cells) {
      for (const field of ['from', 'to', 'body', 'end', 'first', 'last'] as const)
        cell[field] += start;
      for (const run of cell.runs) {
        if (run.code) run.code = { from: run.code.from + start, to: run.code.to + start };
        run.from += start;
        run.to += start;
      }
      for (const block of cell.blocks ?? []) {
        block.from += start;
        block.to += start;
      }
    }
    if (selection?.kind === 'cell') {
      // Two endpoint lookups stay in backing storage; only a constant-sized rectangle travels.
      const anchor = table.rows
        .flatMap((r) => r.cells)
        .find((c) => c.from + start === selection.anchor.cell);
      const head = table.rows
        .flatMap((r) => r.cells)
        .find((c) => c.from + start === selection.head.cell);
      if (!anchor || !head) throw new Error('Stale table cell selection');
      window.selected = {
        anchor: selection.anchor.cell,
        head: selection.head.cell,
        top: Math.min(anchor.row, head.row),
        bottom: Math.max(anchor.row + (anchor.rowSpan ?? 1), head.row + (head.rowSpan ?? 1)),
        left: Math.min(anchor.column, head.column),
        right: Math.max(anchor.column + (anchor.span ?? 1), head.column + (head.span ?? 1)),
        backwardRows: anchor.row > head.row,
        backwardColumns: anchor.column > head.column,
      };
    } else delete window.selected;
    if (window.geometry && retained && window.geometry.revision !== this.revision) {
      const previous = window.geometry;
      window.geometry = this.tableHeights.range(
        { ...previous, revision: this.revision, table: window.from },
        window.rows,
        previous.row,
        previous.heights.length,
      );
    }
    window.layout = this.tableHeights.layout(window);
    const packed = packTableWindow(window);
    const size = bytes(JSON.stringify(packed));
    if (size > TABLE_ACTIVE_BYTES) throw new Error('Table window exceeds admission budget');
    this.maxTableWindowBytes = Math.max(this.maxTableWindowBytes, size);
    return packed;
  }
  readonly count: number;
  revision = 1;
  generation = 1;
  commentRevision = 1;
  private markerIds = new Set<string>();
  private commentDrafts = new Map<string, { text: string; baseRevision: number }>();
  private commentBodies = new Map<string, string>();
  maxCommentDraftPageBytes = 0;
  backingMarkerScannedBytes = 0;
  registerComment(id: string) {
    this.markerIds.add(id);
    this.reindexCommentMarkers();
  }
  private reindexCommentMarkers() {
    if (!this.markerIds.size) return;
    // Existing canonical IDs remain authoritative. These offsets are a derived
    // mock backing index, never an alternate persisted comment format.
    const source = this.slice(0, this.length);
    this.backingMarkerScannedBytes += bytes(source);
    const fences = scanFences(this.maskListCode(source));
    const markerAt = (marker: string) => {
      let at = source.indexOf(marker);
      while (at >= 0) {
        const literal = [...fences, ...this.listCodes.values()].find(
          (fence) => at >= fence.from && at < fence.to,
        );
        if (!literal) return at;
        at = source.indexOf(marker, literal.to);
      }
      return -1;
    };
    for (const id of this.markerIds) {
      const opening = `<!--anchor:${id}:start-->`,
        closing = `<!--anchor:${id}:end-->`;
      const start = markerAt(opening),
        end = markerAt(closing);
      const previous = this.anchors.find((a) => a.id === id);
      const alive = start >= 0 && end > start;
      const anchor: Anchor = {
        id,
        kind: 'comment',
        alive,
        from: alive ? start + opening.length : (previous?.from ?? 0),
        to: alive ? end : (previous?.to ?? 0),
      };
      this.anchors = this.anchors.filter((a) => a.id !== id).concat(anchor);
    }
  }
  replaceAttribution(revision: number, generation: number, anchors: Anchor[]) {
    if (revision !== this.revision || generation !== this.generation)
      throw new Error('Stale attribution');
    this.anchors = this.anchors
      .filter((a) => a.kind !== 'attribution')
      .concat(
        anchors.map((a) => ({ ...a, kind: 'attribution' as const, sourceRevision: revision })),
      );
    this.generation++;
  }
  stageCommentDraft(id: string, from: number, to: number, insert: string) {
    const draft = this.commentDrafts.get(id) ?? {
      text: this.commentBodies.get(id) ?? '',
      baseRevision: this.commentRevision,
    };
    if (
      from < 0 ||
      to < from ||
      to > draft.text.length ||
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to)
    )
      throw new Error('Invalid comment draft range');
    const size = bytes(JSON.stringify({ id, from, to, insert }));
    if (size > LIMITS.request) throw new Error('Comment draft write exceeds page budget');
    this.maxCommentDraftPageBytes = Math.max(this.maxCommentDraftPageBytes, size);
    this.commentDrafts.set(id, {
      ...draft,
      text: draft.text.slice(0, from) + insert + draft.text.slice(to),
    });
  }
  commentDraftPage(id: string, from = 0) {
    const draft = this.commentDrafts.get(id);
    if (!draft) return undefined;
    if (!Number.isSafeInteger(from) || from < 0 || from > draft.text.length)
      throw new Error('Invalid comment draft offset');
    let to = Math.min(draft.text.length, from + LIMITS.request);
    const result = () => ({
      id,
      from,
      to,
      text: draft.text.slice(from, to),
      next: to < draft.text.length ? to : undefined,
      baseRevision: draft.baseRevision,
    });
    while (bytes(JSON.stringify(result())) > LIMITS.request && to > from) to--;
    if (to < draft.text.length && /[\uD800-\uDBFF]/.test(draft.text[to - 1])) to--;
    if (to === from && from < draft.text.length)
      throw new Error('Comment draft envelope exceeds page budget');
    const page = result();
    this.maxCommentDraftPageBytes = Math.max(
      this.maxCommentDraftPageBytes,
      bytes(JSON.stringify(page)),
    );
    return page;
  }
  publishCommentDraft(id: string, revision: number) {
    const draft = this.commentDrafts.get(id);
    if (!draft) return false;
    if (revision !== this.commentRevision || revision !== draft.baseRevision)
      throw new Error('Comment draft conflict');
    this.commentBodies.set(id, draft.text);
    this.commentDrafts.delete(id);
    this.commentRevision++;
    return true;
  }
  private readonly annotationOwner = ++annotationOwner;
  private editAnchorsBefore: Anchor[] = [];
  annotationPayloadBytes = 0;
  maxAnnotationPageBytes = 0;
  maxAnnotationRequestBytes = 0;
  annotationReads = 0;
  private regions = new Map<number, string>();
  // Mock backing session state. Seam journal entries occupy individual bounded pages.
  private seams = new Map<number, ListSeam>();
  private maskListCode(source: string, start = 0) {
    let masked = source;
    for (const code of this.listCodes.values()) {
      const from = Math.max(0, code.from - start),
        to = Math.min(source.length, code.to - start);
      if (to > from) masked = masked.slice(0, from) + ' '.repeat(to - from) + masked.slice(to);
    }
    return masked;
  }
  maxListCodeWriteBytes = 0;
  private listCodes = new Map<number, ListCode>();
  private listCodeChange(before: ListCode | null, after: ListCode | null, history: boolean) {
    const page = JSON.stringify({
      from: 0,
      to: 0,
      insert: '',
      removed: '',
      listCode: { before, after },
    });
    if (bytes(page) > LIMITS.journalPage) throw new Error('List code journal page exceeds budget');
    const next = new Map(this.listCodes);
    if (before) next.delete(before.from);
    if (after) next.set(after.from, { ...after });
    this.listCodes = next;
    this.inlineIndex.clear();
    this.revision++;
    if (history) this.stagedPages.push(page);
    this.reindexCommentMarkers();
  }
  setListCodes(
    from: number,
    to: number,
    codes: ListCode[],
    revision = this.revision,
    history = true,
  ) {
    if (revision !== this.revision) throw new Error('Stale nested code revision');
    this.maxListCodeWriteBytes = Math.max(this.maxListCodeWriteBytes, bytes(JSON.stringify(codes)));
    if (bytes(JSON.stringify(codes)) > LIMITS.request)
      throw new Error('Nested code context exceeds budget');
    return this.atomic(() => {
      const desired = new Map(codes.map((code) => [code.from, code]));
      for (const code of this.listCodes.values()) {
        if (code.from >= to || code.to <= from) continue;
        if (JSON.stringify(code) !== JSON.stringify(desired.get(code.from)))
          this.listCodeChange(code, null, history);
      }
      for (const code of codes) {
        if (
          !validListCode(code, this.length) ||
          code.from >= to ||
          code.to <= from ||
          this.slice(code.from, code.bodyFrom) !== '`' ||
          this.slice(code.bodyTo, code.to) !== '`'
        )
          throw new Error('Invalid nested code source');
        if (!this.listCodes.has(code.from)) this.listCodeChange(null, code, history);
      }
    });
  }
  private paragraphSeams = new Map<number, ParagraphSeam>();
  private mappedParagraphSeams(splice: Splice, validate = true) {
    return new Map(
      [...this.paragraphSeams.values()]
        .filter((seam) => !validate || !touchesParagraphSeam(seam, splice))
        .map((seam) => {
          const next = mapParagraphSeam(seam, splice);
          return [next.from, next];
        }),
    );
  }
  private paragraphSeamChange(
    before: ParagraphSeam | null,
    after: ParagraphSeam | null,
    history: boolean,
  ) {
    const change: Change = {
      from: 0,
      to: 0,
      insert: '',
      removed: '',
      paragraphSeam: { before, after },
    };
    const page = JSON.stringify(change);
    if (bytes(page) > LIMITS.journalPage)
      throw new Error('Paragraph seam journal page exceeds budget');
    const next = new Map(this.paragraphSeams);
    if (before) next.delete(before.from);
    if (after) next.set(after.from, { ...after });
    this.paragraphSeams = next;
    this.revision++;
    if (history) this.stagedPages.push(page);
  }
  setParagraphSeam(seam: ParagraphSeam, revision = this.revision, history = true) {
    if (revision !== this.revision) throw new Error('Stale paragraph seam revision');
    if (!validParagraphSeam(seam, this.length, this.slice(seam.from, seam.to)))
      throw new Error('Invalid paragraph seam');
    if (!this.paragraphSeams.has(seam.from)) this.paragraphSeamChange(null, seam, history);
  }
  private atomicDepth = 0;
  backingSeamScannedBytes = 0;
  maxBackingSeamSourceBytes = 0;
  private mappedSeams(splice: Splice, validate = true) {
    const next = new Map<number, ListSeam>();
    if (!this.seams.size) return next;
    if (!validate)
      return new Map(
        [...this.seams.values()].map((s) => {
          const from = mapPoint(s.from, splice, 1);
          return [from, { ...s, from }];
        }),
      );
    const source = this.slice(0, splice.from) + splice.insert + this.slice(splice.to, this.length);
    this.backingSeamScannedBytes += bytes(source);
    this.maxBackingSeamSourceBytes = Math.max(this.maxBackingSeamSourceBytes, bytes(source));
    for (const seam of this.seams.values()) {
      if (splice.from <= seam.from && splice.to > seam.from) continue;
      const from = mapPoint(seam.from, splice, 1);
      if (from && source[from - 1] !== '\n') continue;
      const match = source.slice(from, from + 128).match(/^( *)([-+*]|\d+[.)]) (?:\[([ xX/])\] )?/);
      const kind =
        match &&
        (match[3] !== undefined ? 'taskList' : /^\d/.test(match[2]) ? 'orderedList' : 'bulletList');
      if (kind === seam.kind) next.set(from, { ...seam, from });
    }
    return next;
  }
  private seamChange(before: ListSeam | null, after: ListSeam | null, history: boolean) {
    const change: Change = { from: 0, to: 0, insert: '', removed: '', seam: { before, after } };
    const page = JSON.stringify(change);
    if (bytes(page) > LIMITS.journalPage) throw new Error('Seam journal page exceeds budget');
    const seams = new Map(this.seams);
    if (before) seams.delete(before.from);
    if (after) seams.set(after.from, { ...after });
    this.seams = seams;
    this.revision++;
    if (history) this.stagedPages.push(page);
  }
  /** Replace only the loaded source interval; unrelated and inherited boundaries remain backing-owned. */
  setSeams(from: number, to: number, seams: ListSeam[], revision = this.revision, history = true) {
    if (revision !== this.revision) throw new Error('Stale list seam revision');
    if (bytes(JSON.stringify(seams)) > LIMITS.request)
      throw new Error('Seam payload exceeds budget');
    return this.atomic(() => {
      const desired = new Map(seams.map((s) => [s.from, s]));
      for (const seam of this.seams.values()) {
        if (seam.from < from || seam.from >= to) continue;
        if (JSON.stringify(seam) !== JSON.stringify(desired.get(seam.from)))
          this.seamChange(seam, null, history);
      }
      for (const seam of seams) {
        if (!Number.isSafeInteger(seam.from) || !Number.isSafeInteger(seam.start) || seam.start < 0)
          throw new Error('Invalid list seam coordinates');
        if (seam.from < from || seam.from >= to) throw new Error('Seam outside admission range');
        // Validate new records independently of the existing index.
        const line = this.slice(seam.from, Math.min(this.length, seam.from + 128));
        const match = line.match(/^( *)([-+*]|\d+[.)]) (?:\[([ xX/])\] )?/);
        const kind =
          match &&
          (match[3] !== undefined
            ? 'taskList'
            : /^\d/.test(match[2])
              ? 'orderedList'
              : 'bulletList');
        if (kind !== seam.kind || (seam.from && this.slice(seam.from - 1, seam.from) !== '\n'))
          throw new Error('Invalid list seam');
        if (JSON.stringify(this.seams.get(seam.from)) !== JSON.stringify(seam))
          this.seamChange(null, seam, history);
      }
    });
  }
  replay(change: Change, redo: boolean) {
    if (!this.atomicDepth) throw new Error('History replay requires atomic admission');
    if (change.tableState)
      this.applyTableState(
        redo
          ? (change as Change & { tableState: string })
          : {
              tableState: change.tableState,
              from: change.from,
              to: change.from + change.insert.length,
              insert: change.removed,
            },
      );
    else if (change.listCode)
      this.listCodeChange(
        redo ? change.listCode.before : change.listCode.after,
        redo ? change.listCode.after : change.listCode.before,
        false,
      );
    else if (change.paragraphSeam)
      this.paragraphSeamChange(
        redo ? change.paragraphSeam.before : change.paragraphSeam.after,
        redo ? change.paragraphSeam.after : change.paragraphSeam.before,
        false,
      );
    else if (change.seam)
      this.seamChange(
        redo ? change.seam.before : change.seam.after,
        redo ? change.seam.after : change.seam.before,
        false,
      );
    else
      this.apply(
        redo
          ? change
          : { from: change.from, to: change.from + change.insert.length, insert: change.removed },
        false,
      );
  }
  private listItems(id: number): ListItem[] {
    this.spans(id);
    const start = this.start(id),
      active = new Map<number, { seam: ListSeam; ordinal: number }>();
    const previous = new Map<number, ListItem>();
    return this.inlineIndex.get(id)!.lists.map((item) => {
      const prior = previous.get(item.parent);
      if (
        prior &&
        (prior.marker !== item.marker ||
          this.region(id)
            .slice(prior.to, item.from)
            .split('\n')
            .some((line) => line.trim() && line.search(/\S/) <= item.indent))
      )
        active.delete(item.parent);
      previous.set(item.parent, item);
      const seam = this.seams.get(item.from + start);
      if (seam) active.set(item.parent, { seam, ordinal: seam.start });
      const group = active.get(item.parent);
      if (!group || group.seam.kind !== item.kind) {
        active.delete(item.parent);
        return item;
      }
      return { ...item, group: group.seam.from, ordinal: group.ordinal++ };
    });
  }
  // Mock backing index only. Rebuilt lazily per revision; no full projection/token map retained.
  private inlineIndex = new Map<
    number,
    {
      source: string;
      spans: SourceProjection['marks'];
      fences: Fence[];
      lists: ListItem[];
      anchors: SourceProjection['anchorRanges'];
    }
  >();
  backingIndexBuilds = 0;
  backingIndexScannedBytes = 0;
  maxBackingIndexSourceBytes = 0;
  backingFenceScannedBytes = 0;
  maxBackingFenceScanBytes = 0;
  maxFenceRepairBytes = 0;
  backingListRepairs = 0;
  maxListRepairRead = 0;
  inlineContextReads = 0;
  maxInlineContextBytes = 0;
  private spans(id: number) {
    const source = this.region(id);
    let index = this.inlineIndex.get(id);
    if (!index || index.source !== source) {
      const indexed = this.maskListCode(source, this.start(id));
      const fences = scanFences(indexed);
      const projection = new SourceProjection(
        indexed,
        0,
        { revision: this.revision, from: 0, to: source.length, before: [], after: [], fences },
        true,
      );
      index = {
        source,
        spans: projection.marks.sort((a, b) => a.openFrom - b.openFrom),
        anchors: projection.anchorRanges,
        fences,
        lists: scanLists(indexed).filter(
          (i) => !fences.some((f) => i.from >= f.from && i.from < f.to),
        ),
      };
      this.inlineIndex.set(id, index);
      this.backingIndexBuilds++;
      this.backingIndexScannedBytes += bytes(source);
      this.maxBackingIndexSourceBytes = Math.max(this.maxBackingIndexSourceBytes, bytes(source));
    }
    return index.spans;
  }
  /** Limit both item metadata and mounted structure, independently of text bytes. */
  listWindow(from: number, to: number, target: number) {
    const { id, start } = this.locate(target);
    this.spans(id);
    const items = this.inlineIndex.get(id)!.lists;
    const overlaps = items.filter((i) => i.to + start > from && i.from + start < to);
    if (!overlaps.length) return { from, to };
    const found = overlaps.findIndex((i) => i.to + start > target);
    const center = found < 0 ? overlaps.length - 1 : found;
    const first = Math.max(0, center - 4),
      last = Math.min(overlaps.length - 1, first + 8);
    if (first) from = Math.max(from, overlaps[first].from + start);
    if (last < overlaps.length - 1) to = Math.min(to, overlaps[last].to + start);
    const align = () => {
      from = this.inlineBoundary(from, 1);
      to = this.inlineBoundary(to, -1);
      if (this.splitsSurrogate(from)) from++;
      if (this.splitsSurrogate(to)) to--;
      for (const i of overlaps) {
        if (from > i.from + start && from < i.body + start) from = i.body + start;
        if (to > i.from + start && to < i.body + start) to = i.from + start;
      }
    };
    align();
    // Backing-side sizing includes ancestor/ordinal/seam metadata and reserves edit headroom.
    // This mock may scan its full index; only the final bounded context reaches the renderer.
    while (
      bytes(this.slice(from, to)) + bytes(JSON.stringify(this.inlineContext(from, to))) >
      LIMITS.request - 512
    ) {
      const center = Math.max(from, Math.min(to, target));
      const nextFrom = from + Math.ceil((center - from) / 8);
      const nextTo = to - Math.ceil((to - center) / 8);
      if (nextFrom === from && nextTo === to)
        throw new Error('List context cannot fit the experiment budget');
      from = nextFrom;
      to = nextTo;
      align();
    }
    return { from, to };
  }
  /** Never crop inside syntax: move inward, without transmitting that syntax. */
  inlineBoundary(position: number, direction: -1 | 1) {
    const { id, start } = this.locate(position);
    let local = position - start;
    const spans = this.spans(id);
    for (const anchor of this.inlineIndex.get(id)!.anchors)
      if (local > anchor.from && local < anchor.to) local = direction > 0 ? anchor.to : anchor.from;
    for (const f of this.inlineIndex.get(id)!.fences) {
      if (local > f.from && local < f.bodyFrom) local = direction > 0 ? f.bodyFrom : f.from;
      if (local > f.bodyTo && local < f.to) local = direction > 0 ? f.to : f.bodyTo;
    }
    // Include empty boundary spans: an opener alone (or a closer alone) cannot
    // form an editable projection. Inner-first traversal also removes an empty
    // outer span when moving past nested syntax lands on its content boundary.
    for (let i = spans.length - 1; i >= 0; i--) {
      const span = spans[i];
      if (local > span.openFrom && local <= span.contentFrom) {
        if (direction < 0) local = span.openFrom;
        else if (local < span.contentFrom) local = span.contentFrom;
      }
      if (local >= span.contentTo && local < span.closeTo) {
        if (direction > 0) local = span.closeTo;
        else if (local > span.contentTo) local = span.contentTo;
      }
    }
    return start + local;
  }
  inlineContext(from: number, to: number, revision = this.revision): InlineContext {
    if (revision !== this.revision) throw new Error('Stale inline context');
    const stack = (position: number) => {
      const { id, start } = this.locate(position);
      const local = position - start;
      return this.spans(id)
        .filter((s) => s.openFrom < local && s.contentFrom <= local && local <= s.contentTo)
        .map((s) =>
          s.mark.type === 'italic'
            ? { ...s.mark, range: { from: s.contentFrom + start, to: s.contentTo + start } }
            : s.mark,
        );
    };
    const before = stack(from),
      after = stack(to);
    const fences: Fence[] = [];
    const lists: ListItem[] = [];
    for (let id = this.locate(from).id; id <= this.locate(to).id; id++) {
      this.spans(id);
      const start = this.start(id);
      const all = this.listItems(id);
      const included = new Map<number, ListItem>();
      const visible = all.filter((i) => i.from + start < to && i.to + start > from);
      const first = visible[0];
      const previous =
        first && all.filter((i) => i.parent === first.parent && i.from < first.from).at(-1);
      for (const item of [...(previous ? [previous] : []), ...visible]) {
        let next: ListItem | undefined = item;
        while (next && !included.has(next.from)) {
          included.set(next.from, next);
          next = all.find((i) => i.from === next!.parent);
        }
      }
      lists.push(
        ...[...included.values()]
          .sort((a, b) => a.from - b.from)
          .map((i) => ({
            ...i,
            from: i.from + start,
            body: i.body + start,
            end: i.end + start,
            to: i.to + start,
            parent: i.parent < 0 ? -1 : i.parent + start,
          })),
      );
      for (const f of this.inlineIndex.get(id)!.fences)
        if (f.from + start < to && f.to + start > from)
          fences.push({
            ...f,
            from: f.from + start,
            bodyFrom: f.bodyFrom + start,
            bodyTo: f.bodyTo + start,
            to: f.to + start,
          });
    }
    const context: InlineContext = {
      revision,
      from,
      to,
      before,
      after,
      listCodes: [...this.listCodes.values()].filter((code) => code.to > from && code.from < to),
      ...([...this.paragraphSeams.values()].some((seam) => seam.from < to && seam.to > from)
        ? {
            paragraphSeams: [...this.paragraphSeams.values()].filter(
              (seam) => seam.from < to && seam.to > from,
            ),
          }
        : {}),
      ...(lists.length
        ? {
            lists,
            seams: [
              ...new Set(lists.map((i) => i.group).filter((p): p is number => p !== undefined)),
            ].map((p) => this.seams.get(p)!),
            documentEnd: to === this.length,
          }
        : {}),
      ...(fences.length ? { fences, documentEnd: to === this.length } : {}),
    };
    const size = bytes(JSON.stringify(context));
    if (size > LIMITS.request) throw new Error('Inline context exceeds experiment metadata budget');
    this.inlineContextReads++;
    this.maxInlineContextBytes = Math.max(this.maxInlineContextBytes, size);
    this.log('inline-context', from, size);
    return structuredClone(context);
  }
  private persisted = new Map<number, string>();
  private receipts = new Map<string, { payload: string; revision: number }>();
  private events: Array<{ meta: Omit<Event, 'changes'>; pages: string[] }> = [];
  private stagedPages: string[] = [];
  // Fake durable input inbox: renderer drains one bounded record, never the backlog.
  private inputInbox: string[] = [];
  maxInputRead = 0;
  enqueueInput(input: DeferredInput) {
    const text = input.text;
    if (text && text.length > 512) {
      for (let from = 0; from < text.length;) {
        let to = Math.min(from + 512, text.length);
        if (to < text.length && /[\uD800-\uDBFF]/.test(text[to - 1])) to--;
        this.enqueueInput({
          ...input,
          selection: from ? undefined : input.selection,
          text: text.slice(from, to),
        });
        from = to;
      }
      return;
    }
    const encoded = JSON.stringify(input);
    if (bytes(encoded) > LIMITS.request) throw new Error('Input record exceeds budget');
    this.inputInbox.push(encoded);
  }
  get pendingInputs() {
    return this.inputInbox.length;
  }
  readInput(): DeferredInput {
    const page = this.inputInbox[0];
    this.maxInputRead = Math.max(this.maxInputRead, bytes(page));
    return JSON.parse(page);
  }
  acknowledgeInput() {
    this.inputInbox.shift();
  }

  maxBackingAdmissionBytes = 0;
  private baseLengths: number[];
  cursor = 0;
  readonly logs: { method: string; from: number; bytes: number }[] = [];
  reads = 0;
  contextReads = 0;
  maxContextPayloadBytes = 0;
  maxRead = 0;
  journalReads = 0;
  maxJournalRead = 0;
  writes = 0;
  draftWrites = 0;
  maxSpliceBytes = 0;
  loseAcknowledgement = false;
  anchors: Anchor[];
  constructor(
    readonly generate = fixture,
    count = 10000,
  ) {
    this.count = count;
    this.baseLengths =
      count <= 20
        ? Array.from({ length: count }, (_, id) => generate(id).length)
        : [generate(0).length];
    const seam = generate(0).length;
    this.anchors = [
      {
        id: 'seam',
        from: Math.max(0, generate(0).indexOf('repeated')),
        to: seam + 11,
        alive: true,
      },
    ];
  }
  region(id: number) {
    return this.regions.get(id) ?? this.generate(id);
  }
  start(id: number) {
    let result =
      this.baseLengths.length === 1
        ? id * this.baseLengths[0]
        : this.baseLengths.slice(0, id).reduce((a, b) => a + b, 0);
    for (const [index, value] of this.regions)
      if (index < id) result += value.length - this.baseLength(index);
    return result;
  }
  private baseLength(id: number) {
    return this.baseLengths.length === 1 ? this.baseLengths[0] : this.baseLengths[id];
  }
  get length() {
    return this.start(this.count);
  }
  locate(position: number) {
    let lo = 0,
      hi = this.count - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.start(mid) <= position) lo = mid;
      else hi = mid - 1;
    }
    return { id: lo, start: this.start(lo) };
  }
  private log(method: string, from: number, size: number) {
    this.logs.push({ method, from, bytes: size });
    if (this.logs.length > LIMITS.log) this.logs.shift();
  }
  /** A bounded backing byte-length probe retains the accepted small-window behavior. */
  fitsWindow(from: number, to: number) {
    const result = to - from <= LIMITS.active && bytes(this.slice(from, to)) <= LIMITS.active;
    this.contextReads++;
    const size = bytes(JSON.stringify(result));
    this.maxContextPayloadBytes = Math.max(this.maxContextPayloadBytes, size);
    this.log('window-fit', from, size);
    return result;
  }
  /** Mock backing index: one boolean response, at most two inspected UTF-16 units. */
  splitsSurrogate(position: number) {
    const pair = this.slice(Math.max(0, position - 1), Math.min(this.length, position + 1));
    const result = /^[\uD800-\uDBFF][\uDC00-\uDFFF]$/.test(pair);
    this.contextReads++;
    const size = bytes(JSON.stringify(result));
    this.maxContextPayloadBytes = Math.max(this.maxContextPayloadBytes, size);
    this.log('context', position, size);
    return result;
  }
  read(from: number, to: number, revision = this.revision) {
    if (revision !== this.revision) throw new Error('Stale source revision');
    const source = this.slice(from, to);
    if (bytes(source) > LIMITS.request) throw new Error('Read exceeds page budget');
    this.reads++;
    this.maxRead = Math.max(this.maxRead, bytes(source));
    this.log('read', from, bytes(source));
    return { from, source, revision };
  }
  slice(from: number, to: number) {
    const first = this.locate(from),
      last = this.locate(to);
    let value = '';
    for (let id = first.id; id <= last.id; id++) {
      const start = this.start(id);
      value += this.region(id).slice(Math.max(0, from - start), Math.max(0, to - start));
    }
    return value;
  }
  apply(splice: Splice, validateSeams = true): Change {
    if (splice.from < 0 || splice.to < splice.from || splice.to > this.length)
      throw new Error('Invalid source range');
    const nextSeams = this.mappedSeams(splice, validateSeams);
    const nextParagraphSeams = this.mappedParagraphSeams(splice, validateSeams);
    const nextListCodes = new Map(
      [...this.listCodes.values()]
        .filter((code) => !validateSeams || !touchesListCode(code, splice))
        .map((code) => {
          const next = mapListCode(code, splice);
          return [next.from, next];
        }),
    );
    const removed = this.slice(splice.from, splice.to);
    this.draftWrites++;
    this.maxSpliceBytes = Math.max(this.maxSpliceBytes, bytes(JSON.stringify(splice)));
    this.log('splice', splice.from, bytes(JSON.stringify(splice)));
    const first = this.locate(splice.from),
      last = this.locate(splice.to);
    const suffix = this.region(last.id).slice(splice.to - last.start);
    if (first.id === last.id)
      this.regions.set(
        first.id,
        this.region(first.id).slice(0, splice.from - first.start) + splice.insert + suffix,
      );
    else {
      this.regions.set(
        first.id,
        this.region(first.id).slice(0, splice.from - first.start) + splice.insert,
      );
      for (let id = first.id + 1; id < last.id; id++) this.regions.set(id, '');
      this.regions.set(last.id, suffix);
    }
    this.anchors = this.anchors.map((a) => ({
      ...a,
      from: mapPoint(a.from, splice, 1),
      to: mapPoint(a.to, splice, -1),
      alive: a.alive && !(splice.from <= a.from && splice.to >= a.to && splice.to > splice.from),
    }));
    this.listCodes = nextListCodes;
    this.inlineIndex.clear();
    this.reindexCommentMarkers();
    this.seams = nextSeams;
    this.paragraphSeams = nextParagraphSeams;
    this.tableStates = new Map(
      [...this.tableStates].map(([key, value]) => [this.mapTableKey(key, splice), value]),
    );
    this.revision++;
    this.inputInbox = this.inputInbox.map((encoded) => {
      const input: DeferredInput = JSON.parse(encoded);
      return input.selection
        ? JSON.stringify({
            ...input,
            selection: mapSelection(input.selection, splice, this.revision),
          })
        : encoded;
    });
    return { ...splice, removed };
  }
  commit(operationId: string, expectedRevision: number, splice: Splice) {
    const payload = JSON.stringify({ expectedRevision, splice });
    const receipt = this.receipts.get(operationId);
    if (receipt) {
      if (receipt.payload !== payload) throw new Error('Operation ID reused');
      return receipt.revision;
    }
    if (expectedRevision !== this.revision) throw new Error('Write conflict');
    if (bytes(payload) > LIMITS.request) throw new Error('Write exceeds budget');
    this.apply(splice);
    this.writes++;
    this.receipts.set(operationId, { payload, revision: this.revision });
    if (this.receipts.size > LIMITS.receipts)
      this.receipts.delete(this.receipts.keys().next().value!);
    if (this.loseAcknowledgement) {
      this.loseAcknowledgement = false;
      throw new Error('Acknowledgement lost');
    }
    return this.revision;
  }
  save() {
    this.persisted = new Map(this.regions);
  }
  get dirty() {
    return [...this.regions]
      .filter(([id, source]) => source !== (this.persisted.get(id) ?? this.generate(id)))
      .map(([id]) => id);
  }
  annotations(
    from: number,
    to: number,
    revision: number,
    generation: number,
    options: {
      commentRevision?: number;
      cursor?: AnnotationCursor;
      limit?: number;
      ranges?: AnnotationRange[];
    } = {},
  ): AnnotationPage {
    const commentRevision = options.commentRevision ?? this.commentRevision;
    if (
      revision !== this.revision ||
      generation !== this.generation ||
      commentRevision !== this.commentRevision
    )
      throw new Error('Stale annotations');
    const limit = options.limit ?? 8;
    const requestBytes = bytes(JSON.stringify({ from, to, revision, generation, ...options }));
    if (requestBytes > LIMITS.request) throw new Error('Annotation request exceeds page budget');
    this.maxAnnotationRequestBytes = Math.max(this.maxAnnotationRequestBytes, requestBytes);
    const ranges = options.ranges ?? options.cursor?.ranges ?? [{ from, to }];
    if (
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      from < 0 ||
      to < from ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 8
    )
      throw new Error('Invalid annotation range or limit');
    if (
      !ranges.length ||
      ranges.some(
        (range, i) =>
          !Number.isSafeInteger(range.from) ||
          !Number.isSafeInteger(range.to) ||
          range.from < from ||
          range.to > to ||
          range.to < range.from ||
          (i > 0 && range.from < ranges[i - 1].to),
      )
    )
      throw new Error('Invalid annotation intervals');
    const binding = {
      owner: this.annotationOwner,
      from,
      to,
      revision,
      generation,
      commentRevision,
    };
    const cursor = options.cursor;
    if (
      cursor &&
      (Object.entries(binding).some(
        ([key, value]) => cursor[key as keyof AnnotationCursor] !== value,
      ) ||
        !Number.isSafeInteger(cursor.offset) ||
        cursor.offset < 0 ||
        cursor.offset > this.anchors.length ||
        JSON.stringify(cursor.ranges ?? [{ from, to }]) !== JSON.stringify(ranges))
    )
      throw new Error('Stale annotations cursor');
    const result: AnnotationPage = { revision, generation, commentRevision, items: [] };
    // This scan is explicitly mock BACKING work. Only one bounded page crosses
    // the adapter; even dense overlap does not create an intermediate full list.
    for (let offset = cursor?.offset ?? 0; offset < this.anchors.length; offset++) {
      const a = this.anchors[offset];
      if (
        !a.alive ||
        a.from >= to ||
        a.to <= from ||
        !ranges.some((range) => a.from < range.to && a.to > range.from) ||
        (a.kind === 'attribution' && a.sourceRevision !== revision)
      )
        continue;
      const next = {
        ...binding,
        offset,
        ...(options.ranges || cursor?.ranges
          ? { ranges: ranges.map((range) => ({ ...range })) }
          : {}),
      };
      if (
        result.items.length === limit ||
        bytes(JSON.stringify({ ...result, items: [...result.items, a], next })) > LIMITS.request
      ) {
        if (!result.items.length) throw new Error('Annotation item exceeds page budget');
        result.next = next;
        break;
      }
      result.items.push({ ...a });
    }
    this.annotationPayloadBytes = bytes(JSON.stringify(result));
    this.maxAnnotationPageBytes = Math.max(
      this.maxAnnotationPageBytes,
      this.annotationPayloadBytes,
    );
    this.annotationReads++;
    this.log('annotations', from, this.annotationPayloadBytes);
    return result;
  }
  /** One change per disk page; grouping never rehydrates preceding changes. */
  event(index: number) {
    const { before, after } = this.events[index].meta;
    return structuredClone({ before, after });
  }
  restoreEventAnchors(index: number, redo: boolean) {
    const event = this.events[index].meta;
    this.anchors = structuredClone(redo ? event.anchorsAfter : event.anchorsBefore);
    this.reindexCommentMarkers();
  }
  recordEdit(before: Selection, after: Selection, group: boolean) {
    this.record(
      {
        changes: [],
        before,
        after,
        anchorsBefore: this.editAnchorsBefore,
        anchorsAfter: structuredClone(this.anchors),
      },
      group,
    );
  }
  bookmark(index: number, key: 'before' | 'after', selection: Selection) {
    const event = this.events[index];
    this.events[index] = { ...event, meta: { ...event.meta, [key]: { ...selection } } };
  }
  *changes(index: number, reverse = false): Generator<Change> {
    const pages = this.events[index].pages;
    for (let n = 0; n < pages.length; n++) {
      const page = pages[reverse ? pages.length - 1 - n : n];
      this.maxJournalRead = Math.max(this.maxJournalRead, bytes(page));
      this.journalReads++;
      yield JSON.parse(page);
    }
  }
  /** Fake backing-store transaction. Copy-on-write records keep rollback independent of page count. */
  atomic<T>(run: () => T): T {
    const regions = new Map(this.regions),
      events = this.events.slice();
    const state = {
      revision: this.revision,
      cursor: this.cursor,
      anchors: this.anchors,
      editAnchorsBefore: this.editAnchorsBefore,
      draftWrites: this.draftWrites,
      maxSpliceBytes: this.maxSpliceBytes,
      logs: this.logs.slice(),
      stagedPages: this.stagedPages.slice(),
      seams: this.seams,
      paragraphSeams: this.paragraphSeams,
      listCodes: this.listCodes,
      tableStates: this.tableStates,
      inputInbox: this.inputInbox,
    };
    this.atomicDepth++;
    try {
      const result = run();
      if (
        this.atomicDepth === 1 &&
        ([...this.seams.values()].some(
          (s) => !Number.isSafeInteger(s.from) || !Number.isSafeInteger(s.start) || s.start < 0,
        ) ||
          this.mappedSeams({ from: 0, to: 0, insert: '' }).size !== this.seams.size)
      )
        throw new Error('Invalid final source and list seam state');
      if (
        this.atomicDepth === 1 &&
        [...this.paragraphSeams.values()].some(
          (seam) => !validParagraphSeam(seam, this.length, this.slice(seam.from, seam.to)),
        )
      )
        throw new Error('Invalid final source and paragraph seam state');
      if (
        this.atomicDepth === 1 &&
        [...this.listCodes.values()].some(
          (code) =>
            !validListCode(code, this.length) ||
            this.slice(code.from, code.bodyFrom) !== '`' ||
            this.slice(code.bodyTo, code.to) !== '`',
        )
      )
        throw new Error('Invalid final nested code source');
      return result;
    } catch (error) {
      this.tableHeights.rollback(state.revision);
      this.stagedPages = state.stagedPages;
      this.seams = state.seams;
      this.paragraphSeams = state.paragraphSeams;
      this.listCodes = state.listCodes;
      this.inlineIndex.clear();
      this.tableStates = state.tableStates;
      this.inputInbox = state.inputInbox;
      this.regions = regions;
      this.events = events;
      this.revision = state.revision;
      this.cursor = state.cursor;
      this.anchors = state.anchors;
      this.editAnchorsBefore = state.editAnchorsBefore;
      this.draftWrites = state.draftWrites;
      this.maxSpliceBytes = state.maxSpliceBytes;
      this.logs.splice(0, this.logs.length, ...state.logs);
      throw error;
    } finally {
      this.atomicDepth--;
    }
  }
  private pages(change: Change): string[] {
    const encoded = JSON.stringify(change);
    if (bytes(encoded) <= LIMITS.journalPage) return [encoded];
    const chunks = (text: string) => {
      const result: string[] = [];
      for (let from = 0; from < text.length;) {
        let to = Math.min(from + 512, text.length);
        if (to < text.length && /[\uD800-\uDBFF]/.test(text[to - 1])) to--;
        result.push(text.slice(from, to));
        from = to;
      }
      return result;
    };
    const pages: string[] = [];
    for (const removed of chunks(change.removed))
      pages.push(
        JSON.stringify({
          from: change.from,
          to: change.from + removed.length,
          insert: '',
          removed,
          ...(change.tableState ? { tableState: change.tableState } : {}),
        }),
      );
    let from = change.from;
    for (const insert of chunks(change.insert)) {
      pages.push(
        JSON.stringify({
          from,
          to: from,
          insert,
          removed: '',
          ...(change.tableState ? { tableState: change.tableState } : {}),
        }),
      );
      from += insert.length;
    }
    if (pages.some((p) => bytes(p) > LIMITS.journalPage))
      throw new Error('Journal page exceeds budget');
    return pages;
  }
  beginChanges() {
    this.stagedPages = [];
    this.editAnchorsBefore = structuredClone(this.anchors);
  }
  /** Mock backing admission: literal code and its framing form one atomic edit.
   * Full body scans are backing work, never renderer reads or parser inputs.
   */
  stageProjection(
    splices: Splice[],
    fences: Fence[],
    revision: number,
    history = true,
    indentation: Array<{ from: number; after: number; delta: number }> = [],
    onSplice?: (splice: Splice) => void,
  ) {
    if (revision !== this.revision) throw new Error('Stale code admission revision');
    return this.atomic(() => {
      // Full descendant discovery belongs to the mock backing index. The renderer
      // supplies bounded structural intents and receives one bounded repair at a time.
      const listRepairs = new Map<number, Splice>();
      for (const change of indentation) {
        const { id, start } = this.locate(change.from);
        this.spans(id);
        const items = this.inlineIndex.get(id)!.lists;
        const parent = items.find((i) => i.from + start === change.from)!;
        for (const child of items) {
          if (child.from <= parent.from) continue;
          if (child.indent <= parent.indent) break;
          if (child.from + start < change.after || listRepairs.has(child.from + start)) continue;
          listRepairs.set(child.from + start, {
            from: child.from + start,
            to: child.from + start + child.indent,
            insert: ' '.repeat(child.indent + change.delta),
          });
        }
      }
      for (const splice of splices) {
        this.stage(splice, history);
        onSplice?.(splice);
      }
      const repairs: Splice[] = [];
      for (const original of [...listRepairs.values()].sort((a, b) => b.from - a.from)) {
        const repair = { ...original };
        for (const splice of splices) {
          repair.from = mapPoint(repair.from, splice);
          repair.to = mapPoint(repair.to, splice);
        }
        if (!onSplice) throw new Error('List repair requires bounded acknowledgement');
        this.maxListRepairRead = Math.max(this.maxListRepairRead, bytes(JSON.stringify(repair)));
        if (this.maxListRepairRead > LIMITS.request) throw new Error('List repair exceeds budget');
        this.stage(repair, history);
        onSplice(repair);
        this.backingListRepairs++;
      }
      for (const fence of fences) {
        const marker = fence.opening.match(/^(`{3,}|~{3,})/)![0];
        const body = this.slice(fence.bodyFrom, fence.bodyTo);
        const size = bytes(body);
        this.backingFenceScannedBytes += size;
        this.maxBackingFenceScanBytes = Math.max(this.maxBackingFenceScanBytes, size);
        // Markdown permits up to three leading spaces and trailing horizontal
        // whitespace on closing lines. Include the real first/last body lines.
        const candidates = new RegExp(`^ {0,3}(${marker[0]}{${marker.length},})[ \\t]*$`, 'gm');
        let length = marker.length;
        for (const match of body.matchAll(candidates))
          length = Math.max(length, match[1].length + 1);
        if (length === marker.length) continue;
        repairs.push({
          from: fence.from,
          to: fence.from,
          insert: marker[0].repeat(length - marker.length),
        });
        const close = fence.closing.match(/(?:^|\n)(`{3,}|~{3,})[ \t]*(?:\n|$)/);
        const closeLength = Math.max(length, close?.[1].length ?? 0);
        if (close && close[1].length < closeLength) {
          const at = fence.bodyTo + close.index! + (close[0][0] === '\n' ? 1 : 0);
          repairs.push({
            from: at,
            to: at,
            insert: marker[0].repeat(closeLength - close[1].length),
          });
        }
      }
      // Descending source order preserves coordinates for every independent fence.
      repairs.sort((a, b) => b.from - a.from);
      this.maxFenceRepairBytes = Math.max(this.maxFenceRepairBytes, bytes(JSON.stringify(repairs)));
      for (const splice of repairs) {
        this.stage(splice, history);
        onSplice?.(splice);
      }
      return onSplice ? [] : [...splices, ...repairs];
    });
  }
  /** Admission and inverse paging live in the mock backing service, not a renderer change array. */
  stage(splice: Splice, history = true) {
    const change = { ...splice, removed: this.slice(splice.from, splice.to) };
    this.maxBackingAdmissionBytes = Math.max(
      this.maxBackingAdmissionBytes,
      bytes(JSON.stringify(change)),
    );
    const pages = this.pages(change);
    for (const page of pages) {
      const bounded: Change = JSON.parse(page);
      for (const code of this.listCodes.values())
        if (touchesListCode(code, bounded)) this.listCodeChange(code, null, history);
      for (const seam of this.paragraphSeams.values())
        if (touchesParagraphSeam(seam, bounded)) this.paragraphSeamChange(seam, null, history);
      const mapped = this.mappedSeams(bounded);
      for (const seam of this.seams.values())
        if (
          (bounded.from <= seam.from && bounded.to > seam.from) ||
          !mapped.has(mapPoint(seam.from, bounded, 1))
        )
          this.seamChange(seam, null, history);
      this.apply(bounded);
      if (!history) this.rebase(bounded);
      if (history) this.stagedPages.push(page);
    }
  }
  record(event: Event, group: boolean) {
    // Admission precedes mutation, including truncating the redo branch.
    const pages = [...this.stagedPages, ...event.changes.flatMap((change) => this.pages(change))];
    const { changes: _changes, ...meta } = event;
    const events = this.events.slice(0, this.cursor);
    const previous = group && this.cursor ? events[this.cursor - 1] : undefined;
    if (previous)
      events[this.cursor - 1] = {
        pages: [...previous.pages, ...pages],
        meta: { ...previous.meta, after: meta.after, anchorsAfter: meta.anchorsAfter },
      };
    else events.push({ meta, pages });
    if (events.length > 120) events.splice(0, events.length - 100);
    this.events = events;
    this.cursor = events.length;
    this.stagedPages = [];
  }
  /** Carry the remote operation backwards through undo and forwards through redo coordinates. */
  rebase(splice: Splice) {
    const events = this.events.slice();
    const inverse = (c: Change): Splice => ({
      from: c.from,
      to: c.from + c.insert.length,
      insert: c.removed,
    });
    const mapSplice = (s: Splice, through: Splice): Splice => ({
      ...s,
      from: mapPoint(s.from, through, 1),
      to: mapPoint(s.to, through, s.from === s.to ? 1 : -1),
    });
    const anchors = (entries: Anchor[], through: Splice) =>
      entries.map((a) => ({
        ...a,
        from: mapPoint(a.from, through),
        to: mapPoint(a.to, through, -1),
      }));
    const meta = (e: Omit<Event, 'changes'>, before: Splice, after: Splice) => ({
      before: mapSelection(e.before, before, this.revision),
      after: mapSelection(e.after, after, this.revision),
      anchorsBefore: anchors(e.anchorsBefore, before),
      anchorsAfter: anchors(e.anchorsAfter, after),
    });
    const mapSeamChange = (change: Change, through: Splice): Change => {
      const map = (seam: ListSeam | null) => {
        if (!seam) return null;
        if (
          (through.from <= seam.from && through.to > seam.from) ||
          (through.from === seam.from &&
            through.to === seam.from &&
            through.insert &&
            !through.insert.endsWith('\n'))
        )
          throw new Error('Conflict: retained list seam history');
        return { ...seam, from: mapPoint(seam.from, through, 1) };
      };
      return {
        ...change,
        seam: { before: map(change.seam!.before), after: map(change.seam!.after) },
      };
    };
    const mapParagraphChange = (change: Change, through: Splice): Change => {
      const map = (seam: ParagraphSeam | null) => {
        if (!seam) return null;
        if (touchesParagraphSeam(seam, through))
          throw new Error('Conflict: retained paragraph seam history');
        return mapParagraphSeam(seam, through);
      };
      return {
        ...change,
        paragraphSeam: {
          before: map(change.paragraphSeam!.before),
          after: map(change.paragraphSeam!.after),
        },
      };
    };
    const mapCodeChange = (change: Change, through: Splice): Change => {
      const map = (code: ListCode | null) => {
        if (!code) return null;
        if (touchesListCode(code, through))
          throw new Error('Conflict: retained nested code history');
        return mapListCode(code, through);
      };
      return {
        ...change,
        listCode: { before: map(change.listCode!.before), after: map(change.listCode!.after) },
      };
    };
    let remote = splice;
    for (let i = this.cursor - 1; i >= 0; i--) {
      const event = this.events[i],
        after = remote,
        pages = new Array<string>(event.pages.length);
      for (let n = event.pages.length - 1; n >= 0; n--) {
        const c: Change = JSON.parse(event.pages[n]),
          inv = inverse(c);
        if (c.tableState) {
          const at = Number(c.tableState.slice(5));
          if (remote.from <= at && remote.to > at)
            throw new Error('Conflict: retained table structure history');
          pages[n] = JSON.stringify({ ...c, tableState: this.mapTableKey(c.tableState, remote) });
          continue;
        }
        if (c.listCode) {
          pages[n] = JSON.stringify(mapCodeChange(c, remote));
          continue;
        }
        if (c.paragraphSeam) {
          pages[n] = JSON.stringify(mapParagraphChange(c, remote));
          continue;
        }
        if (c.seam) {
          pages[n] = JSON.stringify(mapSeamChange(c, remote));
          continue;
        }
        if (remote.from < inv.to && remote.to > inv.from)
          throw new Error('Conflict: retained draft and journal');
        const before = mapSplice(remote, inv);
        pages[n] = JSON.stringify(mapSplice(c, before));
        remote = before;
      }
      events[i] = {
        pages: pages.flatMap((page) => this.pages(JSON.parse(page))),
        meta: meta(event.meta, remote, after),
      };
    }
    remote = splice;
    for (let i = this.cursor; i < this.events.length; i++) {
      const event = this.events[i],
        before = remote,
        pages: string[] = [];
      for (const page of event.pages) {
        const c: Change = JSON.parse(page);
        if (c.tableState) {
          const at = Number(c.tableState.slice(5));
          if (remote.from <= at && remote.to > at)
            throw new Error('Conflict: retained table structure history');
          pages.push(JSON.stringify({ ...c, tableState: this.mapTableKey(c.tableState, remote) }));
          continue;
        }
        if (c.listCode) {
          pages.push(JSON.stringify(mapCodeChange(c, remote)));
          continue;
        }
        if (c.paragraphSeam) {
          pages.push(JSON.stringify(mapParagraphChange(c, remote)));
          continue;
        }
        if (c.seam) {
          pages.push(JSON.stringify(mapSeamChange(c, remote)));
          continue;
        }
        if (remote.from < c.to && remote.to > c.from)
          throw new Error('Conflict: retained redo and journal');
        pages.push(JSON.stringify(mapSplice(c, remote)));
        remote = mapSplice(remote, c);
      }
      events[i] = {
        pages: pages.flatMap((page) => this.pages(JSON.parse(page))),
        meta: meta(event.meta, before, remote),
      };
    }
    this.events = events;
  }
  get depth() {
    return this.events.length;
  }
  get stats() {
    return {
      annotationReads: this.annotationReads,
      backingMarkerScannedBytes: this.backingMarkerScannedBytes,
      maxCommentDraftPageBytes: this.maxCommentDraftPageBytes,
      backingCommentDraftBytes: [...this.commentDrafts.values()].reduce(
        (n, draft) => n + bytes(draft.text),
        0,
      ),
      maxAnnotationPageBytes: this.maxAnnotationPageBytes,
      maxAnnotationRequestBytes: this.maxAnnotationRequestBytes,
      backingAnnotationBytes: bytes(JSON.stringify(this.anchors)),
      backingSeamScannedBytes: this.backingSeamScannedBytes,
      maxBackingSeamSourceBytes: this.maxBackingSeamSourceBytes,
      backingSeamCount: this.seams.size,
      maxListCodeWriteBytes: this.maxListCodeWriteBytes,
      backingListCodeCount: this.listCodes.size,
      backingListCodeBytes: bytes(JSON.stringify([...this.listCodes.values()])),
      backingParagraphSeamCount: this.paragraphSeams.size,
      backingParagraphSeamBytes: bytes(JSON.stringify([...this.paragraphSeams.values()])),
      backingTableIndexBytes: [...this.tableIndexes.values()].reduce(
        (n, index) => n + bytes(JSON.stringify(index.tables)),
        0,
      ),
      maxTableParagraphTransientBytes: this.maxTableParagraphTransientBytes,
      backingTableMetadataBytes: [...this.tableStates.values()].reduce(
        (n, value) => n + bytes(value),
        0,
      ),
      maxTableWriteBytes: this.maxTableWriteBytes,
      maxTableStructuralTransientBytes: this.maxTableStructuralTransientBytes,
      maxBackingTableSplitCells: this.maxBackingTableSplitCells,
      maxBackingTableSplitBytes: this.maxBackingTableSplitBytes,
      maxBackingTableCommandBytes: this.maxBackingTableCommandBytes,
      maxBackingTableNavigationBytes: this.maxBackingTableNavigationBytes,
      maxBackingTableCommandNodes: this.maxBackingTableCommandNodes,
      backingSeamBytes: bytes(JSON.stringify([...this.seams.values()])),
      backingListRepairs: this.backingListRepairs,
      maxListRepairRead: this.maxListRepairRead,
      backingIndexBuilds: this.backingIndexBuilds,
      backingIndexScannedBytes: this.backingIndexScannedBytes,
      maxBackingIndexSourceBytes: this.maxBackingIndexSourceBytes,
      backingFenceScannedBytes: this.backingFenceScannedBytes,
      maxBackingFenceScanBytes: this.maxBackingFenceScanBytes,
      maxFenceRepairBytes: this.maxFenceRepairBytes,
      backingIndexPayloadBytes: [...this.inlineIndex.values()].reduce(
        (n, i) => n + bytes(JSON.stringify({ spans: i.spans, fences: i.fences, lists: i.lists })),
        0,
      ),
      backingIndexSourceBytes: [...this.inlineIndex.values()].reduce(
        (n, i) => n + bytes(i.source),
        0,
      ),
      inlineContextReads: this.inlineContextReads,
      maxInlineContextBytes: this.maxInlineContextBytes,
      pendingInputs: this.pendingInputs,
      backingInputBytes: this.inputInbox.reduce((n, page) => n + bytes(page), 0),
      maxInputRead: this.maxInputRead,
      draftWrites: this.draftWrites,
      maxSpliceBytes: this.maxSpliceBytes,
      contextReads: this.contextReads,
      maxContextPayloadBytes: this.maxContextPayloadBytes,
      backingStagedJournalBytes: this.stagedPages.reduce((n, p) => n + bytes(p), 0),
      maxBackingAdmissionBytes: this.maxBackingAdmissionBytes,
      backingSourceBytes: [...this.regions.values()].reduce((n, s) => n + bytes(s), 0),
      backingSavedBytes: [...this.persisted.values()].reduce((n, s) => n + bytes(s), 0),
      backingJournalBytes: this.events.reduce(
        (n, e) => n + bytes(JSON.stringify(e.meta)) + e.pages.reduce((m, p) => m + bytes(p), 0),
        0,
      ),
      journalPages: this.events.reduce((n, e) => n + e.pages.length, 0),
      journalEvents: this.events.length,
      maxJournalRead: this.maxJournalRead,
      receiptCount: this.receipts.size,
      receiptBytes: [...this.receipts.values()].reduce((n, r) => n + bytes(r.payload), 0),
      logCount: this.logs.length,
      logBytes: bytes(JSON.stringify(this.logs)),
      dirty: this.dirty,
    };
  }
}
